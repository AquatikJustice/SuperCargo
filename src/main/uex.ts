// UEXcorp ship-roster sync. Fetches /vehicles with the user's app token,
// filters to cargo-capable ships, and caches the result under userData so the
// ship selector reflects live UEX data (with the bundled snapshot as fallback).

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import type { Ship } from '@shared/ships'
import { withModules } from '@shared/shipModules'
import type {
  UexSyncResult,
  UexSyncSummary,
  ShipRoster,
  Location,
  LocationRoster,
  Commodity,
  CommodityRoster
} from '@shared/types'
import {
  vehiclesToShips,
  terminalsToLocations,
  withExtraLocations,
  commoditiesToList,
  isContractCommodity,
  isRosterShip,
  type UexVehicle,
  type UexTerminal,
  type UexCommodity
} from '@shared/uexMap'

const VEHICLES_FILE = 'uex-vehicles.json'
const LOCATIONS_FILE = 'uex-locations.json'
const COMMODITIES_FILE = 'uex-commodities.json'
const BASE = 'https://uexcorp.space/api/2.0'
const FETCH_TIMEOUT_MS = 15000
const MAX_ATTEMPTS = 3

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function cachePath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

/** Load the cached ship roster, or null if absent/unreadable. */
export function loadCachedRoster(): ShipRoster | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(VEHICLES_FILE), 'utf8')) as Partial<ShipRoster>
    if (Array.isArray(j.ships)) {
      return {
        // Drop edition variants and the mining Golem, then fold cargo modules
        // into their parent ships. This way caches written before these changes
        // get cleaned up without forcing a re-sync.
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
        // Merge curated extras (e.g. Levski) so they show up even from a cache
        // written before they were added, no re-sync needed.
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
        // Filter on load too. Caches written before the sized-ammo filter still
        // carry SHPA1-7, so clean them here without forcing a re-sync.
        commodities: (j.commodities as Commodity[]).filter(isContractCommodity),
        syncedAt: typeof j.syncedAt === 'string' ? j.syncedAt : ''
      }
    }
  } catch {
    /* no cache yet */
  }
  return null
}

interface ArrayResponse {
  status?: string
  data?: unknown[]
}

/** One fetch attempt for an array endpoint. */
async function fetchArrayOnce(
  url: string,
  token: string
): Promise<{ data: unknown[] } | { retry: boolean; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'SuperCargo/0.1 (+https://github.com/CHANGE_ME/SuperCargo)'
      },
      signal: controller.signal
    })
    if (!res.ok) {
      // 5xx and 429 are worth retrying; 4xx (bad token, etc.) are not.
      return { retry: res.status >= 500 || res.status === 429, error: `HTTP ${res.status} ${res.statusText}` }
    }
    const json = (await res.json()) as ArrayResponse
    if (json.status !== 'ok' || !Array.isArray(json.data)) {
      return { retry: false, error: 'Unexpected UEXcorp response' }
    }
    return { data: json.data }
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    return { retry: true, error: aborted ? 'Request timed out' : (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch an array endpoint with retries on transient errors. */
async function fetchArray(
  url: string,
  token: string
): Promise<{ ok: true; data: unknown[] } | { ok: false; error: string }> {
  let lastError = 'Sync failed'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await fetchArrayOnce(url, token)
    if ('data' in result) return { ok: true, data: result.data }
    lastError = result.error
    if (!result.retry || attempt === MAX_ATTEMPTS) break
    await sleep(500 * attempt) // linear backoff
  }
  return { ok: false, error: lastError }
}

function writeCache(file: string, value: unknown): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(cachePath(file), JSON.stringify(value, null, 2), 'utf8')
  } catch (e) {
    console.error(`[uex] failed to write ${file}:`, e)
  }
}

export async function syncVehicles(token: string): Promise<UexSyncResult> {
  if (!token) return { ok: false, error: 'No UEXcorp token set' }
  const r = await fetchArray(`${BASE}/vehicles`, token)
  if (!r.ok) return { ok: false, error: r.error }
  const ships = vehiclesToShips(r.data as UexVehicle[])
  const syncedAt = new Date().toISOString()
  writeCache(VEHICLES_FILE, { source: `${BASE}/vehicles`, syncedAt, ships })
  return { ok: true, count: ships.length, syncedAt }
}

