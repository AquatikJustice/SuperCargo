import { bestMatch, normalize } from './fuzzy'
import type { Commodity, MatchResult } from './types'

// StarStrings "[!] Maze"; ocr reads ! as 1/l/I
export function stripMarkup(raw: string): string {
  return raw
    .replace(/<\/?EM\d*>/gi, '')
    .replace(/^\s*[[(][!1lI|][\])]\s*/, '')
    .trim()
}

/** roster name for a logged commodity, whichever string set wrote it */
export function commodityName(raw: string, commodities: Commodity[]): string {
  const s = stripMarkup(raw)
  const n = normalize(s)
  const hit =
    commodities.find((c) => normalize(c.name) === n) ??
    commodities.find((c) => c.aliases?.some((a) => normalize(a) === n))
  return hit?.name ?? s
}

export function matchCommodity(raw: string, commodities: Commodity[]): MatchResult {
  const owner = new Map<string, string>()
  for (const c of commodities) {
    owner.set(c.name, c.name)
    for (const a of c.aliases ?? []) if (!owner.has(a)) owner.set(a, c.name)
  }
  const m = bestMatch(stripMarkup(raw), [...owner.keys()])
  return {
    input: raw.trim(),
    match: m.match ? (owner.get(m.match) ?? m.match) : null,
    score: m.score,
    suggestions: [...new Set(m.suggestions.map((s) => owner.get(s) ?? s))]
  }
}
