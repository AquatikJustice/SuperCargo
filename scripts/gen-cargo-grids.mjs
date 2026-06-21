// Generate src/shared/cargoGrids.ts - per-ship cargo-bay geometry WITH POSITIONS
// for the Phase 4 3D cargo grid view.
//
// PRIMARY SOURCE: sc-cargo.space (community cargo-bay layout tool, which in turn
// credits Ratjack's grid reference). Unlike the datamine/UEX, sc-cargo gives the
// real PER-GRID POSITION of every bay plus the way bays are split into physically
// separated groups and each grid's MaxSize. Its data is snapshotted, parsed, and
// committed at scripts/data/sccargo-ships.json (87 ships). Coordinate system:
//   x = width axis, y = up/height, z = length axis.
//   world position of a grid = (group.x + grid.x, grid.y, group.z + grid.z)  [cells]
//
// FALLBACK: ships sc-cargo doesn't cover fall back to the datamine grid list
// (scripts/data/datamine-grids.json, baked from scunpacked) laid out as a simple
// row of bays and flagged layout:'datamine' (positions approximate).
//
// NAMES: sc-cargo has no per-grid names, so we borrow the datamine grid name whose
// dimensions match (by sorted W/L/H); leftover grids get a generic "Bay N".
//
// OVERRIDE LAYER: grids missing from sc-cargo (Ironclad / Assault LIFT pads) and
// curated module bays (Aurora Mk II rack). Secure/lift grids are reference-only
// (autoLoad:false), shown in the view but the packer must never auto-fill them.
//
// Run:  node scripts/gen-cargo-grids.mjs   (npm run gen:grids)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ROSTER_TS = path.join(ROOT, 'src/shared/ships.ts')
const OUT_TS = path.join(ROOT, 'src/shared/cargoGrids.ts')
const SCCARGO = path.join(ROOT, 'scripts/data/sccargo-ships.json')
const DATAMINE = path.join(ROOT, 'scripts/data/datamine-grids.json')

// ---------- helpers ----------
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// must match shipModules.ts `slug`
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const dimKey = (w, l, h) => [w, l, h].sort((a, b) => a - b).join('x')

// ---------- roster (mirror uexMap.isRosterShip) ----------
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
  // de-dupe by name, keep first
  const seen = new Set()
  return out.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
}

// ---------- sc-cargo index ----------
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

// roster name -> [manufacturer, name] in sc-cargo (geometry verified identical).
const ALIAS = {
  'Argo MPUV Cargo': ['Argo', 'MPUV-C'],
  'Argo MPUV Tractor': ['Argo', 'MPUV-T'],
  'Crusader A2 Hercules Starlifter': ['Crusader', 'A2 Hercules'],
  'Crusader C2 Hercules Starlifter': ['Crusader', 'C2 Hercules'],
  'Crusader M2 Hercules Starlifter': ['Crusader', 'M2 Hercules'],
  'RSI Aurora Mk I CL': ['RSI', 'Aurora CL (Mk I)'],
  'RSI Aurora Mk I SE': ['RSI', 'Aurora CL (Mk I)'], // SE shares CL geometry (6 SCU)
  'RSI Aurora Mk I ES': ['RSI', 'Aurora ES (Mk I)'],
  'RSI Aurora Mk I LN': ['RSI', 'Aurora LN (Mk I)'],
  'RSI Aurora Mk I LX': ['RSI', 'Aurora LX (Mk I)'],
  'RSI Aurora Mk I MR': ['RSI', 'Aurora MR (Mk I)'],
  'RSI Aurora Mk II': ['RSI', 'Aurora (Mk II)'], // base 2 SCU; +curated rack module below
  'MISC Starfarer': ['MISC', 'Starfarer Gemini'], // identical bays
  'RSI Constellation Phoenix Emerald': ['RSI', 'Constellation Phoenix'], // paint variant
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
  // safe suffix only: roster name ends with the sc bare name (never mid-string,
  // which would wrongly fold "Freelancer MAX" into base "Freelancer").
  for (const [k, rec] of scIndex) {
    if (k && nn.endsWith(' ' + k)) return rec
  }
  return null
}

// ---------- per-ship overrides ----------
// Ships where sc-cargo's geometry is wrong/stale and UEX+datamine agree: use the
// datamine layout instead (e.g. Hammerhead: sc-cargo 64 vs UEX/datamine 40).
const PREFER_DATAMINE = new Set(['Aegis Hammerhead'])

// sc-cargo group index whose grids are reference-only (never auto-filled).
// Safety-critical, so kept explicit rather than name/heuristic-matched.
const REFERENCE_ONLY_GROUPS = { 'Drake Ironclad': [1] } // the Secured Cargo Bay

// sc-cargo group -> installable module id (so the view can show/hide by module).
const MODULE_OF = {
  // Retaliator: group with 36 SCU is the stern bay, 38 SCU is the bow trio.
  'Aegis Retaliator': (_gi, groupScu) =>
    groupScu === 36 ? 'aegis-retaliator-stern' : 'aegis-retaliator-bow'
}

// LIFT pads missing from sc-cargo (Ratjack-verified, patch 4.8.x). reference-only:
// cargo on an elevator can be dropped on a Quantum jump. Positioned clear of the
// hull so they read as separate pads in the view.
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

// Curated module bays not present in any source (real item dims unknown; SCU exact).
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

// ---------- builders ----------
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
    x += g.w + 1 // 1-cell aisle between bays
  })
  return grids
}

// ---------- overlap validation (ship-space AABB) ----------
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

// ---------- main ----------
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

/** All grids for a ship (for the view), optionally limited to installed modules. */
export function gridsFor(ship: string, installed?: string[]): CargoGrid[] {
  const rec = CARGO_GRIDS[ship]
  if (!rec) return []
  return rec.grids.filter((g) => !g.moduleId || !installed || installed.includes(g.moduleId))
}

/** Grids the packer may fill - gridsFor minus reference-only (secure/lift) bays. */
export function loadableGrids(ship: string, installed?: string[]): CargoGrid[] {
  return gridsFor(ship, installed).filter((g) => g.autoLoad !== false)
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
