// Parse recognized contract-screen text into structured delivery objectives.
//
// The patterns below come from the GAME'S OWN objective templates, pulled
// from Data.p4k -> Data/Localization/english/global.ini (the same source the
// community localization / StarStrings projects use). Using the real format
// strings (not guesses) is what makes parsing reliable. Reference keys:
//
//   HaulCargo_obj_itemspecifics      = "~mission(item)\n~mission(destination): ~mission(amount)/~mission(total) SCU"
//   HaulCargo_obj_itemspecifics_01,P = "Deliver ~mission(amount)/~mission(total) SCU of ~mission(item) to ~mission(Destination|ListAll)"
//   hauling_deliver_resource_objective = "Deliver ~mission(amount)/~mission(total) SCU of ~mission(item) to ~mission(Destination|Address|ListAll)."
//   hauling_delivery_unlimited_objective,P = "~mission(amount) SCU of ~mission(item) Delivered to ~mission(Destination|ListAll)"
//   hauling_return_resource_objective,P    = "Deliver ~mission(amount)/~mission(total) SCU of ~mission(item)."
//   (box size, from CFP_RecoverCargo desc) = "...carry ~mission(MissionMaxSCUSize) cargo containers"
//
// Commodity / destination strings come out raw here; fuzzy matching against the
// UEX lists (see fuzzy.ts) happens as a separate step so this stays list-free.

import { bestMatch } from './fuzzy'
import type { Commodity, Location, OcrObjective } from './types'

export interface RawObjective {
  commodity: string
  scuAmount: number
  destination: string
  /** Where this leg loads, from "Collect <item> from <location>" lines. A delivery
   *  can have several. */
  pickups?: string[]
}

export interface ParsedOcr {
  objectives: RawObjective[]
  maxBoxSize?: number
  /** Full contract reward in aUEC, when the panel text included it. */
  reward?: number
}

// The "done/total" slash is one of OCR's worst glyphs: a freshly accepted "0/21"
// routinely comes back "0721" (slash read as 7) or "0|21" / "0l21" / "0I21". So
// the fraction separator allows those look-alikes. It still consumes exactly one
// separator char between done and total, so the digit count disambiguates: "0721"
// -> total 21, "07721" -> total 721.
const FRAC = '[\\/71|lI]'
// Inline "Deliver <n>/<total> SCU of <item> to <dest>" (itemspecifics_01 /
// deliver_resource). The amount we want is the TOTAL required (group 1).
const RE_DELIVER_TO = new RegExp(`deliver\\s+\\d+?\\s*${FRAC}\\s*(\\d+)\\s*scu\\s+of\\s+(.+?)\\s+to\\s+([^.\\n]+)`, 'gi')
// "<n> SCU of <item> Delivered to <dest>" (delivery_unlimited).
const RE_DELIVERED_TO = /(\d+)\s*scu\s+of\s+(.+?)\s+delivered\s+to\s+([^.\n]+)/gi
// Generic fallback "<n> SCU of <item> to <dest>".
const RE_GENERIC = /(\d+)\s*scu\s+of\s+(.+?)\s+to\s+([^.\n]+)/gi
// Panel line "<destination>: <n>/<total> SCU", commodity is the line above it.
const RE_PANEL_LINE = new RegExp(`^(.+?):\\s*\\d+?\\s*${FRAC}\\s*(\\d+)\\s*scu\\b`, 'i')
// A line we should never treat as a commodity name when scanning upward.
const RE_NOISE_LINE = /scu|deliver|collect|objective|reward|elevator|^\s*[-•]/i
// "Collect <item> from <location>" - the game's hauling_collect_objective. Gives
// each leg its pickup(s); a delivery can have several (many-pickups-to-one-drop).
const RE_COLLECT = /collect\s+(.+?)\s+from\s+([^.\n]+)/gi

