// parse contract text to objectives; fuzzy matching is a separate step (fuzzy.ts)

import { bestMatch, similarity } from './fuzzy'
import type { Commodity, Location, MatchResult, OcrObjective, OcrWord } from './types'

export interface RawObjective {
  commodity: string
  scuAmount: number
  destination: string
  pickups?: string[]
}

export interface ParsedOcr {
  objectives: RawObjective[]
  maxBoxSize?: number
  reward?: number
}

// ocr slash look-alikes; one separator so digit count disambiguates total
const FRAC = '[\\/71|lI]'
// group 1 is the total, not the done count
const RE_DELIVER_TO = new RegExp(`deliver\\s+\\d+?\\s*${FRAC}\\s*(\\d+)\\s*scu\\s+of\\s+(.+?)\\s+to\\s+([^.\\n]+)`, 'gi')
const RE_DELIVERED_TO = /(\d+)\s*scu\s+of\s+(.+?)\s+delivered\s+to\s+([^.\n]+)/gi
const RE_GENERIC = /(\d+)\s*scu\s+of\s+(.+?)\s+to\s+([^.\n]+)/gi
// commodity is the line above
const RE_PANEL_LINE = new RegExp(`^(.+?):\\s*\\d+?\\s*${FRAC}\\s*(\\d+)\\s*scu\\b`, 'i')
// never a commodity name
const RE_NOISE_LINE = /scu|deliver|collect|objective|reward|elevator|^\s*[-•]/i
const RE_COLLECT = /collect\s+(.+?)\s+from\s+(.+)/gi

// box-size wording, most specific first
const BOX_PATTERNS = [
  // most reliable, so check first
  /(\d+)\s*scu\s+(?:cargo\s+)?containers?/i,
  /(?:all\s+)?(\d+)\s*scu\s+or\s+smaller/i,
  /max(?:imum)?\s+(?:container|box)[^0-9]{0,24}(\d+)\s*scu/i,
  /(?:be|will\s+be)\s+(\d+)\s*scu/i
]

const BOX_SIZES = [1, 2, 4, 8, 16, 24, 32]

// no spaces, so it can't bridge two figures
const NUM = '([0-9][0-9.,]*[0-9]|[0-9])'
// lenient for ocr slop: rewarc / rewerd / rewald
const REWARD_LABEL = 'rew[ae][rl][a-z]?'
const RE_REWARD_LABEL_CUR = new RegExp(`${REWARD_LABEL}[^0-9]{0,18}${NUM}\\s*a?\\s*u\\s?ec`, 'i')
// grouping or 4+ digits, so a stray scu count can't win
const RE_REWARD_LABEL_NUM = new RegExp(
  `${REWARD_LABEL}[^0-9]{0,18}([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,})`,
  'i'
)
const RE_AUEC = new RegExp(`${NUM}\\s*a?\\s*u\\s?ec`, 'gi')
const RE_AUEC_PRE = new RegExp(`a?\\s*u\\s?ec\\s*${NUM}`, 'gi')
// last resort: biggest money-shaped figure, not a fraction or scu count
const RE_MONEY = /(?<![\d/.,])(\d{1,3}(?:[.,]\d{3})+|\d{5,})(?!\s*\/)(?!\s*scu)/gi

function toAmount(s: string): number {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** pull reward (aUEC), most reliable signal first */
export function parseReward(text: string): number | undefined {
  for (const re of [RE_REWARD_LABEL_CUR, RE_REWARD_LABEL_NUM]) {
    const m = re.exec(text)
    if (m) {
      const n = toAmount(m[1])
      if (n > 0) return n
    }
  }
  let best = 0
  for (const re of [RE_AUEC, RE_AUEC_PRE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const n = toAmount(m[1])
      if (n > best) best = n
    }
  }
  if (best > 0) return best
  RE_MONEY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE_MONEY.exec(text)) !== null) {
    const n = toAmount(m[1])
    if (n > best) best = n
  }
  return best > 0 ? best : undefined
}

