// drain ocr-samples bucket to a local training set, --delete clears it.
// needs SUPABASE_SECRET_KEY in env. never embed the secret key in the app.
//   node scripts/train/drain_supabase.mjs --out harvested --delete
// output matches gen-training-data.mjs (labels.jsonl + images/).

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const getArg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const DELETE = args.includes('--delete')

const BASE = getArg('url', 'https://rjljbmbuegqerhxyaypq.supabase.co')
const BUCKET = getArg('bucket', 'ocr-samples')
const OUT = path.resolve(getArg('out', 'harvested'))
const KEY = process.env.SUPABASE_SECRET_KEY

if (!KEY) {
  console.error('Set SUPABASE_SECRET_KEY (the project SECRET key) in the environment first.')
  process.exit(1)
}

const authHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function list(prefix) {
  const out = []
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    })
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status} ${await res.text()}`)
    const page = await res.json()
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

async function download(objectPath) {
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${objectPath}`, { headers: authHeaders })
  if (!res.ok) throw new Error(`get ${objectPath}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function remove(paths) {
  if (!paths.length) return
  const res = await fetch(`${BASE}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths })
  })
  if (!res.ok) console.warn(`delete failed: ${res.status} ${await res.text()}`)
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'images'), { recursive: true })
  const manifest = fs.createWriteStream(path.join(OUT, 'labels.jsonl'), { flags: 'a' })

  const folders = (await list('')).filter((e) => e.id === null).map((e) => e.name)
  const clients = folders.length ? folders : [''] // flat bucket fallback

  let saved = 0
  const toDelete = []
  for (const client of clients) {
    const prefix = client ? `${client}/` : ''
    const files = (await list(prefix)).filter((e) => e.id !== null).map((e) => prefix + e.name)
    const ids = new Set(files.filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')))
    for (const idPath of ids) {
      const pngPath = `${idPath}.png`
      const jsonPath = `${idPath}.json`
      if (!files.includes(jsonPath)) continue
      try {
        const [png, json] = await Promise.all([download(pngPath), download(jsonPath)])
        const label = JSON.parse(json.toString('utf8'))
        const safe = idPath.replace(/[\\/]/g, '_')
        fs.writeFileSync(path.join(OUT, 'images', `${safe}.png`), png)
        manifest.write(JSON.stringify({ id: safe, image: `images/${safe}.png`, text: label.text, source: 'harvested', client }) + '\n')
        toDelete.push(pngPath, jsonPath)
        saved++
      } catch (e) {
        console.warn('skip', idPath, e.message)
      }
    }
  }
  manifest.end()

  console.log(`drained ${saved} samples -> ${OUT}`)
  if (DELETE && toDelete.length) {
    for (let i = 0; i < toDelete.length; i += 500) await remove(toDelete.slice(i, i + 500))
    console.log(`cleared ${toDelete.length} objects from the bucket`)
  } else if (toDelete.length) {
    console.log(`(left ${toDelete.length} objects in the bucket, pass --delete to clear)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
