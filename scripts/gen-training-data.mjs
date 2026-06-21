// Synthetic OCR training-data generator.
//
// Makes labeled images for the custom contract-screen OCR model. Each sample
// renders a real game objective template (verified from Data.p4k / StarStrings,
// see docs/PROGRESS.md) filled with real commodity + location names (from the
// local UEX cache), so every image comes with perfect ground truth. A stand-in
// font (Bahnschrift, a DIN-like face close to SC's mobiGlas UI) plus light
// capture-style augmentation is used until a glyph atlas is clipped from real
// screenshots.
//
// Usage:
//   node scripts/gen-training-data.mjs --count 500 --out training-data [--seed 42]
//
// Output:
//   <out>/images/<id>.png      the rendered line(s)
//   <out>/images/<id>.txt      ground-truth transcription
//   <out>/labels.jsonl         one JSON record per sample (image, text, fields)
//
// NOTE: the corpus embeds CIG commodity/location names, so keep <out> out of git
// (already in .gitignore). Nothing here is redistributed; it's generated locally.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'

// ---- args -------------------------------------------------------------------

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const COUNT = parseInt(getArg('count', '300'), 10)
const OUT = path.resolve(getArg('out', 'training-data'))
const SEED = parseInt(getArg('seed', String(Date.now() % 2147483647)), 10)
// Font accuracy options:
//   --font-file <path.ttf>  render with a real font, if you can source the SC UI face
//                           (NOTE: the Fankit "fonts" are in-fiction alien scripts, NOT
//                           the Latin UI font, so there is no clean shortcut to it)
//   --atlas <dir>           build from a real-glyph atlas (build-glyph-atlas.mjs); the
//                           most accurate path: real glyphs clipped from real captures
const FONT_FILE = getArg('font-file', '')
const ATLAS_DIR = getArg('atlas', '')

// ---- seeded RNG (reproducible runs) ----------------------------------------

let _s = SEED >>> 0
const rnd = () => {
  // mulberry32
  _s |= 0
  _s = (_s + 0x6d2b79f5) | 0
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const chance = (p) => rnd() < p

// ---- fonts ------------------------------------------------------------------

// Blender Pro Medium is the real SC UI face (commercial, not bundled). We only
// use a locally-installed copy if present, and fall back to Bahnschrift.
function findBlenderPro() {
  const dirs = [
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
    'C:\\Windows\\Fonts'
  ]
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (/blender.*pro.*medium/i.test(f)) return path.join(d, f)
      }
    } catch {
      /* skip */
    }
  }
  return null
}

const blenderPro = findBlenderPro()
const WIN_FONTS = [
  ...(blenderPro ? [[blenderPro, 'BlenderPro']] : []),
  ['C:\\Windows\\Fonts\\bahnschrift.ttf', 'Bahnschrift'],
  ['C:\\Windows\\Fonts\\segoeui.ttf', 'Segoe UI'],
  ['C:\\Windows\\Fonts\\consola.ttf', 'Consolas']
]
const FONTS = []
for (const [p, name] of WIN_FONTS) {
  try {
    if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, name)) FONTS.push(name)
  } catch {
    /* skip */
  }
}
if (FONTS.length === 0) FONTS.push('sans-serif')
// A real font file (e.g. the SC UI / Fankit font) overrides the stand-ins.
if (FONT_FILE) {
  try {
    if (GlobalFonts.registerFromPath(path.resolve(FONT_FILE), 'CustomUI')) {
      FONTS.length = 0
      FONTS.push('CustomUI')
    }
  } catch (err) {
    console.warn(`[font] could not load --font-file ${FONT_FILE}:`, err.message)
  }
}
// Prefer the real SC face (Blender Pro) when installed, else use Bahnschrift
// (the closest stock DIN stand-in). Weight the preferred face heavily, but keep
// a little of the others for augmentation variety.
const PREFERRED = FONTS.includes('BlenderPro') ? 'BlenderPro' : 'Bahnschrift'
const FONT_BAG = FONTS.flatMap((f) => (f === PREFERRED ? [f, f, f, f, f] : [f]))

// ---- real entity names (UEX cache) + fallbacks -----------------------------

function loadNames(file, key, field) {
  try {
    const p = path.join(os.homedir(), 'AppData', 'Roaming', 'supercargo', file)
    const json = JSON.parse(fs.readFileSync(p, 'utf8'))
    const list = (json[key] || []).map((x) => x[field]).filter(Boolean)
    if (list.length) return list
  } catch {
    /* fall through */
  }
  return null
}

