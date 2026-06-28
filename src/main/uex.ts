// re-curate on read, rule changes
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
  CommodityRoster,
  ShipMarkup,
  GridFacesRoster
} from '@shared/types'
import { withExtraLocations, isContractCommodity, isRosterShip } from '@shared/uexMap'

const VEHICLES_FILE = 'uex-vehicles.json'
const LOCATIONS_FILE = 'uex-locations.json'
const COMMODITIES_FILE = 'uex-commodities.json'
const GRIDFACES_FILE = 'uex-grid-faces.json'

function cachePath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

// working-tree file the markup writes
export function workingTreeData(file: string): string | null {
  if (app.isPackaged) return null
  const candidates = [
    path.join(app.getAppPath(), 'data', 'uex', file),
    path.join(app.getAppPath(), '..', '..', 'data', 'uex', file)
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

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

export function loadCachedLocations(): LocationRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(LOCATIONS_FILE), 'utf8')) as Partial<LocationRoster>
    if (Array.isArray(j.locations)) {
      return {
        // dedup keeps coords
        locations: withExtraLocations(j.locations as Location[]),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

export function loadCachedCommodities(): CommodityRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(COMMODITIES_FILE), 'utf8')) as Partial<CommodityRoster>
    if (Array.isArray(j.commodities)) {
      return {
        // old caches carry SHPA1-7
        commodities: (j.commodities as Commodity[]).filter(isContractCommodity),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

export function loadCachedGridFaces(): GridFacesRoster | null {
  const file = workingTreeData('grid-faces.json') ?? cachePath(GRIDFACES_FILE)
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<GridFacesRoster>
    if (Array.isArray(j.gridFaces)) {
      return {
        gridFaces: j.gridFaces as ShipMarkup[],
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}
