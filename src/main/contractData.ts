// optional contract details from local localization files

import * as fs from 'node:fs'
import * as path from 'node:path'
import { cleanTitle } from '@shared/contract'
import { normalize, bestMatch } from '@shared/fuzzy'
import type { AppSettings, ContractAcceptedEvent, ContractDataStatus } from '@shared/types'

export interface ContractInfo {
  title: string
  blueprints: string[]
  reputation?: number
  maxBoxSize?: number
}

const BOX_SIZES = [1, 2, 4, 8, 16, 24, 32]
function snapBoxSize(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined
  let best = BOX_SIZES[0]
  for (const s of BOX_SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return best
}

let byTitle = new Map<string, ContractInfo>()
let knownNorms: string[] = []
let sources: string[] = []

function candidatePaths(gameLogPath: string, override: string): string[] {
  const out: string[] = []
  if (override) out.push(override)
  if (gameLogPath) {
    const dir = path.dirname(gameLogPath)
    for (const d of ['data', 'Data']) {
      const base = path.join(dir, d, 'Localization', 'english')
      // global.ini first so contracts.ini can override it
      out.push(path.join(base, 'global.ini'))
      out.push(path.join(base, 'contracts.ini'))
    }
  }
  return out.filter((p, i, a) => a.indexOf(p) === i).filter((p) => fs.existsSync(p))
}

const RE_TITLE_KEY = /^(.*?)_Title(?:_\d+)?$/i
const RE_DESC_KEY = /^(.*?)_Desc(?:ription)?(?:Long)?(?:_\d+)?$/i

interface Entry {
  suffix: number
  value: string
}

function addEntry(map: Map<string, Entry[]>, base: string, suffix: number, value: string): void {
  const list = map.get(base) ?? []
  list.push({ suffix, value })
  map.set(base, list)
}

function suffixOf(key: string): number {
  const m = /_(\d+)$/.exec(key)
  return m ? parseInt(m[1], 10) : 0
}

function extractBlueprints(descRaw: string): string[] {
  const text = descRaw.replace(/\\n/g, '\n').replace(/<\/?EM[^>]*>/gi, '')
  const m = /(potential blueprint|blueprint pool|multiple blueprint)/i.exec(text)
  if (!m) return []
  const out: string[] = []
  for (const raw of text.slice(m.index).split('\n')) {
    const bm = /^\s*[-•]\s*(.+\S)/.exec(raw)
    if (bm) out.push(bm[1].replace(/\s+/g, ' ').trim())
  }
  return out
}

function extractMaxBox(descRaw: string): number | undefined {
  const m = /\(all\s+(\d+)\s*scu\s+or\s+smaller\)/i.exec(descRaw)
  return m ? snapBoxSize(parseInt(m[1], 10)) : undefined
}

function extractReputation(titleRaw: string, descRaw: string): number | undefined {
  const t = /\[\s*(\d+)(?:\s*\/\s*\d+)?\s*rep\s*\]/i.exec(titleRaw)
  if (t) return parseInt(t[1], 10)
  const d = /reputation\s+awarded[:\s]*<?\/?EM[^>]*>?\s*:?\s*(\d+)/i.exec(
    descRaw.replace(/<\/?EM[^>]*>/gi, ' ')
  )
  return d ? parseInt(d[1], 10) : undefined
}

function parseFile(file: string, titles: Map<string, Entry[]>, descs: Map<string, Entry[]>): void {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const rawKey = line.slice(0, eq).replace(/,\w+$/, '').trim() // drop trailing ",tag"
    const value = line.slice(eq + 1)
    let m = RE_TITLE_KEY.exec(rawKey)
    if (m) {
      addEntry(titles, m[1], suffixOf(rawKey), value)
      continue
    }
    m = RE_DESC_KEY.exec(rawKey)
    if (m) addEntry(descs, m[1], suffixOf(rawKey), value)
  }
}

export function rebuild(settings: AppSettings): ContractDataStatus {
  byTitle = new Map()
  knownNorms = []
  sources = candidatePaths(settings.gameLogPath, settings.contractsDataPath)

  const titles = new Map<string, Entry[]>()
  const descs = new Map<string, Entry[]>()
  for (const f of sources) parseFile(f, titles, descs)

  for (const [base, titleList] of titles) {
    const descList = descs.get(base) ?? []
    for (const t of titleList) {
      // skip templates and placeholder stubs
      if (/~mission\(/i.test(t.value) || /^\s*\[PH\]/i.test(t.value)) continue
      const title = cleanTitle(t.value)
      if (!title) continue
      // match desc by suffix, else first
      const desc = (descList.find((d) => d.suffix === t.suffix) ?? descList[0])?.value ?? ''
      const blueprints = extractBlueprints(desc)
      const info: ContractInfo = {
        title,
        blueprints,
        reputation: extractReputation(t.value, desc),
        maxBoxSize: extractMaxBox(desc)
      }
      const norm = normalize(title)
      if (!norm) continue
      // on collision keep whichever has blueprints
      const existing = byTitle.get(norm)
      if (!existing || (!existing.blueprints.length && blueprints.length)) {
        if (!existing) knownNorms.push(norm)
        byTitle.set(norm, info)
      }
    }
  }

  return status()
}

export function status(): ContractDataStatus {
  let blueprintContracts = 0
  for (const info of byTitle.values()) if (info.blueprints.length) blueprintContracts++
  return {
    active: byTitle.size > 0,
    source: sources.length ? sources.join(' + ') : null,
    titles: byTitle.size,
    blueprintContracts
  }
}

export function lookupByTitle(rawTitle: string): ContractInfo | null {
  if (byTitle.size === 0) return null
  const norm = normalize(cleanTitle(rawTitle))
  if (!norm) return null
  const direct = byTitle.get(norm)
  if (direct) return direct
  // high threshold so noise resolves without false matches
  const res = bestMatch(norm, knownNorms, { threshold: 0.92, limit: 1 })
  return res.match ? byTitle.get(res.match) ?? null : null
}

export function enrichAccepted(e: ContractAcceptedEvent): ContractAcceptedEvent {
  const info = lookupByTitle(e.title)
  if (!info) return e
  return {
    ...e,
    blueprints: info.blueprints.length ? info.blueprints : e.blueprints,
    reputation: info.reputation ?? e.reputation,
    maxBoxSize: info.maxBoxSize ?? e.maxBoxSize
  }
}
