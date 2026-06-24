// must match the ships.ts snapshot generator

import type { Ship } from './ships'
import { withModules } from './shipModules'
import type { Location, Commodity } from './types'

export interface UexVehicle {
  id: number
  name_full: string
  scu: number | string
  container_sizes?: string
  is_ground_vehicle?: number | string
  is_concept?: number | string
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// \b so "Expedition" survives
const SHIP_EXCLUDE = /\bedition\b|best in show/i

export function isRosterShip(name: string): boolean {
  const n = String(name).trim()
  if (SHIP_EXCLUDE.test(n)) return false
  // exact so the Golem Ox survives
  if (n === 'Drake Golem') return false
  return true
}

export function vehiclesToShips(data: UexVehicle[]): Ship[] {
  const ships = data
    .filter((v) => num(v.scu) > 0 && num(v.is_ground_vehicle) === 0 && num(v.is_concept) === 0)
    .map((v) => ({
      name: String(v.name_full).trim(),
      scu: num(v.scu),
      uexId: num(v.id),
      containerSizes: String(v.container_sizes ?? '')
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n))
    }))
    .filter((s) => s.name.length > 0 && isRosterShip(s.name))
  return withModules(ships)
}

export interface UexTerminal {
  id: number
  name?: string
  displayname?: string
  nickname?: string
  code?: string
  has_freight_elevator?: number | string
  /** external loading dock */
  has_loading_dock?: number | string
  max_container_size?: number | string
  is_visible?: number | string
}

// real uexIds so distances still work
const EXTRA_LOCATIONS: Location[] = [
  { name: 'Levski', code: 'LEVSKI', maxContainerSize: 32, uexId: 778, hasElevator: true }
]

export function withExtraLocations(locations: Location[]): Location[] {
  const have = new Set(locations.map((l) => l.name))
  const merged = [...locations, ...EXTRA_LOCATIONS.filter((e) => !have.has(e.name))]
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

// max_container_size deliberately not a filter
export function terminalsToLocations(data: UexTerminal[]): Location[] {
  // dock flag spread across rows, aggregate by name
  const external = new Set<string>()
  for (const t of data) {
    const name = String(t.displayname || t.name || '').trim()
    if (name && num(t.has_loading_dock) === 1) external.add(name)
  }
  const byName = new Map<string, Location>()
  for (const t of data) {
    if (t.is_visible !== undefined && num(t.is_visible) === 0) continue
    if (num(t.has_freight_elevator) !== 1 && num(t.has_loading_dock) !== 1) continue
    const name = String(t.displayname || t.name || '').trim()
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      code: String(t.nickname || t.code || '').trim(),
      maxContainerSize: num(t.max_container_size),
      uexId: num(t.id),
      hasElevator: external.has(name)
    })
  }
  return withExtraLocations([...byName.values()])
}

export interface UexCommodity {
  id: number
  name?: string
  code?: string
  kind?: string
  is_visible?: number | string
}

// drop buy-only sized variants, keep generic
const SIZED_SHIP_AMMO = /^ship ammunition - size \d+$/i

export function isContractCommodity(c: { name?: string; code?: string }): boolean {
  const name = String(c.name || '').trim()
  if (SIZED_SHIP_AMMO.test(name)) return false
  if (/^SHPA[1-7]$/i.test(String(c.code || '').trim())) return false
  return true
}

export function commoditiesToList(data: UexCommodity[]): Commodity[] {
  const byName = new Map<string, Commodity>()
  for (const c of data) {
    if (c.is_visible !== undefined && num(c.is_visible) === 0) continue
    if (!isContractCommodity(c)) continue
    const name = String(c.name || '').trim()
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      code: String(c.code || '').trim(),
      kind: String(c.kind || '').trim(),
      uexId: num(c.id)
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
