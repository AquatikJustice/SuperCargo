// re-curate on read so stale caches pick up rule changes

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

/** cached ship roster or null */
export function loadCachedRoster(): ShipRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(VEHICLES_FILE), 'utf8')) as Partial<ShipRoster>
    if (Array.isArray(j.ships)) {
      return {
        ships: withModules((j.ships as Ship[]).filter((s) => isRosterShip(s.name))),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

/** cached location roster or null */
export function loadCachedLocations(): LocationRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(LOCATIONS_FILE), 'utf8')) as Partial<LocationRoster>
    if (Array.isArray(j.locations)) {
      return {
        // dedup keeps the copy with coords
        locations: withExtraLocations(j.locations as Location[]),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

/** cached commodity roster or null */
export function loadCachedCommodities(): CommodityRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(COMMODITIES_FILE), 'utf8')) as Partial<CommodityRoster>
    if (Array.isArray(j.commodities)) {
      return {
        // old caches still carry SHPA1-7, strip on load
        commodities: (j.commodities as Commodity[]).filter(isContractCommodity),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}
