// Regenerate the bundled UEX data the app ships and serves from the repo.
//
// On a game/UEX update: set a UEX token and run `npm run gen:uex`. It fetches
// the live vehicle/terminal/commodity feeds, runs them through the SAME mapping
// the app uses (src/shared/uexMap.ts, bundled here with esbuild so there's no
// duplicated logic to drift), and writes:
//
//   data/uex/ships.json        { source, syncedAt, ships: [...] }
//   data/uex/locations.json    { source, syncedAt, locations: [...] }
//   data/uex/commodities.json  { source, syncedAt, commodities: [...] }
//   data/uex/hashes.json       { ships: <sha256>, locations: ..., commodities: ... }
//
// These are committed to the repo. The app serves them over raw.githubusercontent
// at launch (no token needed) and ships the same files as an offline seed. The
// hashes are how the app decides what changed, so it only pulls the lists that
// actually moved.
//
// Token: env UEX_TOKEN, else settings.json (the dev's own app token).

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
    /* fall through */
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

// Game files (datamined by scunpacked). starmap carries x/y/z for every location
// (UEX exposes none); trade_locations is every place that trades cargo - the DCs,
// mining outposts, gateways and rest stops UEX is missing. We take the union and
// pull coordinates from the starmap.
const RAW = 'https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/master'
const STARMAP_URL = `${RAW}/starmap_positions.json`
const TRADE_URL = `${RAW}/trade_locations.json`
// Celestial bodies aren't deliverable - you haul to a facility, not a planet's core.
const BODY_TYPE = /^(star|planet|moon)$/i

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
  return byName
}

/** Attach starmap coordinates to the UEX locations, then union in every other
 *  cargo facility from the game files (with coords). Mutates and returns it. */
function augmentLocations(locations, byName, trade) {
  let located = 0
  for (const l of locations) {
    const e = byName.get(norm(l.name)) || byName.get(norm(stripCode(l.name)))
    if (e) {
      l.x = e.x
      l.y = e.y
      l.z = e.z
      l.system = e.system
      located++
    }
  }
  // dedup against UEX names, both full and code-stripped (UEX "HUR-L1 Green Glade
  // Station" vs the game file's bare "Green Glade Station").
  const have = new Set()
  for (const l of locations) {
    have.add(norm(l.name))
    have.add(norm(stripCode(l.name)))
  }
  const added = []
  for (const t of trade) {
    const nm = norm(t.DisplayName)
    if (!nm || have.has(nm)) continue
    const e = byName.get(nm)
    if (!e || BODY_TYPE.test(e.type)) continue
    have.add(nm)
    locations.push({
      name: t.DisplayName,
      code: '',
      maxContainerSize: 0,
      uexId: 0,
      hasElevator: true,
      x: e.x,
      y: e.y,
      z: e.z,
      system: e.system
    })
    added.push(t.DisplayName)
  }
  locations.sort((a, b) => a.name.localeCompare(b.name))
  return { located, added }
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

  const byName = await fetchStarmap()
  const trade = await fetchJson(TRADE_URL, 'trade_locations')

  const hashes = {}
  for (const s of specs) {
    const data = s.map(await fetchData(s.endpoint, token))
    let source = `${BASE}/${s.endpoint}`
    if (s.key === 'locations') {
      const { located, added } = augmentLocations(data, byName, trade)
      source = `${source} + scunpacked starmap_positions + trade_locations`
      console.log(`  starmap: ${located}/${data.length - added.length} UEX located, +${added.length} game-file facilities`)
    }
    // No timestamp: keep the file a pure function of the data so re-running only
    // produces a diff (and a new hash) when the lists actually change.
    const doc = { source, [s.key]: data }
    const json = JSON.stringify(doc, null, 2) + '\n'
    fs.writeFileSync(path.join(OUT_DIR, `${s.file}.json`), json)
    hashes[s.file] = crypto.createHash('sha256').update(json).digest('hex')
    console.log(`  ${s.file}.json  ${data.length} entries`)
  }
  fs.writeFileSync(path.join(OUT_DIR, 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n')
  console.log(`wrote ${OUT_DIR}`)
  console.log('hashes:', hashes)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
