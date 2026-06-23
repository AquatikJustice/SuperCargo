// Keep the bundled UEX lists (ships, freight locations, commodities) current
// without shipping an app update for every game patch.
//
// The repo hosts data/uex/{ships,locations,commodities}.json plus hashes.json
// holding their sha256s. At launch, for users WITHOUT their own UEX token, we:
//   1. seed the userData cache from the bundled copy if it's empty (so a fresh /
//      offline install has working commodity + location matching right away), then
//   2. compare each cached file's hash to the repo hashes and pull only the lists
//      that changed, writing them into the same uex-*.json cache the token sync
//      uses, so everything downstream is unchanged.
//
// Token users skip all of this: their live sync is fresher and also drives route
// distances, and it would fight the hash compare.

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { app } from 'electron'

const RAW_BASE = 'https://raw.githubusercontent.com/AquatikJustice/SuperCargo/master/data/uex'
const FETCH_TIMEOUT_MS = 12000

// repo file <-> the userData cache file the rest of the app already reads.
const SPECS = [
  { repo: 'ships.json', cache: 'uex-vehicles.json', key: 'ships' },
  { repo: 'locations.json', cache: 'uex-locations.json', key: 'locations' },
  { repo: 'commodities.json', cache: 'uex-commodities.json', key: 'commodities' }
] as const

function cachePath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

/** Where the bundled seed lives: packaged resources, or the repo root in dev. */
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

/** Seed the cache from the bundled lists, and reconcile a stale cache left by an
 *  older version. A missing file is copied. An existing file is refreshed only when
 *  the bundled seed is BOTH newer (mtime) and different (hash) - the mtime guard
 *  keeps us from clobbering a cache the user updated themselves (e.g. token sync),
 *  which is always newer than a freshly-installed bundle. */
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

/**
 * Pull any list whose repo hash differs from the local copy. Returns true if at
 * least one file was updated (so the caller can re-push rosters). Best effort:
 * any network or parse failure leaves the existing cache untouched.
 */
export async function refreshFromRepo(): Promise<boolean> {
  const hashesText = await fetchText(`${RAW_BASE}/hashes.json`)
  if (!hashesText) return false
  let hashes: Record<string, string>
  try {
    hashes = JSON.parse(hashesText)
  } catch {
    return false
  }

  let changed = false
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
    // Only trust it if it hashes to what the manifest promised and parses as the
    // expected roster shape. Guards against a truncated download or a bad commit.
    if (sha256(body) !== want) continue
    try {
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed[s.key])) continue
    } catch {
      continue
    }
    try {
      fs.writeFileSync(cachePath(s.cache), body)
      changed = true
    } catch (e) {
      console.warn(`[data] write ${s.cache} failed:`, (e as Error).message)
    }
  }
  return changed
}
