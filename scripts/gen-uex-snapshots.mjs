// Rebuilds the bundled UEX data in data/uex (needs a UEX token).
// npm run gen:uex

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { build } from 'esbuild'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT_DIR = path.join(ROOT, 'data', 'uex')
const BASE = 'https://uexcorp.space/api/2.0'

function readToken() {
  if (process.env.UEX_TOKEN) return process.env.UEX_TOKEN
  try {
    const p = path.join(os.homedir(), 'AppData', 'Roaming', 'supercargo', 'settings.json')
    const t = JSON.parse(fs.readFileSync(p, 'utf8')).uexApiKey
    if (t) return t
  } catch {
    // no settings file
  }
  return null
}

async function loadMappers() {
  const tmp = path.join(os.tmpdir(), `uexmap-${process.pid}.mjs`)
  await build({
    entryPoints: [path.join(ROOT, 'src', 'shared', 'uexMap.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: tmp,
    logLevel: 'silent'
  })
  const mod = await import(`file://${tmp}`)
  fs.rmSync(tmp, { force: true })
  return mod
}

async function fetchData(endpoint, token) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`)
  const json = await res.json()
  if (json.status !== 'ok' || !Array.isArray(json.data)) throw new Error(`${endpoint}: unexpected response`)
  return json.data
}

// scunpacked: starmap for coords, trade_locations for the stops UEX misses
const RAW = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master'
const STARMAP_URL = `${RAW}/starmap_positions.json`
const TRADE_URL = `${RAW}/trade_locations.json`

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const stripCode = (s) => s.replace(/^[A-Z]{2,4}-[A-Z0-9]{1,4}\s+/, '')

async function fetchJson(url, label) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  return res.json()
}

async function fetchStarmap() {
  const entities = (await fetchJson(STARMAP_URL, 'starmap')).entities || []
  const byName = new Map()
  for (const e of entities) {
    if (typeof e.x !== 'number') continue
    if (!byName.has(norm(e.name))) byName.set(norm(e.name), e)
  }
  return { byName, entities }
}

// contract phrases come from a facility's ClassName; parse operator + body off it
// so the app resolves them instead of guessing by name

// body code to display name, per system
const STANTON_BODIES = {
  '1': 'Hurston', '1a': 'Arial', '1b': 'Aberdeen', '1c': 'Magda', '1d': 'Ita',
  '2': 'Crusader', '2a': 'Cellin', '2b': 'Daymar', '2c': 'Yela',
  '3': 'ArcCorp', '3a': 'Lyria', '3b': 'Wala',
  '4': 'microTech', '4a': 'Calliope', '4b': 'Clio', '4c': 'Euterpe'
}
const PYRO_BODIES = {
  '1': 'Pyro I', '2': 'Pyro II', '3': 'Pyro III', '4': 'Pyro IV', '5': 'Pyro V', '6': 'Pyro VI',
  '3a': 'Bloom', '5a': 'Ignis', '5b': 'Vatra', '5c': 'Adir', '5d': 'Fairo', '5e': 'Fuego'
}
// facility-type words, not operator brands
const NON_OPERATOR = /^(Col|Colonial|Mining|MiningFacility|IndyMining|IndyFarmer|Abandoned|Aban|Admin|EMShelter|DrugLab|Stash|Derelict)$/i

function classInfo(className) {
  if (!className) return {}
  const parts = className.split('_')
  let system, code
  for (const p of parts) {
    const m = /^(stanton|pyro|nyx)(\d)([a-e])?$/i.exec(p)
    if (m) {
      system = m[1].toLowerCase()
      code = m[2] + (m[3] ? m[3].toLowerCase() : '')
      break
    }
  }
  if (!code && /^DC_Stan_/i.test(className)) {
    const m = /_S(\d)(?:_|$)/.exec(className)
    if (m) {
      system = 'stanton'
      code = m[1]
    }
  }
  let operator
  if (/^Outpost_/i.test(className) && parts[1] && !NON_OPERATOR.test(parts[1])) operator = parts[1]
  else if (/^DC_Stan_/i.test(className) && parts[2] && !NON_OPERATOR.test(parts[2])) operator = parts[2]

  const table = system === 'pyro' ? PYRO_BODIES : system === 'stanton' ? STANTON_BODIES : null
  const body = table && code ? table[code] : undefined
  return { operator, body }
}

// interior rooms, not haulable stops
const INTERIOR_ROOM = new Set([
  'lobby', 'inventory center', 'security checkpoint', 'shipping area', 'storehouse',
  'on-call area', 'staging point', 'security compound', 'exterior zone 2',
  'security post', 'cargo deck', 'security office'
])
const SHIP_CLASS = /^(DRAK|MISC|RSI|AEGS|ANVL|ORIG|CRUS|BANU|GRIN|XIAN|XNAA|ARGO|GAMA|VNCL|KRIG|ESPR|TMBL)_/i
const DC_SUBZONE = /^DC_\w+_.+_(Lobby|Warehouse|Cargo\w*|Int|Transition|Security\w*|Refinery\w*|Shipping\w*|Storage|FOB|SideRoad|CombinedMarkupWing|CargoShop|Storehouse|Markup\w*)$/i

// hand-reviewed removals: rooms, dupes, templates, non-freight stops
const DENYLIST = new Set(
  `"The Orphanage"
Abandoned Section
Area 18
Ashburn Channel Aid Shelter
Barton Flats Aid Shelter
Bud's Growery
Checkmate
Checkmate at the L4 Lagrange of Pyro II
Dudley & Daughters at the L4 Lagrange of Pyro VI
Dunlow Ridge Aid Shelter
Eager Flats Aid Shelter
Endgame at the L3 Lagrange of Pyro VI
Flanagan's Ravine Aid Shelter
Gaslight at the L2 Lagrange of Pyro V
Grim HEX
HDMS-Bezdek on Arial
Hangar 11
Hangar 12
Hangar 13
Hangar 13 inside Dudley & Daughters at the L4 Lagrange of Pyro VI
Julep Ravine Aid Shelter
L19 Admin Office in Lorville
L19 Habs in Lorville
L19 Metro Station in Lorville
Maintenance Area-01
Maintenance Area-01 inside Dudley & Daughters at the L4 Lagrange of Pyro VI
Maintenance Area-02
Maintenance Area-02 inside Dudley & Daughters at the L4 Lagrange of Pyro VI
Maintenance Area-03
Megumi Refueling at the L5 Lagrange of Pyro VI
Orbituary above Pyro III
Outpost Depot
Outpost Landing Area
Outpost Main Building
Outpost Storage Shed
Outpost Warehouse
Patch City at the L3 Lagrange of Pyro III
Pyro 5a Abandoned Outpost
Pyro 5b Abandoned Outpost
Pyro I Abandoned Outpost
Pyro II Abandoned Outpost
Pyro III Abandoned Outpost
Pyro IV Abandoned Outpost
Pyro V Abandoned Outpost
Pyro VI Abandoned Outpost
Rat's Nest at the L5 Lagrange of Pyro V
Rayari
Rod's Fuel 'N Supplies at the L4 Lagrange of Pyro V
Ruin Station above Pyro VI
Starlight Service Station Entrance
Starlight Service Station Habs
Tamdon Plains Aid Shelter
Wolf Point Aid Shelter
a Landing Pad Locker in New Babbage
a Landing Pad Locker in Orison
a Private Landing Pad
a Salvage Yard on Daymar
a Salvage Yard on Wala
a stash house
the Terra Mills outpost on Cellin
the abandoned outpost on Cellin
the abandoned outpost on Daymar
the entrance inside Checkmate at the L4 Lagrange of Pyro II
the entrance inside Dudley & Daughters at the L4 Lagrange of Pyro VI
the entrance inside Endgame at the L3 Lagrange of Pyro VI
the entrance inside Gaslight at the L2 Lagrange of Pyro V
the entrance inside Megumi Refueling at the L5 Lagrange of Pyro VI
the entrance inside Orbituary above Pyro III
the entrance inside Patch City at the L3 Lagrange of Pyro III
the entrance inside Rat's Nest at the L5 Lagrange of Pyro V
the entrance inside Rod's Fuel 'N Supplies at the L4 Lagrange of Pyro V
the entrance inside Ruin Station above Pyro VI
the habs inside Checkmate at the L4 Lagrange of Pyro II
the habs inside Dudley & Daughters at the L4 Lagrange of Pyro VI
the habs inside Endgame at the L3 Lagrange of Pyro VI
the habs inside Gaslight at the L2 Lagrange of Pyro V
the habs inside Megumi Refueling at the L5 Lagrange of Pyro VI
the habs inside Orbituary above Pyro III
the habs inside Patch City at the L3 Lagrange of Pyro III
the habs inside Rat's Nest at the L5 Lagrange of Pyro V
the habs inside Rod's Fuel 'N Supplies at the L4 Lagrange of Pyro V
the habs inside Ruin Station above Pyro VI
the refinery inside Checkmate at the L4 Lagrange of Pyro II
the refinery inside Orbituary above Pyro III
the refinery inside Ruin Station above Pyro VI`.split('\n')
)

// real haulable facility (gateways added separately)
function isHaulableFacility(t) {
  const name = String(t.DisplayName || '').trim()
  const cn = String(t.ClassName || '')
  if (!name || name.includes('~')) return false
  if (/\bjump point\b/i.test(name) || /\bclinic\b/i.test(name)) return false
  if (INTERIOR_ROOM.has(name.toLowerCase())) return false
  if (SHIP_CLASS.test(cn) || /^Planet_/i.test(cn) || /^JumpPoint_/i.test(cn)) return false
  if (DC_SUBZONE.test(cn)) return false
  return true
}

// gateway stations keyed by name + system; coords from the starmap when present
function buildGateways(trade, entities) {
  const byKey = new Map()
  for (const e of entities) {
    if (e.type !== 'Manmade' || !/ Gateway$/.test(String(e.name || ''))) continue
    byKey.set(`${norm(e.name)}|${e.system}`, { name: e.name, system: e.system, x: e.x, y: e.y, z: e.z })
  }
  for (const t of trade) {
    const m = /^JumpPoint_([A-Za-z]+)-[A-Za-z]+$/.exec(String(t.ClassName || ''))
    const name = String(t.DisplayName || '').trim()
    if (!m || !/ Gateway$/.test(name)) continue
    const system = m[1].toLowerCase()
    const key = `${norm(name)}|${system}`
    if (!byKey.has(key)) byKey.set(key, { name, system })
  }
  return [...byKey.values()].map((g) => ({
    // "Nyx Gateway" exists in two systems, so qualify it
    name: `${g.name} (${g.system.charAt(0).toUpperCase()}${g.system.slice(1)})`,
    code: '',
    maxContainerSize: 0,
    uexId: 0,
    hasElevator: true,
    ...(typeof g.x === 'number' ? { x: g.x, y: g.y, z: g.z } : {}),
    system: g.system
  }))
}

// spaceports have no starmap entity; they borrow their city's coords
const SPACEPORT_CITY = {
  rikermemorialspaceport: 'Area18',
  teasaspaceport: 'Lorville',
  nbintspaceport: 'New Babbage',
  newbabbageinterstellarspaceport: 'New Babbage',
  augustdunlowspaceport: 'Orison'
}

// UEX terminals + game-file facilities + gateways, coords from the starmap
function buildLocations(locations, starmap, trade) {
  const { byName, entities } = starmap
  // shortest ClassName per name is the top-level facility
  const classByName = new Map()
  for (const t of trade) {
    const nm = norm(t.DisplayName)
    const cn = String(t.ClassName || '')
    if (!nm || !cn) continue
    const prev = classByName.get(nm)
    if (!prev || cn.length < prev.length) classByName.set(nm, cn)
  }
  const enrich = (l) => {
    const cn = classByName.get(norm(l.name)) || classByName.get(norm(stripCode(l.name)))
    if (cn) {
      const { operator, body } = classInfo(cn)
      if (operator) l.operator = operator
      if (body) l.body = body
    }
  }
  const attachCoords = (l) => {
    const e = byName.get(norm(l.name)) || byName.get(norm(stripCode(l.name)))
    if (e) {
      l.x = e.x
      l.y = e.y
      l.z = e.z
      l.system = e.system
    }
  }

  // drop UEX gateways (re-added from starmap) and the curated removals
  const out = locations.filter((l) => !/ Gateway$/.test(l.name) && !DENYLIST.has(l.name))
  for (const l of out) {
    attachCoords(l)
    enrich(l)
  }

  const have = new Set()
  for (const l of out) {
    have.add(norm(l.name))
    have.add(norm(stripCode(l.name)))
  }

  let added = 0
  for (const t of trade) {
    if (!isHaulableFacility(t)) continue
    if (DENYLIST.has(String(t.DisplayName).trim())) continue
    const nm = norm(t.DisplayName)
    if (have.has(nm)) continue
    have.add(nm)
    const e = byName.get(nm)
    const { operator, body } = classInfo(t.ClassName)
    out.push({
      name: String(t.DisplayName).trim(),
      code: '',
      maxContainerSize: 0,
      uexId: 0,
      hasElevator: true,
      ...(e ? { x: e.x, y: e.y, z: e.z, system: e.system } : {}),
      ...(operator ? { operator } : {}),
      ...(body ? { body } : {})
    })
    added++
  }

  const gateways = buildGateways(trade, entities)
  out.push(...gateways)

  // spaceports inherit their city's coords
  const byNorm = new Map(out.map((l) => [norm(l.name), l]))
  for (const l of out) {
    if (typeof l.x === 'number') continue
    const city = byNorm.get(norm(SPACEPORT_CITY[norm(l.name)] || ''))
    if (city && typeof city.x === 'number') {
      l.x = city.x
      l.y = city.y
      l.z = city.z
      l.system = city.system
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name) || String(a.system).localeCompare(String(b.system)))
  const located = out.filter((l) => typeof l.x === 'number').length
  return { list: out, located, added, gateways: gateways.length }
}

async function main() {
  const token = readToken()
  if (!token) {
    console.error('No UEX token. Set UEX_TOKEN, or set your app token in Settings -> UEX first.')
    process.exit(1)
  }

  const { vehiclesToShips, terminalsToLocations, commoditiesToList } = await loadMappers()
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const specs = [
    { file: 'ships', endpoint: 'vehicles', key: 'ships', map: vehiclesToShips },
    { file: 'locations', endpoint: 'terminals', key: 'locations', map: terminalsToLocations },
    { file: 'commodities', endpoint: 'commodities', key: 'commodities', map: commoditiesToList }
  ]

  const starmap = await fetchStarmap()
  const trade = await fetchJson(TRADE_URL, 'trade_locations')

  const hashes = {}
  for (const s of specs) {
    let data = s.map(await fetchData(s.endpoint, token))
    let source = `${BASE}/${s.endpoint}`
    if (s.key === 'locations') {
      const built = buildLocations(data, starmap, trade)
      data = built.list
      source = `${source} + scunpacked starmap_positions + trade_locations`
      console.log(
        `  locations: ${data.length} total, ${built.located} with coords, +${built.added} game-file facilities, +${built.gateways} gateways`
      )
    }
    // no timestamp, so reruns only diff on real changes
    const doc = { source, [s.key]: data }
    const json = JSON.stringify(doc, null, 2) + '\n'
    fs.writeFileSync(path.join(OUT_DIR, `${s.file}.json`), json)
    hashes[s.file] = crypto.createHash('sha256').update(json).digest('hex')
    console.log(`  ${s.file}.json  ${data.length} entries`)
  }
  // keep the authored grid-faces hash in the manifest
  try {
    const gfPath = path.join(OUT_DIR, 'grid-faces.json')
    if (fs.existsSync(gfPath)) {
      hashes.gridFaces = crypto.createHash('sha256').update(fs.readFileSync(gfPath)).digest('hex')
      console.log('  grid-faces.json  (authored, hash preserved)')
    }
  } catch (e) {
    console.warn('  grid-faces hash skipped:', e.message)
  }
  fs.writeFileSync(path.join(OUT_DIR, 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n')
  console.log(`wrote ${OUT_DIR}`)
  console.log('hashes:', hashes)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
