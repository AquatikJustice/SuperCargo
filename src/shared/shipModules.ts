import type { Ship, ShipModule } from './ships'

interface ModularDef {
  name: string
  baseScu: number
  modules: ShipModule[]
}

// modular ships not in uex as separate module rows
export const CURATED_MODULAR: ModularDef[] = [
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

const CARGO_MODULE_RE = /^(.*?)\s+Cargo Module(?:\s*[-:]\s*(.+))?$/i

const sumScu = (mods: ShipModule[]): number => mods.reduce((n, m) => n + m.scu, 0)

// idempotent: re-running on a processed roster is a no-op
export function withModules(ships: Ship[]): Ship[] {
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

  // parent scu already includes modules, so base = scu - sum
  const annotated = kept.map((s) => {
    const mods = modulesByParent.get(s.name)
    if (!mods || mods.length === 0 || s.modules) return s
    const total = sumScu(mods)
    const baseScu = Math.max(0, s.scu - total)
    return { ...s, baseScu, modules: mods, scu: baseScu + total }
  })

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

export function defaultInstalled(ship: Ship): string[] {
  return ship.modules?.map((m) => m.id) ?? []
}

// installed undefined = all modules fitted
export function shipCapacity(ship: Ship | undefined, installed?: string[]): number {
  if (!ship) return 0
  if (!ship.modules || ship.modules.length === 0) return ship.scu
  const ids = installed ?? defaultInstalled(ship)
  return (ship.baseScu ?? 0) + ship.modules.filter((m) => ids.includes(m.id)).reduce((n, m) => n + m.scu, 0)
}
