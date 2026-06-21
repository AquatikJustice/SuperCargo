// Modular-cargo ships: some hulls have swappable bays that can be cargo modules,
// so the user picks the ship and then which cargo modules they have installed.
//
// Two sources, merged by `withModules`:
//   1. AUTO from UEX. UEX lists cargo modules as their own "<Ship> Cargo Module
//      - <Slot>" vehicle rows (e.g. Aegis Retaliator Cargo Module - Bow @ 38 SCU).
//      We fold those into the parent ship and drop the standalone rows. The
//      parent's UEX scu already equals hull + all modules, so hull base =
//      parentScu - sum of modules.
//   2. CURATED. Ships UEX doesn't model as modular yet (Aurora Mk II). Easy to
//      extend as new modular ships ship.

import type { Ship, ShipModule } from './ships'

interface ModularDef {
  /** Exact ship name as it appears in the roster (UEX name_full). */
  name: string
  /** Hull cargo with no modules installed. */
  baseScu: number
  modules: ShipModule[]
}

// Curated modular ships UEX doesn't expose as separate "Cargo Module" rows.
// Keep values player-verified; cite the source in the comment.
export const CURATED_MODULAR: ModularDef[] = [
  // Aurora Mk II: 2 SCU hull + a 6 SCU cargo module add-on (per user, live since
  // the Mar 2026 patch). UEX may not list it yet, so add it if missing.
  {
    name: 'RSI Aurora Mk II',
    baseScu: 2,
    modules: [{ id: 'aurora-mkii-cargo', name: 'Cargo Module', scu: 6 }]
  }
]

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const CARGO_MODULE_RE = /^(.*?)\s+Cargo Module(?:\s*[--:]\s*(.+))?$/i

const sumScu = (mods: ShipModule[]): number => mods.reduce((n, m) => n + m.scu, 0)

/**
 * Fold UEX "Cargo Module" rows into their parent ships, apply curated modular
 * defs, and drop the standalone module rows. Idempotent: re-running on already
 * processed rosters (module rows gone, parents annotated) is a no-op.
 */
export function withModules(ships: Ship[]): Ship[] {
  // 1. Collect module rows, grouped by parent ship name.
  const modulesByParent = new Map<string, ShipModule[]>()
  const kept: Ship[] = []
  for (const s of ships) {
    const m = CARGO_MODULE_RE.exec(s.name)
    if (m) {
      const parent = m[1].trim()
      const slot = (m[2] ?? '').trim()
      const mod: ShipModule = {
        id: slug(`${parent}-${slot || 'cargo'}`),
        name: slot ? `Cargo Module - ${slot}` : 'Cargo Module',
        scu: s.scu
      }
      const list = modulesByParent.get(parent) ?? []
      list.push(mod)
      modulesByParent.set(parent, list)
    } else {
      kept.push(s)
    }
  }

  // 2. Attach derived modules to their parent (base = parentScu - sum of modules).
  const annotated = kept.map((s) => {
    const mods = modulesByParent.get(s.name)
    if (!mods || mods.length === 0 || s.modules) return s
    const total = sumScu(mods)
    const baseScu = Math.max(0, s.scu - total)
    return { ...s, baseScu, modules: mods, scu: baseScu + total }
  })

  // 3. Apply curated defs: annotate the existing ship, or add it if missing.
  const byName = new Map(annotated.map((s) => [s.name, s]))
  for (const def of CURATED_MODULAR) {
    const total = sumScu(def.modules)
    const existing = byName.get(def.name)
    if (existing) {
      if (!existing.modules) {
        existing.baseScu = def.baseScu
        existing.modules = def.modules
        existing.scu = def.baseScu + total
      }
    } else {
      const ship: Ship = {
        name: def.name,
        scu: def.baseScu + total,
        uexId: 0,
        containerSizes: [],
        baseScu: def.baseScu,
        modules: def.modules
      }
      annotated.push(ship)
      byName.set(def.name, ship)
    }
  }

  return annotated.sort((a, b) => a.name.localeCompare(b.name))
}

/** Default install state for a modular ship = every module fitted (matches its listed max SCU). */
export function defaultInstalled(ship: Ship): string[] {
  return ship.modules?.map((m) => m.id) ?? []
}

/**
 * Effective cargo capacity for a ship given which modules the user has installed.
 * `installed` undefined means all modules fitted (the default). Non-modular
 * ships just return their flat scu.
 */
export function shipCapacity(ship: Ship | undefined, installed?: string[]): number {
  if (!ship) return 0
  if (!ship.modules || ship.modules.length === 0) return ship.scu
  const ids = installed ?? defaultInstalled(ship)
  return (ship.baseScu ?? 0) + ship.modules.filter((m) => ids.includes(m.id)).reduce((n, m) => n + m.scu, 0)
}