const COMMODITIES =
  loadNames('uex-commodities.json', 'commodities', 'name') ??
  ['Titanium', 'Hydrogen Fuel', 'Quantanium', 'Agricultural Supplies', 'Medical Supplies', 'Scrap', 'Aluminum', 'Processed Food', 'Stims', 'Distilled Spirits']
const LOCATIONS =
  loadNames('uex-locations.json', 'locations', 'name') ??
  ['HUR-L1 Green Glade Station', 'ARC-L1 Wide Forest Station', 'Everus Harbor', 'Baijini Point', 'Port Tressler', 'CRU-L1 Ambitious Dream Station', 'Seraphim Station', 'GrimHEX']

// ---- objective templates (REAL formats) ------------------------------------

const BOX_SIZES = [1, 2, 4, 8, 16, 24, 32]

function makeSample() {
  const item = pick(COMMODITIES)
  const dest = pick(LOCATIONS)
  const total = pick([ri(1, 32), ri(1, 32) * ri(1, 8), ri(1, 600)])
  const done = chance(0.55) ? 0 : ri(0, total)
  const box = pick(BOX_SIZES)
  const nBoxes = ri(2, 48)

  const templates = [
    // panel (mobiGlas detail list) - weighted highest
    () => ({ tmpl: 'panel', lines: [item, `${dest}: ${done}/${total} SCU`] }),
    () => ({ tmpl: 'panel', lines: [item, `${dest}: ${done}/${total} SCU`] }),
    () => ({ tmpl: 'panel', lines: [item, `${dest}: ${done}/${total} SCU`] }),
    // inline deliver (marker / objective)
    () => ({ tmpl: 'deliver', lines: [`Deliver ${done}/${total} SCU of ${item} to ${dest}`] }),
    () => ({ tmpl: 'deliver', lines: [`Deliver ${done}/${total} SCU of ${item} to ${dest}`] }),
    // delivered (unlimited)
    () => ({ tmpl: 'delivered', lines: [`${total} SCU of ${item} Delivered to ${dest}`] }),
    // return (no destination)
    () => ({ tmpl: 'return', lines: [`Deliver ${done}/${total} SCU of ${item}.`] }),
    // box-size description fragment
    () => ({
      tmpl: 'box',
      lines: [`Deliver the ${nBoxes} cargo boxes (all ${box} SCU or smaller) to a freight elevator at ${dest}.`]
    })
  ]
  const t = pick(templates)()
  return {
    template: t.tmpl,
    lines: t.lines,
    text: t.lines.join('\n'),
    fields: { commodity: item, destination: dest, scuAmount: total, maxBoxSize: t.tmpl === 'box' ? box : undefined }
  }
}

// ---- rendering --------------------------------------------------------------

const TEXT_COLORS = ['#e8f2f9', '#d4e4ee', '#cfd3d4', '#ffffff']
const ACCENT = '#9fc6d6'

