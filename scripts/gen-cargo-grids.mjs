// Builds src/shared/cargoGrids.ts from sc-cargo + datamine fallback.
// npm run gen:grids

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ROSTER_TS = path.join(ROOT, 'src/shared/ships.ts')
const OUT_TS = path.join(ROOT, 'src/shared/cargoGrids.ts')
const SCCARGO = path.join(ROOT, 'scripts/data/sccargo-ships.json')
const DATAMINE = path.join(ROOT, 'scripts/data/datamine-grids.json')

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// must match shipModules.ts slug
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const dimKey = (w, l, h) => [w, l, h].sort((a, b) => a - b).join('x')

// mirrors uexMap.isRosterShip
const SHIP_EXCLUDE = /\bedition\b|best in show/i
function loadRoster() {
  const ts = fs.readFileSync(ROSTER_TS, 'utf8')
  const out = []
  const re = /"name":\s*"([^"]+)",\s*"scu":\s*(\d+)/g
  let m
  while ((m = re.exec(ts))) {
    const name = m[1]
    if (SHIP_EXCLUDE.test(name) || name === 'Drake Golem') continue
    out.push({ name, scu: Number(m[2]) })
  }
  const seen = new Set()
  return out.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
}

function buildScIndex(ships) {
  const byKey = new Map()
  for (const sh of ships) {
    const rec = { manu: sh.manufacturer, name: sh.name, data: sh.data }
    for (const k of [norm(`${sh.manufacturer} ${sh.name}`), norm(sh.name)]) {
      if (!byKey.has(k)) byKey.set(k, rec)
    }
  }
  return byKey
}

// roster name to sc-cargo [manufacturer, name]
const ALIAS = {
  'Argo MPUV Cargo': ['Argo', 'MPUV-C'],
  'Argo MPUV Tractor': ['Argo', 'MPUV-T'],
  'Crusader A2 Hercules Starlifter': ['Crusader', 'A2 Hercules'],
  'Crusader C2 Hercules Starlifter': ['Crusader', 'C2 Hercules'],
  'Crusader M2 Hercules Starlifter': ['Crusader', 'M2 Hercules'],
  'RSI Aurora Mk I CL': ['RSI', 'Aurora CL (Mk I)'],
  'RSI Aurora Mk I SE': ['RSI', 'Aurora CL (Mk I)'], // SE shares CL geometry
  'RSI Aurora Mk I ES': ['RSI', 'Aurora ES (Mk I)'],
  'RSI Aurora Mk I LN': ['RSI', 'Aurora LN (Mk I)'],
  'RSI Aurora Mk I LX': ['RSI', 'Aurora LX (Mk I)'],
  'RSI Aurora Mk I MR': ['RSI', 'Aurora MR (Mk I)'],
  'RSI Aurora Mk II': ['RSI', 'Aurora (Mk II)'], // rack module added below
  'MISC Starfarer': ['MISC', 'Starfarer Gemini'],
  'RSI Constellation Phoenix Emerald': ['RSI', 'Constellation Phoenix'],
  'Anvil C8X Pisces Expedition': ['Anvil', 'C8X Pisces'],
  'Anvil Carrack Expedition': ['Anvil', 'Carrack'],
  'Aegis Retaliator': ['Aegis', 'Retaliator']
}

function matchSc(scIndex, ship) {
  const a = ALIAS[ship.name]
  if (a) {
    const k = norm(`${a[0]} ${a[1]}`)
    if (scIndex.has(k)) return scIndex.get(k)
  }
  const nn = norm(ship.name)
  if (scIndex.has(nn)) return scIndex.get(nn)
  // suffix only, never mid-string
  for (const [k, rec] of scIndex) {
    if (k && nn.endsWith(' ' + k)) return rec
  }
  return null
}

// stale sc-cargo geometry, use datamine
const PREFER_DATAMINE = new Set(['Aegis Hammerhead', 'MISC Hull A'])

// reference-only groups, explicit
const REFERENCE_ONLY_GROUPS = { 'Drake Ironclad': [1] }

const MODULE_OF = {
  'Aegis Retaliator': (_gi, groupScu) =>
    groupScu === 36 ? 'aegis-retaliator-stern' : 'aegis-retaliator-bow'
}

// lift pads sc-cargo lacks, reference-only
const lift = (id, name, x, y, z) => ({
  id,
  name,
  x,
  y,
  z,
  w: 2,
  l: 2,
  h: 2,
  scu: 8,
  source: 'override',
  autoLoad: false
})
const ADD_GRIDS = {
  'Drake Ironclad': [lift('lift-1', 'Lift 1', -4, 0, 0), lift('lift-2', 'Lift 2', -4, 0, 21)],
  'Drake Ironclad Assault': [lift('lift-1', 'Lift 1', -4, 0, 0), lift('lift-2', 'Lift 2', -4, 0, 8)]
}

