// Parsing helpers for contract titles and template names.
//
// The "Contract Accepted" log notification carries a human title like:
//   "Senior | Medium Haul | from Everus Harbor"
//   "Expert | DIRECT Large Haul | Everus Harbor > Baijini Point"
// The CreateMarker line carries a template debugName like:
//   "HaulCargo_SingleToMulti4_Processed_Mixed_QTFuelHydroFuelShipAmmo_Stanton1_SupplyGrade1"

export interface ParsedTitle {
  rank: string
  haulType: string
  pickup: string
}

/**
 * Strip mobiGlas markup and StarStrings annotations from a title.
 * StarStrings (a loose-file localization mod) appends ` <EM4>[150 Rep] [BP]*</EM4>`
 * to contract titles to flag reputation gain and blueprint chance. Those markers
 * flow into the Game.log "Contract Accepted" line, so we clean them here.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/<\/?EM[^>]*>/gi, '') // strip <EM3>..</EM3> markup
    .replace(/\[BP\]\*?/gi, '') // strip the [BP]* blueprint marker
    .replace(/\[\s*\d+\s*rep\s*\]/gi, '') // strip the [150 Rep] reputation marker
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:]+$/, '') // drop the trailing ": " the log appends
    .trim()
}

/**
 * True when a (raw, uncleaned) title carries StarStrings' `[BP]` blueprint
 * marker, meaning completing the contract has a chance to award a blueprint.
 * Returns false on vanilla installs (no marker present).
 */
export function hasBlueprintMarker(raw: string): boolean {
  return /\[BP\]/i.test(raw)
}

// Hauling reputation tiers. Standard contracts lead with the tier ("Senior |
// Medium Haul | ..."), but named ones bury it in the contract name ("Ling Family
// Rookie Haul - ..."), so scan the whole title rather than trust the first segment.
const RANKS = ['Trainee', 'Rookie', 'Junior', 'Experienced', 'Senior', 'Expert', 'Master']
const RANK_RE = new RegExp(`\\b(${RANKS.join('|')})\\b`, 'i')

function rankFromTitle(title: string, firstSegment: string): string {
  const m = RANK_RE.exec(title)
  if (m) return RANKS.find((r) => r.toLowerCase() === m[1].toLowerCase()) ?? m[1]
  // No known tier word: a clean single-word first segment is probably an unlisted
  // tier, but a multi-word name isn't a rank - leave it blank to edit by hand.
  return /\s/.test(firstSegment) ? '' : firstSegment
}

export function parseContractTitle(raw: string): ParsedTitle {
  const title = cleanTitle(raw)
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean)

  const rank = rankFromTitle(title, parts[0] ?? '')
  const haulType = parts[1] ?? ''
  let pickup = ''

  const third = parts[2] ?? ''
  if (third) {
    if (/>/.test(third)) {
      // DIRECT haul: "Origin > Destination", so pickup is the origin.
      pickup = third.split('>')[0].trim()
    } else {
      pickup = third.replace(/^from\s+/i, '').trim()
    }
  }

  return { rank, haulType, pickup }
}

/** True when a log "generator name" identifies a hauling contract. */
export function isHaulingGenerator(generator: string): boolean {
  return /haul/i.test(generator)
}

/** Default short reference for a contract index, e.g. 0 -> "C01". */
export function contractRef(index: number): string {
  return 'C' + String(index + 1).padStart(2, '0')
}