// near-black holo panel background with a faint tint + optional gradient + noise
function drawBg(ctx, w, h) {
  const base = ri(0, 10)
  if (chance(0.5)) {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, `rgb(${base},${base + 2},${base + 4})`)
    g.addColorStop(1, `rgb(0,0,${ri(0, 6)})`)
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = `rgb(${base},${base},${base + 3})`
  }
  ctx.fillRect(0, 0, w, h)
  if (chance(0.6)) {
    const n = ri(20, 120)
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(rnd() * 0.05).toFixed(3)})`
      ctx.fillRect(ri(0, w), ri(0, h), 1, 1)
    }
  }
}

// capture-style softening: downscale then upscale
function soften(ctx, canvas, w, h) {
  if (!chance(0.4)) return
  const f = 0.6 + rnd() * 0.25
  const small = createCanvas(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f)))
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(small, 0, 0, w, h)
}

// --- stand-in-font renderer (Bahnschrift etc., or --font-file) ---
function render(sample) {
  const font = pick(FONT_BAG)
  const fontSize = ri(20, 40)
  const lineH = Math.round(fontSize * 1.45)
  const padX = ri(16, 40)
  const padY = ri(14, 30)

  const probe = createCanvas(10, 10).getContext('2d')
  probe.font = `${fontSize}px "${font}"`
  const widths = sample.lines.map((l) => probe.measureText(l).width)
  const w = Math.ceil(Math.max(...widths) + padX * 2)
  const h = Math.ceil(sample.lines.length * lineH + padY * 2)

  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  drawBg(ctx, w, h)

  ctx.textBaseline = 'middle'
  ctx.font = `${fontSize}px "${font}"`
  sample.lines.forEach((line, i) => {
    ctx.fillStyle = i === 1 && sample.template === 'panel' && chance(0.5) ? ACCENT : pick(TEXT_COLORS)
    const x = padX + (chance(0.5) ? ri(-2, 2) : 0)
    const y = padY + i * lineH + lineH / 2
    ctx.fillText(line, x, y)
  })

  soften(ctx, canvas, w, h)
  return { canvas, font, fontSize }
}

// --- real-glyph atlas renderer (--atlas): composite clipped SC-font glyphs ---
let ATLAS = null // { idx, cache } filled in during run setup when --atlas is given

function renderAtlas(sample) {
  const { idx, cache } = ATLAS
  const scale = ri(80, 140) / 100
  const lineH = Math.round(idx.meta.lineHeight * scale * 1.3)
  const gap = Math.max(1, Math.round(idx.meta.avgGap * scale))
  const spaceW = Math.round(idx.meta.lineHeight * scale * 0.35)
  const padX = ri(16, 36)
  const padY = ri(12, 24)

  const laid = sample.lines.map((line) => {
    const glyphs = []
    let x = 0
    for (const ch of [...line]) {
      const entry = ch === ' ' ? null : idx.glyphs[ch]
      if (!entry || !entry.samples.length) {
        x += spaceW + gap
        continue
      }
      const s = pick(entry.samples)
      glyphs.push({
        img: cache.get(s.file),
        x,
        top: Math.round(s.top * scale),
        gw: Math.max(1, Math.round(s.w * scale)),
        gh: Math.max(1, Math.round(s.h * scale))
      })
      x += Math.round(s.w * scale) + gap
    }
    return { glyphs, width: x }
  })

  const w = Math.ceil(Math.max(1, ...laid.map((l) => l.width)) + padX * 2)
  const h = Math.ceil(laid.length * lineH + padY * 2)
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  drawBg(ctx, w, h)
  laid.forEach((l, li) => {
    const baseY = padY + li * lineH
    for (const g of l.glyphs) if (g.img) ctx.drawImage(g.img, padX + g.x, baseY + g.top, g.gw, g.gh)
  })
  soften(ctx, canvas, w, h)
  return { canvas, font: 'atlas', fontSize: Math.round(idx.meta.lineHeight * scale) }
}

// ---- run --------------------------------------------------------------------

// Load the real-glyph atlas if requested (preload all glyph images).
if (ATLAS_DIR) {
  const idx = JSON.parse(fs.readFileSync(path.join(ATLAS_DIR, 'atlas.json'), 'utf8'))
  const cache = new Map()
  for (const ch of Object.keys(idx.glyphs)) {
    for (const s of idx.glyphs[ch].samples) {
      if (!cache.has(s.file)) cache.set(s.file, await loadImage(fs.readFileSync(path.join(ATLAS_DIR, s.file))))
    }
  }
  ATLAS = { idx, cache }
}
const renderer = ATLAS_DIR ? renderAtlas : render

const imagesDir = path.join(OUT, 'images')
fs.mkdirSync(imagesDir, { recursive: true })
const manifest = fs.createWriteStream(path.join(OUT, 'labels.jsonl'), { flags: 'w' })

const counts = {}
for (let i = 0; i < COUNT; i++) {
  const sample = makeSample()
  const { canvas, font, fontSize } = renderer(sample)
  const id = `s${String(i).padStart(5, '0')}`
  fs.writeFileSync(path.join(imagesDir, `${id}.png`), canvas.toBuffer('image/png'))
  fs.writeFileSync(path.join(imagesDir, `${id}.txt`), sample.text, 'utf8')
  manifest.write(
    JSON.stringify({ id, image: `images/${id}.png`, text: sample.text, template: sample.template, fields: sample.fields, font, fontSize }) + '\n'
  )
  counts[sample.template] = (counts[sample.template] || 0) + 1
}
manifest.end()

const mode = ATLAS_DIR ? `atlas(${ATLAS_DIR})` : FONT_FILE ? `font-file(${path.basename(FONT_FILE)})` : `stand-in(${FONTS.join(',')})`
console.log(`Generated ${COUNT} samples -> ${OUT}`)
console.log(`  seed: ${SEED}  mode: ${mode}`)
console.log(`  commodities: ${COMMODITIES.length}  locations: ${LOCATIONS.length}`)
console.log(`  by template: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`)