// curated module bays absent from every source
const MODULE_GRIDS = {
  'RSI Aurora Mk II': [
    {
      id: 'rack',
      name: 'Cargo Rack',
      x: 0,
      y: 0,
      z: 4,
      w: 1,
      l: 3,
      h: 2,
      scu: 6,
      moduleId: 'aurora-mkii-cargo',
      source: 'curated'
    }
  ]
}

function makeNamePicker(dmGrids) {
  const pool = (dmGrids || []).map((g) => ({ key: dimKey(g.w, g.l, g.h), name: g.name, used: false }))
  return (w, l, h) => {
    const k = dimKey(w, l, h)
    const hit = pool.find((p) => !p.used && p.key === k)
    if (hit) {
      hit.used = true
      return hit.name
    }
    return null
  }
}

function uniqueIds(grids) {
  const seen = new Map()
  for (const g of grids) {
    const base = g.id
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    if (n > 1) g.id = `${base}-${n}`
  }
  return grids
}

function fromSccargo(rec, ship, dmGrids) {
  const pickName = makeNamePicker(dmGrids)
  const refGroups = REFERENCE_ONLY_GROUPS[ship.name] || []
  const moduleOf = MODULE_OF[ship.name]
  const grids = []
  rec.data.groups.forEach((grp, gi) => {
    const groupScu = grp.grids.reduce((a, g) => a + g.width * g.height * g.length, 0)
    const gx = grp.x || 0
    const gz = grp.z || 0
    grp.grids.forEach((g, k) => {
      const w = g.width
      const l = g.length
      const h = g.height
      const name = pickName(w, l, h) || `Bay ${gi + 1}${grp.grids.length > 1 ? `.${k + 1}` : ''}`
      const grid = {
        id: slug(name),
        name,
        x: gx + (g.x || 0),
        y: g.y || 0,
        z: gz + (g.z || 0),
        w,
        l,
        h,
        scu: w * l * h,
        group: gi,
        source: 'sccargo'
      }
      if (g.maxSize) grid.maxSize = g.maxSize
      if (refGroups.includes(gi)) grid.autoLoad = false
      const mod = moduleOf && moduleOf(gi, groupScu)
      if (mod) grid.moduleId = mod
      grids.push(grid)
    })
  })
  return grids
}

function fromDatamine(dmGrids) {
  const grids = []
  let x = 0
  dmGrids.forEach((g, i) => {
    grids.push({
      id: slug(g.name),
      name: g.name,
      x,
      y: 0,
      z: 0,
      w: g.w,
      l: g.l,
      h: g.h,
      scu: g.scu,
      group: i,
      source: 'datamine'
    })
    x += g.w + 1 // aisle between bays
  })
  return grids
}

function overlaps(a, b) {
  const ax2 = a.x + a.w,
    ay2 = a.y + a.h,
    az2 = a.z + a.l
  const bx2 = b.x + b.w,
    by2 = b.y + b.h,
    bz2 = b.z + b.l
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y && a.z < bz2 && az2 > b.z
}
function findOverlaps(grids) {
  const bad = []
  for (let i = 0; i < grids.length; i++)
    for (let j = i + 1; j < grids.length; j++)
      if (overlaps(grids[i], grids[j])) bad.push([grids[i].name, grids[j].name])
  return bad
}

function main() {
  const scShips = JSON.parse(fs.readFileSync(SCCARGO, 'utf8'))
  const datamine = JSON.parse(fs.readFileSync(DATAMINE, 'utf8'))
  const scIndex = buildScIndex(scShips)
  const roster = loadRoster()

  const result = {}
  const report = []
  for (const ship of roster) {
    const dmGrids = datamine[ship.name]
    const sc = PREFER_DATAMINE.has(ship.name) ? null : matchSc(scIndex, ship)
    let grids
    let layout
    if (sc) {
      grids = fromSccargo(sc, ship, dmGrids)
      layout = 'sccargo'
    } else if (dmGrids) {
      grids = fromDatamine(dmGrids)
      layout = 'datamine'
    } else {
      report.push({ name: ship.name, scu: ship.scu, total: 0, status: 'NO GRID' })
      continue
    }

    for (const extra of ADD_GRIDS[ship.name] || []) grids.push({ group: 0, ...extra })
    for (const mg of MODULE_GRIDS[ship.name] || []) grids.push({ group: 0, ...mg })
    uniqueIds(grids)

    const baseScu = grids.filter((g) => !g.moduleId).reduce((a, g) => a + g.scu, 0)
    const totalScu = grids.reduce((a, g) => a + g.scu, 0)
    const loadableScu = grids.filter((g) => g.autoLoad !== false).reduce((a, g) => a + g.scu, 0)
    result[ship.name] = { ship: ship.name, baseScu, totalScu, loadableScu, layout, grids }

    const bad = findOverlaps(grids)
    report.push({
      name: ship.name,
      scu: ship.scu,
      total: totalScu,
      loadable: loadableScu,
      layout,
      overlaps: bad.length,
      status: bad.length ? 'OVERLAP' : totalScu === ship.scu ? 'ok' : `DIFF (uex ${ship.scu})`
    })
  }

  writeOut(result)
  printReport(report, Object.keys(result).length, roster.length)
}

