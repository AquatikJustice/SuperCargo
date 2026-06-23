// Cached roster loaders (ships, freight locations, commodities) under userData.
//
// The caches are filled by the bundled seed plus the repo self-update (see
// dataSync.ts) - no live fetch and no token. These loaders just shape the cached
// JSON for the renderer, re-applying the same curation the data went through when
// it was generated, so a cache written before a rule changed gets cleaned on read.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import type { Ship } from '@shared/ships'
import { withModules } from '@shared/shipModules'
import type {
  Location,
  ShipRoster,
  LocationRoster,
  Commodity,
  CommodityRoster
} from '@shared/types'
import { withExtraLocations, isContractCommodity, isRosterShip } from '@shared/uexMap'

const VEHICLES_FILE = 'uex-vehicles.json'
const LOCATIONS_FILE = 'uex-locations.json'
const COMMODITIES_FILE = 'uex-commodities.json'

function cachePath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

/** Load the cached ship roster, or null if absent/unreadable. */
export function loadCachedRoster(): ShipRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(VEHICLES_FILE), 'utf8')) as Partial<ShipRoster>
    if (Array.isArray(j.ships)) {
      return {
        // Drop edition variants and the mining Golem, then fold cargo modules into
        // their parent ships, so an older cache gets cleaned up without a re-fetch.
        ships: withModules((j.ships as Ship[]).filter((s) => isRosterShip(s.name))),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

/** Load the cached freight-location roster, or null if absent/unreadable. */
export function loadCachedLocations(): LocationRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(LOCATIONS_FILE), 'utf8')) as Partial<LocationRoster>
    if (Array.isArray(j.locations)) {
      return {
        // Merge curated extras (e.g. Levski) so they show even from a cache written
        // before they were added; dedup keeps the coordinate-bearing copy.
        locations: withExtraLocations(j.locations as Location[]),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

/** Load the cached commodity roster, or null if absent/unreadable. */
export function loadCachedCommodities(): CommodityRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(COMMODITIES_FILE), 'utf8')) as Partial<CommodityRoster>
    if (Array.isArray(j.commodities)) {
      return {
        // Filter on load too: a cache written before the sized-ammo filter still
        // carries SHPA1-7, so clean them here without a re-fetch.
        commodities: (j.commodities as Commodity[]).filter(isContractCommodity),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}