// Max-box-size wording, from the game's own ~mission(MaxBoxSize) / MissionMaxSCUSize
// templates (Data.p4k + StarStrings contracts.ini), most specific first:
//   "...cargo boxes (all 16 SCU or smaller)"   <- recover-cargo descriptions
//   "...carry 32 SCU cargo containers"          <- CFP recover descriptions
//   "maximum container size 16 SCU" / "will be 16 SCU"
const BOX_PATTERNS = [
  // "<n> SCU container(s)" / "<n> SCU cargo container(s)", e.g. the Covalex
  // flavour text "(8 SCU containers or smaller)". Most reliable, so check first.
  /(\d+)\s*scu\s+(?:cargo\s+)?containers?/i,
  // "(all 16 SCU or smaller)" / "16 SCU or smaller"
  /(?:all\s+)?(\d+)\s*scu\s+or\s+smaller/i,
  // "maximum container size 16 SCU" / "max box 16 SCU"
  /max(?:imum)?\s+(?:container|box)[^0-9]{0,24}(\d+)\s*scu/i,
  // "...will be 16 SCU"
  /(?:be|will\s+be)\s+(\d+)\s*scu/i
]

const BOX_SIZES = [1, 2, 4, 8, 16, 24, 32]

// Contract reward, shown top-right of the contract as "<n> aUEC" (often with a
// "Reward" label). Thousands are comma-separated in-game ("88,500"); we strip all
// non-digits from the captured number, so periods/commas are fine. The currency
// token is kept lenient for OCR noise ("aUEC", "a UEC", "auEC"). The number class
// deliberately excludes spaces so it can't bridge two unrelated figures into one.
const NUM = '([0-9][0-9.,]*[0-9]|[0-9])'
// "Reward" (lenient for OCR slop: rewarc / rewerd / rewald) then the amount,
// optionally followed by the currency token. The number class excludes spaces so
// it can't bridge two unrelated figures.
const REWARD_LABEL = 'rew[ae][rl][a-z]?'
const RE_REWARD_LABEL_CUR = new RegExp(`${REWARD_LABEL}[^0-9]{0,18}${NUM}\\s*a?\\s*u\\s?ec`, 'i')
// Fallback: a number next to "Reward" WITHOUT a readable currency token. The
// reward often shows next to a coin icon OCR can't read. Require comma-grouping
// or 4+ digits so a small stray number (an SCU count, an index) can't win.
const RE_REWARD_LABEL_NUM = new RegExp(
  `${REWARD_LABEL}[^0-9]{0,18}([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,})`,
  'i'
)
const RE_AUEC = new RegExp(`${NUM}\\s*a?\\s*u\\s?ec`, 'gi')
// Currency-first form, e.g. "aUEC 88,500".
const RE_AUEC_PRE = new RegExp(`a?\\s*u\\s?ec\\s*${NUM}`, 'gi')
// Last resort when neither the "Reward" label nor an aUEC token survives OCR (the
// reward sits next to a coin glyph that often eats the label, so the number can be
// the only readable part, e.g. "a 325,250"). Find the largest money-shaped figure:
// a comma/period-grouped thousands value (88,500 / 325.250) or a bare 5+ digit run.
// Guard against an objective amount sneaking in: not part of a longer number, not
// an "n/total" fraction, not glued to "SCU".
const RE_MONEY = /(?<![\d/.,])(\d{1,3}(?:[.,]\d{3})+|\d{5,})(?!\s*\/)(?!\s*scu)/gi

function toAmount(s: string): number {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** Pull the contract reward (aUEC) from the panel text. In priority order:
 *  1) a value next to "Reward" with the aUEC token, 2) a (comma-grouped / 4+ digit)
 *  value next to "Reward" alone (the currency may be a coin icon OCR can't read),
 *  3) the largest "<n> aUEC" figure, 4) the largest money-shaped number anywhere
 *  (label and currency both lost to OCR). Returns undefined when nothing plausible
 *  was read. */
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