function writeOut(result) {
  const entries = Object.keys(result)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(result[k])}`)
    .join(',\n')
  const ts = `// AUTO-GENERATED by scripts/gen-cargo-grids.mjs - do not edit by hand.
// Per-ship cargo-bay geometry WITH POSITIONS for the Phase 4 3D grid view.
// Primary source: sc-cargo.space (credits Ratjack); datamine fallback for the rest.
// Coords are in CELLS (1 cell = 1.25 m = one 1 SCU cube): x = width axis,
// y = up/height, z = length axis. Render a grid box at (x, y, z) sized wxhxl.
// Regenerate: npm run gen:grids
// Generated: ${new Date().toISOString().slice(0, 10)}

import type { ShipMarkup, BayDir, BayFaceKind } from './types'

export interface CargoGrid {
  id: string
  name: string
  /** ship-space position of the box's min corner, in cells (x=width, y=up, z=length). */
  x: number
  y: number
  z: number
  /** cells across / deep / tall (1 cell = 1.25m = one 1 SCU cube). */
  w: number
  l: number
  h: number
  /** w*l*h. */
  scu: number
  /** largest SCU box this grid will accept (from sc-cargo); undefined = no limit. */
  maxSize?: number
  /** index of the physically-separated section (group) this grid belongs to. */
  group?: number
  /** present only on grids belonging to an installable module (matches Ship.modules[].id). */
  moduleId?: string
  /** false = reference-only: shown in the view but the packer must never auto-fill it
   *  (secure vaults you can't fit haul boxes into; lift pads that drop cargo on a QT jump). */
  autoLoad?: boolean
  /** the face cargo peels out toward (the ramp/exit); DERIVED from \`faces\`. when
   *  set, the packer fills the deep end first so earlier drops sit nearest it. */
  exit?: { axis: 'x' | 'z'; dir: -1 | 1 }
  /** authored per-face markup (wall/exit/aisle), from synced grid-faces. */
  faces?: Partial<Record<BayDir, BayFaceKind>>
  source: 'sccargo' | 'datamine' | 'override' | 'curated'
}

export interface ShipGrids {
  ship: string
  /** SCU of always-present (non-module) grids. */
  baseScu: number
  /** SCU with every module installed. */
  totalScu: number
  /** SCU the packer may actually fill (excludes reference-only secure/lift grids). */
  loadableScu: number
  /** 'sccargo' = real positions; 'datamine' = positions approximated as a row of bays. */
  layout: 'sccargo' | 'datamine'
  grids: CargoGrid[]
}

export const CARGO_GRIDS: Record<string, ShipGrids> = {
${entries}
}

// authored markup (per-bay faces + layout fixes), synced from the repo like the
// uex lists (markup tool -> data/uex/grid-faces.json). setGridFaces is called
// once the roster loads; until then bays have no markup and the packer falls
// back to a dense pack.
type BayInfo = Partial<Pick<CargoGrid, 'faces' | 'x' | 'y' | 'z' | 'w' | 'l' | 'h'>>
let MARKUP: Record<string, Record<string, BayInfo>> = {}
let FRAMES: Record<string, NonNullable<ShipMarkup['frame']>> = {}

export function setGridFaces(ships: ShipMarkup[]): void {
  const map: Record<string, Record<string, BayInfo>> = {}
  const frames: Record<string, NonNullable<ShipMarkup['frame']>> = {}
  for (const s of ships) {
    const bays: Record<string, BayInfo> = {}
    for (const b of s.bays) bays[b.id] = { faces: b.faces, x: b.x, y: b.y, z: b.z, w: b.w, l: b.l, h: b.h }
    map[s.ship] = bays
    if (s.frame) frames[s.ship] = s.frame
  }
  MARKUP = map
  FRAMES = frames
}

/** authored bow/starboard, or undefined (the view defaults bow to z-). */
export function shipFrame(ship: string): NonNullable<ShipMarkup['frame']> | undefined {
  return FRAMES[ship]
}

