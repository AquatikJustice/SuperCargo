// Single source of truth for turning raw UEXcorp /vehicles rows into our Ship
// roster. Used by the live sync (and matches how the bundled snapshot in
// ships.ts was generated): cargo-capable, flight-ready spaceships only -
// scu > 0, excluding ground vehicles and concept/unflyable ships.

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

// Paint/cosmetic and special-edition variants (Pirate Edition, Best In Show
// Edition, Carbon/Talus/Executive/Liberator Edition...) are duplicates of a base
// ship for hauling purposes - drop them so the picker isn't cluttered.
// NOTE: `\bEdition\b` matches the *word*, so "Expedition" (Carrack Expedition,
// C8X Pisces Expedition) is NOT caught - those are real, distinct ships.
const SHIP_EXCLUDE = /\bedition\b|best in show/i

/** True for ships that belong in the hauling roster (drops edition variants + the mining Golem). */
export function isRosterShip(name: string): boolean {
  const n = String(name).trim()
  if (SHIP_EXCLUDE.test(n)) return false
  // The Drake Golem is a mining ship - its only "cargo" is the proprietary
  // mining bag, so it's not a hauler. The Drake Golem Ox IS a cargo hauler, so
  // match the base name exactly (don't prefix-match the Ox out).
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
  // Fold UEX "Cargo Module" rows into their parent ships + apply curated modular
  // defs (and drop the standalone module rows). withModules also sorts by name.
  return withModules(ships)
}

export interface UexTerminal {
  id: number
  name?: string
  displayname?: string
  nickname?: string
  code?: string
  has_freight_elevator?: number | string
  /** UEX's external freight elevator flag ("loading dock"). */
  has_loading_dock?: number | string
  max_container_size?: number | string
  is_visible?: number | string
}

// Curated hauling destinations UEX's /terminals feed doesn't surface via
// has_freight_elevator (so the filter below drops them), but which DO take
// hauling cargo in-game. Real UEX terminal ids so live distances still work.
// Verified against the live /terminals feed 2026-06-21.
const EXTRA_LOCATIONS: Location[] = [
  // Levski (Delamar, Nyx). UEX terminal 778. Has an external loading dock (user
  // confirmed + correction submitted). Kept here so it shows without a re-sync;
  // once a sync runs, the live feed supplies it too (dedup keeps one).
  { name: 'Levski', code: 'LEVSKI', maxContainerSize: 32, uexId: 778, hasElevator: true }
]

/** Merge curated extras into a location list, skipping any already present by name. */
export function withExtraLocations(locations: Location[]): Location[] {
  const have = new Set(locations.map((l) => l.name))
  const merged = [...locations, ...EXTRA_LOCATIONS.filter((e) => !have.has(e.name))]
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Delivery/pickup locations = terminals a hauling contract can route cargo to:
 * an INTERNAL freight elevator (`has_freight_elevator`) OR an EXTERNAL loading
 * dock (`has_loading_dock`), deduped by display name. `max_container_size` is a
 * TRADING property (the game assigns hauling boxes, you don't buy them) and is
 * deliberately NOT a signal here. Curated extras (EXTRA_LOCATIONS) fill gaps
 * where UEX still mis-flags a real destination.
 */
export function terminalsToLocations(data: UexTerminal[]): Location[] {
  // The external loading dock is a STATION property UEX spreads across a station's
  // many terminal rows - aggregate it by display name so any row flags the station.
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

// UEX carries the per-ship-weapon variants you can BUY - "Ship Ammunition - Size 1"
// through "- Size 7" (codes SHPA1-SHPA7). Hauling/other contracts only ever award the
// single generic "Ship Ammunition" (SHPA), so the sized variants are pure clutter in
// the contract commodity list / typeahead. Drop them; keep the generic.
const SIZED_SHIP_AMMO = /^ship ammunition - size \d+$/i

/** True for commodities a contract can actually award (drops buy-only ammo sizes). */
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