// body name -> station-code prefix, see normalizeDestination
const BODY_CODE: Record<string, string> = {
  hurston: 'HUR',
  crusader: 'CRU',
  arccorp: 'ARC',
  microtech: 'MIC',
  pyro: 'PYR'
}
// long lagrange address form, lenient for ocr noise.
// lag digit as one char since L5 reads as LS (see lagDigit)
const RE_LAGRANGE_ADDRESS =
  /^(.+?)\s+at\s+(hurston|crusader|arccorp|micro\s?tech|pyro)['']?\s*s?\s+L\s?([1-5sSiIlLzZaA])\s+lagrange\s+point/i

/** map a lag glyph or its ocr look-alike to 1-5 */
function lagDigit(ch: string): string | null {
  switch (ch.toLowerCase()) {
    case '1':
    case 'i':
    case 'l':
      return '1'
    case '2':
    case 'z':
      return '2'
    case '3':
      return '3'
    case '4':
    case 'a':
      return '4'
    case '5':
    case 's':
      return '5'
    default:
      return null
  }
}

// drop a trailing sentence (". " + capital), keep "Inc." (". " + lowercase)
function cutSentence(s: string): string {
  return s.replace(/\.\s+[A-Z].*$/s, '')
}

function cleanFragment(s: string): string {
  return s
    .replace(/<\/?EM[^>]*>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[•·|>]+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim()
}

// cut at the first trailing ui/prose word.
// "c?ontract" since ocr drops the leading C of "Contractor"
const DEST_TAIL =
  /\b(?:rewar\w*|accept\w*|abandon\w*|share\w*|a?uec|scu|collect|deliver\w*|objective\w*|complete\w*|active|tracked|c?ontract\w*|mission\w*|location|for\s+(?:you|a|an|the)|is\s+(?:a|an|the))\b/i

// drop a trailing "on <body>"/"above" suffix.
// "on" scoped to a body so it can't eat a real "... on ..." location
const DEST_BODY_SUFFIX =
  /\s+(?:on\s+(?:hurston|crusader|arccorp|micro\s?tech|pyro|magnus|terra|nyx|stanton)|above)\b.*$/i

// mission flavor words; none appear in a real location name, so they mean the
// destination capture ran into the details prose
const DEST_PROSE =
  /\b(?:seems|like|currently|whatever|smaller|cargo|separated|delivered|spots?|encourage|contractors?|please|expect|greetings|thanks|prompt|anything|anywhere|folks|waiting|distributed)\b/i

// cut at the suffix word so wrapped prose isn't appended.
// trailing pad code (e.g. "Depot S4LD01") is kept
const STATION_SUFFIX =
  /\b(?:station|spaceport|outpost|depot|harbou?r|hub|gateway|complex|platform|plant|refinery|processing|workcenter|cent(?:er|re))\b/i
const PAD_CODE = /^\s+[A-Z0-9][A-Z0-9-]{1,7}\b/

function anchorToStation(s: string): string {
  const m = STATION_SUFFIX.exec(s)
  if (!m) return s
  const end = m.index + m[0].length
  const after = s.slice(end)
  // leave lagrange form intact for normalizeDestination to rebuild the code
  if (/^\s+at\s/i.test(after)) return s
  // keep the body qualifier, it's the disambiguator not prose
  if (/^\s+on\s+\S/i.test(after)) return s
  const pad = PAD_CODE.exec(after)
  return s.slice(0, end + (pad ? pad[0].length : 0))
}

function trimDestinationTail(s: string): string {
  return anchorToStation(
    s.split(DEST_TAIL)[0].replace(DEST_BODY_SUFFIX, '')
  )
    // trailing reward, no keyword: grouped / 4+ only, so "L1"/"Area18" survive
    .replace(/\s+\d{1,3}(?:[.,]\d{3})+\s*$/g, '')
    .replace(/\s+\d{4,}\s*$/g, '')
    .replace(/[\s,;:.\-•·|>]+$/g, '')
    .trim()
}

/** rebuild the leading "HUR-L1 ..." code from a long lagrange address */
function normalizeDestination(dest: string): string {
  const m = RE_LAGRANGE_ADDRESS.exec(dest)
  if (!m) return dest
  const station = m[1].trim()
  const body = BODY_CODE[m[2].replace(/\s+/g, '').toLowerCase()]
  const lag = lagDigit(m[3])
  // bare station name still fuzzy-matches; never the raw run
  if (body && lag) return `${body}-L${lag} ${station}`
  return station || dest
}

function snapBoxSize(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined
  let best = BOX_SIZES[0]
  for (const s of BOX_SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return best
}

// the contract panel is two columns (details | objectives) and the engine
// sometimes reads across them, fouling the parse. rebuild the text from word
// boxes: split at the emptiest middle band, read each column top to bottom.
export function reorderColumns(words: OcrWord[]): string | null {
  if (words.length < 6) return null
  const maxX = Math.max(...words.map((w) => w.x1))
  if (maxX <= 0) return null
  const avgHeight = words.reduce((s, w) => s + (w.y1 - w.y0), 0) / words.length

  const cols = 40
  const density = new Array(cols).fill(0)
  for (const w of words) density[Math.min(cols - 1, Math.floor((w.x0 / maxX) * cols))]++
  let split = -1
  let lowest = Infinity
  for (let i = Math.floor(cols * 0.34); i <= Math.floor(cols * 0.62); i++) {
    if (density[i] < lowest) {
      lowest = density[i]
      split = i
    }
  }
  const gutter = (split / cols) * maxX

  const lines: string[] = []
  for (const inColumn of [(w: OcrWord) => w.x0 < gutter, (w: OcrWord) => w.x0 >= gutter]) {
    const col = words.filter(inColumn).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    let row: OcrWord[] = []
    let lastY: number | null = null
    const flush = (): void => {
      if (row.length) lines.push(row.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' '))
      row = []
    }
    for (const w of col) {
      if (lastY !== null && w.y0 - lastY > avgHeight * 0.6) flush()
      row.push(w)
      lastY = w.y0
    }
    flush()
  }
  return lines.join('\n')
}

export function parseOcrText(rawText: string): ParsedOcr {
  const text = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const found: RawObjective[] = []
  const seen = new Set<string>()

  const add = (commodityRaw: string, scuAmount: number, destinationRaw: string): void => {
    const commodity = cleanFragment(commodityRaw)
    const destination = normalizeDestination(trimDestinationTail(cleanFragment(destinationRaw)))
    if (!commodity || !destination || !Number.isFinite(scuAmount) || scuAmount <= 0) return
    // drop over-captured prose: a real destination never spans another "to"/"from"
    // nor carries mission flavor words, so those mean we ran past the real name
    if (/\b(?:to|from)\b/i.test(destination) || DEST_PROSE.test(destination)) return
    const key = `${commodity.toLowerCase()}|${destination.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ commodity, scuAmount, destination })
  }

  // panel format: "<dest>: <n>/<total> SCU", commodity on the line before
  const lines = text.split('\n').map((l) => l.trim())
  for (let i = 0; i < lines.length; i++) {
    const m = RE_PANEL_LINE.exec(lines[i])
    if (!m) continue
    // nearest commodity line above
    let commodity = ''
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      if (lines[j] && !RE_NOISE_LINE.test(lines[j])) {
        commodity = lines[j]
        break
      }
    }
    if (commodity) add(commodity, parseInt(m[2], 10), m[1])
  }

  // re-break before each keyword so a wrapped destination isn't cut at the newline
  const inlineText = text
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s(?=(?:deliver\b|collect\b|\d+\s*scu))/gi, '\n')
  const collect = (re: RegExp, amtIdx: number, comIdx: number, dstIdx: number): void => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(inlineText)) !== null) add(m[comIdx], parseInt(m[amtIdx], 10), m[dstIdx])
  }
  collect(RE_DELIVER_TO, 1, 2, 3)
  collect(RE_DELIVERED_TO, 1, 2, 3)
  collect(RE_GENERIC, 1, 2, 3)

  // group pickups by commodity; inlineText already broke before each "Collect"
  // so the location capture stops at the next leg
  const pickupsByCommodity = new Map<string, string[]>()
  RE_COLLECT.lastIndex = 0
  let pm: RegExpExecArray | null
  while ((pm = RE_COLLECT.exec(inlineText)) !== null) {
    const commodity = cleanFragment(pm[1])
    const pickup = normalizeDestination(trimDestinationTail(cleanFragment(cutSentence(pm[2]))))
    if (!commodity || !pickup) continue
    const key = commodity.toLowerCase()
    const arr = pickupsByCommodity.get(key) ?? []
    if (!arr.some((p) => p.toLowerCase() === pickup.toLowerCase())) arr.push(pickup)
    pickupsByCommodity.set(key, arr)
  }
  for (const o of found) {
    const ps = pickupsByCommodity.get(o.commodity.toLowerCase())
    if (ps && ps.length) o.pickups = ps
  }

  let maxBoxSize: number | undefined
  for (const re of BOX_PATTERNS) {
    const m = re.exec(text)
    if (m) {
      maxBoxSize = snapBoxSize(parseInt(m[1], 10))
      if (maxBoxSize) break
    }
  }

  return { objectives: found, maxBoxSize, reward: parseReward(text) }
}

// collapse pickups that resolve to the same place; raw-string dedup misses these
// when ocr reads the same line slightly differently across legs
function dedupePickups(ps?: MatchResult[]): MatchResult[] | undefined {
  if (!ps || !ps.length) return ps
  const seen = new Set<string>()
  const out: MatchResult[] = []
  for (const p of ps) {
    const key = (p.match ?? p.input).trim().toLowerCase()
    if (key && !seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

// trailing "on <body>", captured so operator+body picks the facility
const ON_BODY = /\bon\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 ]*?)\s*$/i
// operator brand from "the <Company>, Inc. outpost ..."
const OP_HEAD = /^(?:the\s+)?(.+?)(?:[,.]?\s*(?:inc|corp|ltd|co)\b|\s+outpost\b|[,.]|$)/i

// structural words shared across names; never used as an anchor
const ANCHOR_STOP = new Set([
  'station', 'outpost', 'depot', 'harbor', 'harbour', 'hub', 'gateway', 'complex',
  'platform', 'plant', 'refinery', 'processing', 'workcenter', 'center', 'centre',
  'point', 'port', 'mining', 'area', 'distribution', 'orbital', 'space', 'city',
  'hurston', 'crusader', 'arccorp', 'microtech', 'micro', 'tech', 'pyro', 'magnus',
  'terra', 'nyx', 'stanton', 'lagrange', 'the', 'and', 'hur', 'cru', 'arc', 'mic', 'pyr'
])

function anchorTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !ANCHOR_STOP.has(t))
}

interface AnchorIndex {
  unigram: Map<string, string>
  bigram: Map<string, string>
}
let anchorCache: { locs: Location[]; idx: AnchorIndex } | null = null

// token/pair -> location, only when unique to one
function anchorIndex(locations: Location[]): AnchorIndex {
  if (anchorCache && anchorCache.locs === locations) return anchorCache.idx
  const uni = new Map<string, Set<string>>()
  const bi = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, key: string, name: string): void => {
    const set = m.get(key)
    if (set) set.add(name)
    else m.set(key, new Set([name]))
  }
  for (const l of locations) {
    const toks = anchorTokens(l.name)
    for (const t of toks) add(uni, t, l.name)
    for (let i = 0; i + 1 < toks.length; i++) add(bi, `${toks[i]} ${toks[i + 1]}`, l.name)
  }
  const unique = (m: Map<string, Set<string>>): Map<string, string> => {
    const out = new Map<string, string>()
    for (const [k, set] of m) if (set.size === 1) out.set(k, [...set][0])
    return out
  }
  const idx = { unigram: unique(uni), bigram: unique(bi) }
  anchorCache = { locs: locations, idx }
  return idx
}

// pin a location by a distinctive word; bigrams first, then tokens.
// fuzzy only for long tokens so a near-hit isn't chance. null => defer
function anchorMatch(input: string, locations: Location[]): { name: string; score: number } | null {
  const idx = anchorIndex(locations)
  const toks = anchorTokens(input)
  if (!toks.length) return null
  for (let i = 0; i + 1 < toks.length; i++) {
    const name = idx.bigram.get(`${toks[i]} ${toks[i + 1]}`)
    if (name) return { name, score: 0.97 }
  }
  let best: { name: string; score: number } | null = null
  for (const t of toks) {
    const exact = idx.unigram.get(t)
    if (exact) return { name: exact, score: 0.95 }
    if (t.length < 5) continue
    for (const [anchor, name] of idx.unigram) {
      if (Math.abs(anchor.length - t.length) > 2) continue
      const s = similarity(anchor, t)
      if (s >= 0.82 && (!best || s > best.score)) best = { name, score: 0.8 * s }
    }
  }
  return best
}

/** resolve a string to a known location; falls back to operator+body */
export function resolveLocation(raw: string, locations: Location[]): MatchResult {
  const names = locations.map((l) => l.name)
  const input = raw.trim()
  const bm = ON_BODY.exec(input)
  const bodyHint = bm ? bm[1].trim() : ''
  const core = bm ? input.slice(0, bm.index).trim() : input

  // prefer operator+body; a loose name match can latch onto a facility
  // named after the operator
  if (bodyHint) {
    const onBody = locations.filter((l) => l.body && similarity(l.body, bodyHint) >= 0.8)
    if (onBody.length) {
      const opm = OP_HEAD.exec(core)
      const opHint = opm ? opm[1].trim() : ''
      if (opHint) {
        const ranked = onBody
          .map((l) => ({ l, s: l.operator ? similarity(l.operator, opHint) : 0 }))
          .sort((a, b) => b.s - a.s)
        if (ranked[0] && ranked[0].s >= 0.6)
          return {
            input,
            match: ranked[0].l.name,
            score: Math.max(0.85, ranked[0].s),
            suggestions: onBody.slice(0, 5).map((l) => l.name)
          }
      }
      // no operator to choose by: name match limited to that body
      const inBody = bestMatch(core, onBody.map((l) => l.name))
      if (inBody.match) return { ...inBody, input }
      if (onBody.length === 1)
        return { input, match: onBody[0].name, score: 0.85, suggestions: onBody.slice(0, 5).map((l) => l.name) }
      // ambiguous, let the user pick
      return { input, match: null, score: 0, suggestions: onBody.slice(0, 5).map((l) => l.name) }
    }
    // body not in our data: plain name match, else don't guess
    const direct = bestMatch(core, names)
    if (direct.match) return { ...direct, input }
    return { input, match: null, score: 0, suggestions: bestMatch(input, names).suggestions }
  }

  // no body qualifier: anchor on a distinctive word, else whole-string fuzzy
  const anchor = anchorMatch(input, locations)
  if (anchor) return { input, match: anchor.name, score: anchor.score, suggestions: [anchor.name] }
  return bestMatch(input, names)
}

/** fuzzy-match parsed objectives against the uex lists */
export function matchObjectives(
  raw: RawObjective[],
  commodities: Commodity[],
  locations: Location[]
): OcrObjective[] {
  const commodityNames = commodities.map((c) => c.name)
  return raw.map((o) => ({
    commodity: bestMatch(o.commodity, commodityNames),
    scuAmount: o.scuAmount,
    destination: resolveLocation(o.destination, locations),
    pickups: dedupePickups(o.pickups?.map((p) => resolveLocation(p, locations)))
  }))
}
