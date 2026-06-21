// Optional StarStrings contract-data layer (main process).
//
// StarStrings (a loose-file localization mod) adds the blueprints a contract can
// award, its reputation, and (for recover-cargo jobs) the max box size to the
// game's contract strings. This module finds the user's LOCAL localization files
// next to their Game.log, parses the named-contract title->detail mapping, and
// fills in accepted contracts by matching on title text.
//
// This is optional extra data: if no file is found (vanilla install, or org-mates
// who don't run StarStrings), every lookup returns null and the app still works.
// We never bundle or redistribute CIG/StarStrings text. Only the user's local
// copy is read, on their machine.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { cleanTitle } from '@shared/contract'
import { normalize, bestMatch } from '@shared/fuzzy'
import type { AppSettings, ContractAcceptedEvent, ContractDataStatus } from '@shared/types'

export interface ContractInfo {
  /** Cleaned, player-visible title (source of the match key). */
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

// ---- module state ----------------------------------------------------------

let byTitle = new Map<string, ContractInfo>()
let knownNorms: string[] = []
let sources: string[] = []

// ---- locating the files -----------------------------------------------------

function candidatePaths(gameLogPath: string, override: string): string[] {
  const out: string[] = []
  if (override) out.push(override)
  if (gameLogPath) {
    const dir = path.dirname(gameLogPath)
    // SC loads loose files from lowercase `data\`; include `Data\` as a fallback.
    for (const d of ['data', 'Data']) {
      const base = path.join(dir, d, 'Localization', 'english')
      // global.ini first so a StarStrings-enriched contracts.ini overrides it.
      out.push(path.join(base, 'global.ini'))
      out.push(path.join(base, 'contracts.ini'))
    }
  }
  return out.filter((p, i, a) => a.indexOf(p) === i).filter((p) => fs.existsSync(p))
}

// ---- parsing ----------------------------------------------------------------

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

/** Parse one .ini file, accumulating Title/Desc entries by base key. */
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
    const rawKey = line.slice(0, eq).replace(/,\w+$/, '').trim() // drop ",P" plural tag
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

/** (Re)build the title->info index from the user's local localization files. */
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
      // Skip generic templates and placeholder stubs. Those
      // procedurally-generated hauls carry the [BP] marker but no named details.
      if (/~mission\(/i.test(t.value) || /^\s*\[PH\]/i.test(t.value)) continue
      const title = cleanTitle(t.value)
      if (!title) continue
      // Prefer a desc with the matching numeric suffix, else the first available.
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
      // On a collision, prefer an entry that actually has blueprint detail.
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

/** Look up a contract's details by its (raw or cleaned) title text. */
export function lookupByTitle(rawTitle: string): ContractInfo | null {
  if (byTitle.size === 0) return null
  const norm = normalize(cleanTitle(rawTitle))
  if (!norm) return null
  const direct = byTitle.get(norm)
  if (direct) return direct
  // High-threshold fuzzy fallback so OCR/log noise still resolves, without
  // false matches across unrelated contracts.
  const res = bestMatch(norm, knownNorms, { threshold: 0.92, limit: 1 })
  return res.match ? byTitle.get(res.match) ?? null : null
}

/** Fill in an accepted-contract event with StarStrings details, if available. */
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
