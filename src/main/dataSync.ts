// refresh bundled uex lists, no update

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { app } from 'electron'
import type { DataSyncResult } from '@shared/types'

const RAW_BASE = 'https://raw.githubusercontent.com/AquatikJustice/SuperCargo/master/data/uex'
const FETCH_TIMEOUT_MS = 12000

const SPECS = [
  { repo: 'ships.json', cache: 'uex-vehicles.json', key: 'ships' },
  { repo: 'locations.json', cache: 'uex-locations.json', key: 'locations' },
  { repo: 'commodities.json', cache: 'uex-commodities.json', key: 'commodities' },
  { repo: 'grid-faces.json', cache: 'uex-grid-faces.json', key: 'gridFaces' }
] as const

function cachePath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

function seedDir(): string {
  const candidates = [
    path.join(process.resourcesPath, 'data', 'uex'),
    path.join(app.getAppPath(), 'data', 'uex'),
    path.join(app.getAppPath(), '..', '..', 'data', 'uex')
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// don't clobber a user-updated cache
export function seedCacheIfNeeded(): void {
  const dir = seedDir()
  for (const s of SPECS) {
    const dst = cachePath(s.cache)
    const src = path.join(dir, s.repo)
    try {
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        continue
      }
      if (fs.statSync(src).mtimeMs <= fs.statSync(dst).mtimeMs) continue
      if (sha256(fs.readFileSync(src)) === sha256(fs.readFileSync(dst))) continue
      fs.copyFileSync(src, dst)
    } catch (e) {
      console.warn(`[data] seed ${s.repo} failed:`, (e as Error).message)
    }
  }
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// reached=false means "couldn't check"
export async function refreshFromRepo(): Promise<DataSyncResult> {
  const hashesText = await fetchText(`${RAW_BASE}/hashes.json`)
  if (!hashesText) return { reached: false, changed: false, updated: [] }
  let hashes: Record<string, string>
  try {
    hashes = JSON.parse(hashesText)
  } catch {
    return { reached: false, changed: false, updated: [] }
  }

  const updated: string[] = []
  for (const s of SPECS) {
    const want = hashes[s.key]
    if (!want) continue
    let have = ''
    try {
      have = sha256(fs.readFileSync(cachePath(s.cache)))
    } catch {
      /* no local copy yet */
    }
    if (have === want) continue

    const body = await fetchText(`${RAW_BASE}/${s.repo}`)
    if (!body) continue
    // guards a truncated download
    if (sha256(body) !== want) continue
    try {
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed[s.key])) continue
    } catch {
      continue
    }
    try {
      fs.writeFileSync(cachePath(s.cache), body)
      updated.push(s.key)
    } catch (e) {
      console.warn(`[data] write ${s.cache} failed:`, (e as Error).message)
    }
  }
  return { reached: true, changed: updated.length > 0, updated }
}
