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

  const hashes = {}
  for (const s of specs) {
    const data = s.map(await fetchData(s.endpoint, token))
    // No timestamp: keep the file a pure function of the data so re-running only
    // produces a diff (and a new hash) when the lists actually change.
    const doc = { source: `${BASE}/${s.endpoint}`, [s.key]: data }
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
