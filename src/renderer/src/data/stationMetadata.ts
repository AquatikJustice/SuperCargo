// Curated station metadata, the home for the data the org will gather.
//
// There is NO API for external freight-elevator availability or ship-access
// rules, so this is hand-curated. It is INTENTIONALLY EMPTY: no values here are
// guessed. Add a row and the manifest immediately shows that station's elevator
// badge (green = elevator, amber = no elevator / front ramp). Until a station
// has a row, it shows no badge.
//
// Keys: prefer the stable station CODE ("HUR-L1"). For locations without a code
// (e.g. "Everus Harbor", "Port Tressler"), use the exact full destination name
// as it appears in-game / the log.
//
// Example rows (commented out, fill in once verified, don't ship guesses):
//   'HUR-L1': { hasElevator: false, type: 'lagrange' },
//   'HUR-L5': { hasElevator: true,  type: 'lagrange' },
//   'Everus Harbor': { hasElevator: true, type: 'orbital' },

export interface StationMetaEntry {
  /** Has an external freight elevator (top/roof loading possible). */
  hasElevator?: boolean
  type?: 'orbital' | 'ground' | 'lagrange' | 'station'
  /** Some ships (e.g. Hull C) can ONLY use external elevators. */
  requiresExternalElevator?: boolean
}

// NOTE: external-elevator (loading-dock) data is now sourced from UEX's
// `has_loading_dock` and carried on the Location (see uexMap.ts). This map is now
// only a MANUAL OVERRIDE layer: add a row to force a station's badge when UEX is
// still wrong and no correction has landed. Empty = rely on UEX.
export const STATION_METADATA: Record<string, StationMetaEntry> = {
  // (overrides only, e.g. 'HUR-L1': { hasElevator: false })
}

/** Look up metadata by station code first, then by full destination name. */
export function lookupStationMeta(code: string, fullName: string): StationMetaEntry | undefined {
  return STATION_METADATA[code] ?? STATION_METADATA[fullName]
}

// ---------------------------------------------------------------------------
// CANDIDATE external-freight-elevator locations, UNCONFIRMED.
//
// Source: Google Search AI (per user, 2026-06-20), explicitly "supposedly but
// unconfirmed". Kept as a comment ONLY so it is not lost; do NOT promote into
// STATION_METADATA until verified in-game (this file's rule: ship no guesses).
// When confirming, also capture the in-game CODE (the keys above prefer codes).
//
// Stanton:  Everus Harbor, Baijini Point, Port Tressler, Seraphim Station,
//           Nyx Gateway, Pyro Gateway, Terra Gateway
// Nyx:      Levski, Nyx Gateway, Stanton Gateway, People's Service Station Alpha,
//           People's Service Station Delta, People's Service Station Theta,
//           People's Service Station Lambda, QV Services Station
// Pyro:     Stanton Gateway, Nyx Gateway, Patchwork (Pyro I), Bloom (Pyro II),
//           Starlight (Pyro III), Checkmate (Pyro IV), Ruptura (Pyro V),
//           The Overlook (Pyro VI), Gaslight
// ---------------------------------------------------------------------------