// Body name -> station-code prefix, for rebuilding a code from the long
// "Address|ListAll" destination form (see normalizeDestination).
const BODY_CODE: Record<string, string> = {
  hurston: 'HUR',
  crusader: 'CRU',
  arccorp: 'ARC',
  microtech: 'MIC',
  pyro: 'PYR'
}
// "<Station> at <Body>'s L<n> Lagrange point", the descriptive destination the
// panel shows instead of "HUR-L1 <Station>". Apostrophe/spacing kept lenient for
// OCR noise (straight/curly quote, dropped apostrophe, "micro tech", "L 1"). The
// Lagrange digit is captured as one char and OCR-confusable letters are mapped
// back to digits (see lagDigit), e.g. "L5" is routinely misread as "LS".
const RE_LAGRANGE_ADDRESS =
  /^(.+?)\s+at\s+(hurston|crusader|arccorp|micro\s?tech|pyro)['']?\s*s?\s+L\s?([1-5sSiIlLzZaA])\s+lagrange\s+point/i

/** Map a Lagrange-point glyph (digit, or its common OCR look-alike letter) to 1-5. */
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

function cleanFragment(s: string): string {
  return s
    .replace(/<\/?EM[^>]*>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[•·|>]+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim()
}

// Trailing junk OCR sweeps onto the destination: the Reward/Accept UI, the
// currency, the next objective's verb, status words, or a stray amount. A real
// freight location never contains these, so cut the destination at the first one.
// Otherwise fuzzy matching sees a whole sentence and can't place it.
const DEST_TAIL =
  /\b(?:rewar\w*|accept\w*|abandon\w*|share\w*|a?uec|scu|collect|deliver\w*|objective\w*|complete\w*|active|tracked|contract\w*|mission\w*|location|for\s+you)\b/i

// Two body suffixes the panel tacks onto a destination that aren't part of the
// location name and block the match:
//   "...to HDPC-Farnesway on Hurston."          (distribution centers)
//   "...to Baijini Point above ArcCorp"         (bulk "from <x>" letter contracts)
// Drop from the suffix on. "on" is scoped to a body name so it can't eat a real
// "... on ..." location; "above" is always junk here (no freight name contains it).
// The Lagrange form ("...at Hurston's L5 Lagrange point") uses "at <body>'s", so
// neither branch touches it.
const DEST_BODY_SUFFIX =
  /\s+(?:on\s+(?:hurston|crusader|arccorp|micro\s?tech|pyro|magnus|terra|nyx|stanton)|above)\b.*$/i

// Real freight names end in one of these. When a destination soft-wraps without a
// period, OCR runs the next line's letter prose straight onto it ("Green Glade
// Station The folks at Everus Harbor..."). Cut at the first suffix so fuzzy matching
// sees the name, not a sentence. A trailing pad code (e.g. "Depot S4LD01") is kept.
const STATION_SUFFIX =
  /\b(?:station|outpost|depot|harbou?r|hub|gateway|complex|platform|plant|refinery|processing|workcenter|cent(?:er|re))\b/i
const PAD_CODE = /^\s+[A-Z0-9][A-Z0-9-]{1,7}\b/

function anchorToStation(s: string): string {
  const m = STATION_SUFFIX.exec(s)
  if (!m) return s
  const end = m.index + m[0].length
  const after = s.slice(end)
  // Leave the Lagrange address form intact ("... Station at Hurston's L1 ...") so
  // normalizeDestination can rebuild the code from it.
  if (/^\s+at\s/i.test(after)) return s
  const pad = PAD_CODE.exec(after)
  return s.slice(0, end + (pad ? pad[0].length : 0))
}

function trimDestinationTail(s: string): string {
  return anchorToStation(
    s.split(DEST_TAIL)[0].replace(DEST_BODY_SUFFIX, '')
  )
    // a trailing amount (reward) with no keyword: only comma-grouped / 4+ digits,
    // so a real "L1"/"Area18"-style number isn't stripped.
    .replace(/\s+\d{1,3}(?:[.,]\d{3})+\s*$/g, '')
    .replace(/\s+\d{4,}\s*$/g, '')
    .replace(/[\s,;:.\-•·|>]+$/g, '')
    .trim()
}

/**
 * Normalize a destination into the leading-code form the rest of the app expects
 * ("HUR-L1 Green Glade Station"). Contracts that present the long Lagrange address
 * ("Green Glade Station at Hurston's L1 Lagrange point") have no code, so we
 * rebuild it from the body + Lagrange number. Anything else passes through.
 */
function normalizeDestination(dest: string): string {
  const m = RE_LAGRANGE_ADDRESS.exec(dest)
  if (!m) return dest
  const station = m[1].trim()
  const body = BODY_CODE[m[2].replace(/\s+/g, '').toLowerCase()]
  const lag = lagDigit(m[3])
  // Rebuilt code form when we have both parts, else fall back to the bare station
  // name (still fuzzy-matchable to "HUR-Ln <Station>"), never the whole raw run.
  if (body && lag) return `${body}-L${lag} ${station}`
  return station || dest
}

function snapBoxSize(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined
  let best = BOX_SIZES[0]
  for (const s of BOX_SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return best
}

export function parseOcrText(rawText: string): ParsedOcr {
  const text = rawText.replace(/\r/g, '').replace(/[ \t]+/g, ' ')
  const found: RawObjective[] = []
  const seen = new Set<string>()

  const add = (commodityRaw: string, scuAmount: number, destinationRaw: string): void => {
    const commodity = cleanFragment(commodityRaw)
    const destination = normalizeDestination(trimDestinationTail(cleanFragment(destinationRaw)))
    if (!commodity || !destination || !Number.isFinite(scuAmount) || scuAmount <= 0) return
    const key = `${commodity.toLowerCase()}|${destination.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ commodity, scuAmount, destination })
  }

  // 1) Panel format (most common in the mobiGlas detail list): a
  //    "<destination>: <n>/<total> SCU" line preceded by the commodity name.
  const lines = text.split('\n').map((l) => l.trim())
  for (let i = 0; i < lines.length; i++) {
    const m = RE_PANEL_LINE.exec(lines[i])
    if (!m) continue
    // Walk upward for the nearest plausible commodity line.
    let commodity = ''
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      if (lines[j] && !RE_NOISE_LINE.test(lines[j])) {
        commodity = lines[j]
        break
      }
    }
    if (commodity) add(commodity, parseInt(m[2], 10), m[1])
  }

  // 2) Inline formats, most specific first.
  //    The panel soft-wraps long destinations onto a second line, which would
  //    otherwise truncate the captured destination at the newline (e.g. just
  //    "Green Glade"). Rejoin into one logical line per objective by flattening
  //    newlines and re-breaking before each objective keyword, so each
  //    "Deliver ..."/"... Delivered ..." is captured whole (up to its trailing period).
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

  // Pickups: "Collect <item> from <location>" lines, grouped by commodity onto the
  // matching delivery objective. inlineText has already broken a line before each
  // "Collect", so the location capture stops at the next leg.
  const pickupsByCommodity = new Map<string, string[]>()
  RE_COLLECT.lastIndex = 0
  let pm: RegExpExecArray | null
  while ((pm = RE_COLLECT.exec(inlineText)) !== null) {
    const commodity = cleanFragment(pm[1])
    const pickup = normalizeDestination(trimDestinationTail(cleanFragment(pm[2])))
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

/** Fuzzy-match parsed objectives against the synced UEX commodity/location lists. */
export function matchObjectives(
  raw: RawObjective[],
  commodities: Commodity[],
  locations: Location[]
): OcrObjective[] {
  const commodityNames = commodities.map((c) => c.name)
  const locationNames = locations.map((l) => l.name)
  return raw.map((o) => ({
    commodity: bestMatch(o.commodity, commodityNames),
    scuAmount: o.scuAmount,
    destination: bestMatch(o.destination, locationNames),
    pickups: o.pickups?.map((p) => bestMatch(p, locationNames))
  }))
}
