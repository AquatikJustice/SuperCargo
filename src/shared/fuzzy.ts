// fuzzy match against known names

import type { MatchResult } from './types'

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// look-alikes; same-group swaps cost less
const CONFUSABLE_GROUPS = ['il1|', 'o0', 's5']
const confusableGroup = new Map<string, number>()
CONFUSABLE_GROUPS.forEach((g, i) => {
  for (const ch of g) confusableGroup.set(ch, i)
})
function subCost(a: number, b: number): number {
  if (a === b) return 0
  const ga = confusableGroup.get(String.fromCharCode(a))
  const gb = confusableGroup.get(String.fromCharCode(b))
  return ga !== undefined && ga === gb ? 0.4 : 1
}

function confusableDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = subCost(ca, b.charCodeAt(j - 1))
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length]
}

export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  if (na === nb) return 1

  const dist = confusableDistance(na, nb)
  const longest = Math.max(na.length, nb.length)
  let score = 1 - dist / longest

  // substring containment still scores high
  if (na.includes(nb) || nb.includes(na)) {
    score = Math.max(score, 0.85)
  }
  return score
}

export interface MatchOptions {
  /** default 0.62 */
  threshold?: number
  /** default 5 */
  limit?: number
}

export function bestMatch(input: string, candidates: string[], opts: MatchOptions = {}): MatchResult {
  const threshold = opts.threshold ?? 0.62
  const limit = opts.limit ?? 5
  const trimmed = input.trim()

  if (!trimmed || candidates.length === 0) {
    return { input: trimmed, match: null, score: 0, suggestions: candidates.slice(0, limit) }
  }

  const scored = candidates
    .map((c) => ({ c, s: similarity(trimmed, c) }))
    .sort((a, b) => b.s - a.s)

  const top = scored[0]
  const suggestions = scored.slice(0, limit).map((x) => x.c)

  return {
    input: trimmed,
    match: top && top.s >= threshold ? top.c : null,
    score: top ? top.s : 0,
    suggestions
  }
}