export async function syncLocations(token: string): Promise<UexSyncResult> {
  if (!token) return { ok: false, error: 'No UEXcorp token set' }
  const r = await fetchArray(`${BASE}/terminals`, token)
  if (!r.ok) return { ok: false, error: r.error }
  const locations = terminalsToLocations(r.data as UexTerminal[])
  const syncedAt = new Date().toISOString()
  writeCache(LOCATIONS_FILE, { source: `${BASE}/terminals`, syncedAt, locations })
  return { ok: true, count: locations.length, syncedAt }
}

export async function syncCommodities(token: string): Promise<UexSyncResult> {
  if (!token) return { ok: false, error: 'No UEXcorp token set' }
  const r = await fetchArray(`${BASE}/commodities`, token)
  if (!r.ok) return { ok: false, error: r.error }
  const commodities = commoditiesToList(r.data as UexCommodity[])
  const syncedAt = new Date().toISOString()
  writeCache(COMMODITIES_FILE, { source: `${BASE}/commodities`, syncedAt, commodities })
  return { ok: true, count: commodities.length, syncedAt }
}

// ---------------------------------------------------------------------------
// Terminal-to-terminal distances (for route optimization). UEX gives a real
// gigameter distance between any two terminals. We fetch pairs on demand and
// cache them on disk (the set of locations in a manifest is small and stable).
// ---------------------------------------------------------------------------

const DISTANCES_FILE = 'uex-distances.json'
type DistCache = Record<string, number> // "min-max" terminal-id pair -> gigameters

function loadDistCache(): DistCache {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(DISTANCES_FILE), 'utf8'))
    return j && typeof j === 'object' ? (j as DistCache) : {}
  } catch {
    return {}
  }
}

const pairKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** One terminals_distances call: distance in gigameters, or null on any miss. */
async function fetchDistance(a: number, b: number, token: string): Promise<number | null> {
  const url = `${BASE}/terminals_distances?id_terminal_origin=${a}&id_terminal_destination=${b}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'SuperCargo/0.1 (+https://github.com/CHANGE_ME/SuperCargo)'
      },
      signal: controller.signal
    })
    if (!res.ok) return null
    const json = (await res.json()) as { status?: string; data?: unknown }
    if (json.status !== 'ok') return null
    const row = Array.isArray(json.data) ? json.data[0] : json.data
    const d = (row as { distance?: unknown })?.distance
    const n = typeof d === 'number' ? d : Number(d)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Distances between every pair of the given terminal ids. Cached pairs are
 * returned right away; missing pairs are fetched (one at a time, to go easy on
 * the API) and cached. Pairs that fail to resolve are left out, and the caller
 * falls back to a grouping cost for those legs.
 */
export async function getRouteDistances(
  ids: number[],
  token: string
): Promise<{ matrix: DistCache }> {
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))]
  const cache = loadDistCache()
  let changed = false
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const k = pairKey(uniq[i], uniq[j])
      if (k in cache) continue
      if (!token) continue
      const d = await fetchDistance(uniq[i], uniq[j], token)
      if (d != null) {
        cache[k] = d
        changed = true
      }
    }
  }
  if (changed) writeCache(DISTANCES_FILE, cache)
  const out: DistCache = {}
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const k = pairKey(uniq[i], uniq[j])
      if (k in cache) out[k] = cache[k]
    }
  }
  return { matrix: out }
}

/** Sync ships, freight locations, and commodities together. */
export async function syncAll(token: string): Promise<UexSyncSummary> {
  if (!token) return { ok: false, error: 'No UEXcorp token set' }
  const [ships, locations, commodities] = await Promise.all([
    syncVehicles(token),
    syncLocations(token),
    syncCommodities(token)
  ])
  if (!ships.ok && !locations.ok && !commodities.ok) {
    return { ok: false, error: ships.error || locations.error || commodities.error }
  }
  return {
    ok: true,
    ships: ships.count,
    locations: locations.count,
    commodities: commodities.count,
    syncedAt: ships.syncedAt || locations.syncedAt || commodities.syncedAt
  }
}
