// Fuzzy string matching that catches OCR mistakes.
//
// OCR of the mobiGlas contract screen is never perfect ("Titaniurn", "Stanton 1 -
// ARC-L1"). Every recognized commodity / destination is matched back against the
// official UEXcorp lists, so a near-miss read still lands on the right entry.
//
// No dependencies and no side effects, so both the main process (during a capture)
// and the renderer (when the user corrects a field) can use it.

import type { MatchResult } from './types'

/** Lowercase, collapse whitespace, and drop the stray punctuation OCR adds. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein edit distance between two strings. */
export function editDistance(a: string, b: string): number {
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
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length]
}

// Characters OCR routinely swaps for one another. A substitution within a group
// costs a fraction of a normal edit, so a read like "Baljini" still lands hard on
// "Baijini" (the lone i<->l swap barely dents the score).
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

/** Edit distance that treats OCR look-alike swaps (i/l/1, o/0, s/5) as cheap. */
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

/** 0..1 similarity (1 = identical) derived from normalized edit distance. */
export function similarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na && !nb) return 1
  if (!na || !nb) return 0
  if (na === nb) return 1

  const dist = confusableDistance(na, nb)
  const longest = Math.max(na.length, nb.length)
  let score = 1 - dist / longest

  // Boost the score when one string contains the other. OCR often grabs a longer
  // line that still holds the real name (or the reverse), e.g. "deliver to hur l1"
  // vs "hur-l1".
  if (na.includes(nb) || nb.includes(na)) {
    score = Math.max(score, 0.85)
  }
  return score
}

export interface MatchOptions {
  /** Minimum similarity to accept as a confident match. Default 0.62. */
  threshold?: number
  /** How many ranked suggestions to return. Default 5. */
  limit?: number
}

/**
 * Match a raw OCR token against a list of known names. Returns the best match
 * (or null if nothing clears the threshold) plus ranked suggestions for a
 * correction dropdown.
 */
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