const DIR_TO_EXIT: Record<BayDir, { axis: 'x' | 'z'; dir: -1 | 1 }> = {
  'x+': { axis: 'x', dir: 1 },
  'x-': { axis: 'x', dir: -1 },
  'z+': { axis: 'z', dir: 1 },
  'z-': { axis: 'z', dir: -1 },
  'y+': { axis: 'z', dir: -1 }, // roof: not a horizontal peel direction
  'y-': { axis: 'z', dir: -1 }
}

// the packer peels toward a horizontal exit/aisle; the roof (y) is a bonus, not
// a peel axis. prefer an EXIT face, else an AISLE face.
function deriveExit(faces?: Partial<Record<BayDir, BayFaceKind>>): CargoGrid['exit'] {
  if (!faces) return undefined
  const horiz: BayDir[] = ['x+', 'x-', 'z+', 'z-']
  const exit = horiz.find((d) => faces[d] === 'exit')
  if (exit) return DIR_TO_EXIT[exit]
  const aisle = horiz.find((d) => faces[d] === 'aisle')
  return aisle ? DIR_TO_EXIT[aisle] : undefined
}

/** All grids for a ship (for the view), optionally limited to installed modules. */
export function gridsFor(ship: string, installed?: string[]): CargoGrid[] {
  const rec = CARGO_GRIDS[ship]
  if (!rec) return []
  const bays = MARKUP[ship]
  return rec.grids
    .filter((g) => !g.moduleId || !installed || installed.includes(g.moduleId))
    .map((g) => {
      const m = bays && bays[g.id]
      if (!m) return g
      // apply any layout override, attach faces, derive the peel exit
      return {
        ...g,
        ...(m.x !== undefined ? { x: m.x } : {}),
        ...(m.y !== undefined ? { y: m.y } : {}),
        ...(m.z !== undefined ? { z: m.z } : {}),
        ...(m.w !== undefined ? { w: m.w } : {}),
        ...(m.l !== undefined ? { l: m.l } : {}),
        ...(m.h !== undefined ? { h: m.h } : {}),
        faces: m.faces,
        exit: deriveExit(m.faces)
      }
    })
}

/** Grids the packer may fill - gridsFor minus reference-only (secure/lift) bays. */
export function loadableGrids(ship: string, installed?: string[]): CargoGrid[] {
  return gridsFor(ship, installed).filter((g) => g.autoLoad !== false)
}

// what actually fits on the run: auto-load bays only, no elevators or secure
// storage. for the Ironclad this is ~2160, not the 2200 nominal hold.
export function gridCapacity(ship: string, installed?: string[]): number {
  return loadableGrids(ship, installed).reduce((a, g) => a + g.w * g.l * g.h, 0)
}
`
  fs.writeFileSync(OUT_TS, ts)
  console.log(`[grids] wrote ${OUT_TS}`)
}

function printReport(report, written, rosterCount) {
  const ok = report.filter((r) => r.status === 'ok')
  const diff = report.filter((r) => r.status.startsWith('DIFF'))
  const none = report.filter((r) => r.status === 'NO GRID')
  const over = report.filter((r) => r.status === 'OVERLAP')
  const sc = report.filter((r) => r.layout === 'sccargo')
  const dm = report.filter((r) => r.layout === 'datamine')
  console.log(`\n[grids] roster ${rosterCount} · written ${written}`)
  console.log(`  layout: sccargo ${sc.length}  datamine ${dm.length}`)
  console.log(`  exact: ${ok.length}   diff: ${diff.length}   no-grid: ${none.length}   overlaps: ${over.length}`)
  if (over.length) {
    console.log('\n  --- position overlaps (bug, investigate) ---')
    for (const r of over) console.log(`    ${r.name.padEnd(38)} ${r.overlaps} overlapping pair(s)`)
  }
  if (diff.length) {
    console.log('\n  --- totals differing from UEX scu ---')
    for (const r of diff) console.log(`    ${r.name.padEnd(38)} grids=${r.total}  ${r.status}  [${r.layout}]`)
  }
  if (none.length) {
    console.log('\n  --- no grid data (excluded) ---')
    for (const r of none) console.log(`    ${r.name.padEnd(38)} uex=${r.scu}`)
  }
  console.log('\n  --- datamine-fallback ships (approx positions) ---')
  for (const r of dm) console.log(`    ${r.name.padEnd(38)} total=${r.total}`)
  console.log('\n  --- spot checks (total / loadable / layout) ---')
  for (const n of [
    'Drake Ironclad',
    'Drake Ironclad Assault',
    'Aegis Retaliator',
    'Gatac Railen',
    'Crusader C2 Hercules Starlifter',
    'MISC Hull B'
  ]) {
    const r = report.find((x) => x.name === n)
    if (r) console.log(`    ${n.padEnd(36)} total=${r.total}  loadable=${r.loadable}  [${r.layout}]`)
  }
}

main()
