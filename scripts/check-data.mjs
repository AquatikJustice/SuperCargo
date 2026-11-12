// run before pushing data/uex; --fix rehashes and adds missing roster entries
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'data', 'uex')
const fix = process.argv.includes('--fix')

const FILES = {
  ships: 'ships.json',
  locations: 'locations.json',
  commodities: 'commodities.json',
  gridFaces: 'grid-faces.json',
  contractOverrides: 'contract-overrides.json'
}
const SIZES = [1, 2, 4, 8, 16, 24, 32]

const errors = []
const warnings = []
const sha = (t) => createHash('sha256').update(t).digest('hex')
const read = (f) => readFileSync(join(dir, f), 'utf8')
const write = (f, j) => writeFileSync(join(dir, f), JSON.stringify(j, null, 2) + '\n')

// app's own grid code, same answer users get
const out = await build({
  stdin: {
    contents: `export * from './src/shared/cargoGrids'
export { withModules } from './src/shared/shipModules'
export { isRosterShip } from './src/shared/uexMap'`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
  alias: { '@shared': join(root, 'src', 'shared') }
})
const app = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const docs = {}
for (const [key, file] of Object.entries(FILES)) {
  let text
  try {
    text = read(file)
  } catch {
    errors.push(`${file} is missing`)
    continue
  }
  if (text.includes('\r')) errors.push(`${file} has CRLF line endings, the hash won't match the repo copy`)
  try {
    docs[key] = JSON.parse(text)
    if (!Array.isArray(docs[key][key])) errors.push(`${file} needs a top-level "${key}" array or the app skips it`)
  } catch (e) {
    errors.push(`${file} isn't valid JSON: ${e.message}`)
  }
}

const loose = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
for (const [list, label] of [[docs.locations?.locations, 'locations.json'], [docs.commodities?.commodities, 'commodities.json']]) {
  const owner = new Map((list ?? []).map((x) => [loose(x.name), x.name]))
  for (const x of list ?? []) {
    if (x.aliases === undefined) continue
    if (!Array.isArray(x.aliases) || x.aliases.some((a) => typeof a !== 'string' || !a.trim())) {
      errors.push(`${label}: ${x.name} aliases should be a list of names`)
      continue
    }
    for (const a of x.aliases) {
      const other = owner.get(loose(a))
      if (other && other !== x.name) errors.push(`${label}: alias "${a}" on ${x.name} clashes with ${other}`)
      owner.set(loose(a), x.name)
    }
  }
}

const ships = docs.ships?.ships ?? []
const faces = docs.gridFaces?.gridFaces ?? []
app.setGridFaces(faces)
const roster = app.withModules(ships.filter((s) => app.isRosterShip(s.name)))
const canon = (n) => n.replace(/ Mk I?V /, ' ')
const rosterByName = new Map(roster.map((s) => [canon(s.name), s]))

for (const [list, label] of [[ships, 'ships.json'], [faces.map((f) => ({ name: f.ship })), 'grid-faces.json']]) {
  const seen = new Set()
  for (const s of list) {
    if (seen.has(s.name)) errors.push(`${s.name} is in ${label} twice`)
    seen.add(s.name)
  }
}

let rosterChanged = false
for (const f of faces) {
  const visible = f.bays.filter((b) => !b.hidden)
  if (!visible.length) continue
  const ship = rosterByName.get(canon(f.ship))
  const grids = app.gridsFor(f.ship)
  const bundled = grids.some((g) => g.source !== 'override')
  const moduleIds = [...new Set(f.bays.map((b) => b.moduleId).filter(Boolean))]

  if (!ship) {
    if (moduleIds.length) {
      errors.push(`${f.ship} has module bays but no ships.json entry; add it with its modules by hand`)
    } else if (fix) {
      const caps = app.loadableGrids(f.ship).map((g) => g.maxSize ?? 32)
      const max = caps.length ? Math.max(...caps) : 32
      ships.push({ name: f.ship, scu: app.gridCapacity(f.ship), uexId: 0, containerSizes: SIZES.filter((s) => s <= max) })
      ships.sort((a, b) => a.name.localeCompare(b.name))
      rosterChanged = true
      console.log(`added ${f.ship} to ships.json at ${app.gridCapacity(f.ship)} SCU`)
    } else {
      errors.push(`${f.ship} has a layout but no ships.json entry, so it won't show in the ship picker (data:fix adds it)`)
    }
  }

  for (const id of moduleIds) {
    if (!ship?.modules?.some((m) => m.id === id))
      errors.push(`${f.ship}: bay module "${id}" isn't one of its ships.json modules, so that bay never shows`)
  }

  if (bundled) continue
  for (const b of visible) {
    if (b.w === undefined || b.l === undefined || b.h === undefined) warnings.push(`${f.ship} / ${b.id}: no size, the app skips this bay`)
    else if (b.maxSize === undefined && Math.max(0, ...(ship?.containerSizes ?? [])) < 32)
      warnings.push(`${f.ship} / ${b.id}: no max box size, so 32s are allowed though the ship doesn't take them`)
    if (!Object.values(b.faces ?? {}).some((k) => k === 'exit' || k === 'aisle'))
      warnings.push(`${f.ship} / ${b.id}: no exit or aisle face, unload order can't be planned`)
  }
  if (!f.frame) warnings.push(`${f.ship}: no front/right frame set, the 3D view guesses the front`)
}

for (const s of roster) {
  const all = s.modules?.map((m) => m.id)
  const cap = app.gridCapacity(s.name, all)
  if (!app.gridsFor(s.name, all).length) {
    ;(s.uexId === 0 ? errors : warnings).push(`${s.name} has no hold layout, all its cargo would go off grid`)
    continue
  }
  if (!app.CARGO_GRIDS[canon(s.name)] && !app.CARGO_GRIDS[s.name] && cap !== s.scu)
    warnings.push(`${s.name}: ships.json says ${s.scu} SCU, the layout holds ${cap}`)
  for (const m of s.modules ?? []) {
    if (!app.gridsFor(s.name, all).some((g) => g.moduleId === m.id))
      warnings.push(`${s.name}: module "${m.id}" has no bays, toggling it won't change the hold`)
  }
}

if (rosterChanged) write(FILES.ships, docs.ships)

let hashes = {}
try {
  hashes = JSON.parse(read('hashes.json'))
} catch {
  errors.push('hashes.json is missing or broken')
}
const want = {}
for (const [key, file] of Object.entries(FILES)) {
  try {
    want[key] = sha(read(file))
  } catch {
    /* reported above */
  }
}
// a new syncedAt keeps 0.9.1 clients from showing a stale grid
if (fix && docs.gridFaces && want.gridFaces !== hashes.gridFaces) {
  docs.gridFaces.syncedAt = new Date().toISOString()
  write(FILES.gridFaces, docs.gridFaces)
  want.gridFaces = sha(read(FILES.gridFaces))
}
const stale = Object.keys(want).filter((k) => hashes[k] !== want[k])
if (stale.length) {
  if (fix) {
    write('hashes.json', { ...hashes, ...want })
    console.log(`rehashed ${stale.join(', ')}`)
  } else {
    errors.push(`hashes.json is stale for ${stale.join(', ')}; installed apps would never pick these up (data:fix rehashes)`)
  }
}

for (const w of warnings) console.log(`warn: ${w}`)
for (const e of errors) console.log(`ERROR: ${e}`)
if (errors.length) process.exit(1)
console.log(`data ok: ${roster.length} ships, ${faces.length} layouts`)
