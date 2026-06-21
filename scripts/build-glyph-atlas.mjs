// Build a glyph atlas: pull real SC-font glyph bitmaps from (line-image, text)
// pairs so the training-data generator can build pixel-accurate samples.
//
// Two input sources (both optional, used together):
//   1. OCR confirm-modal harvest: %APPDATA%/supercargo/ocr-samples/data/<id>.png
//      plus <id>.json (the json's `text` is what the user confirmed). These are
//      clean mobiGlas line crops, the best real-font source.
//   2. A manual refs file (--refs <json>): [{ image, text, crop?:{x,y,w,h} }]
//      for hand-cropped lines whose text you type in.
//
// Steps per image: binarize (Otsu) -> split into text rows (horizontal
// projection) -> split each row into glyphs (vertical projection) -> match the
// boxes 1:1 with the non-space characters of that row's label -> save each glyph
// as an alpha cutout (alpha = normalized ink, so glyphs draw onto any
// background). Output:
//   <out>/glyphs/<codepoint>/<n>.png
//   <out>/atlas.json     { glyphs:{char:{cp,samples:[{file,w,h}]}}, meta:{...} }
//
// Usage:
//   node scripts/build-glyph-atlas.mjs --out glyph-atlas [--refs refs.json]
//                                      [--samples <dir>] [--minlum 70]

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const args = process.argv.slice(2)
const getArg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const OUT = path.resolve(getArg('out', 'glyph-atlas'))
const REFS = getArg('refs', '')
const SAMPLES = getArg('samples', path.join(os.homedir(), 'AppData', 'Roaming', 'supercargo', 'ocr-samples', 'data'))
const GLYPH_DIR = path.join(OUT, 'glyphs')

// ---- pixel helpers ----------------------------------------------------------

async function loadPixels(buf) {
  const img = await loadImage(buf)
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, img.width, img.height)
  const w = img.width, h = img.height
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  return { lum, w, h }
}

/** Otsu threshold for a luminance array. */
function otsu(lum) {
  const hist = new Array(256).fill(0)
  for (const v of lum) hist[Math.min(255, Math.max(0, v | 0))]++
  const total = lum.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, max = 0, thresh = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > max) { max = between; thresh = i }
  }
  return thresh
}

/** Find runs of consecutive indices where pred(i) is true. */
function runs(length, pred, minGap = 1) {
  const out = []
  let start = -1, gap = 0
  for (let i = 0; i < length; i++) {
    if (pred(i)) {
      if (start < 0) start = i
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap >= minGap) { out.push([start, i - gap + 1]); start = -1; gap = 0 }
    }
  }
  if (start >= 0) out.push([start, length - gap])
  return out
}

// ---- segmentation -----------------------------------------------------------

function segmentRows(lum, w, h, thresh) {
  const rowInk = new Array(h).fill(0)
  for (let y = 0; y < h; y++) {
    let c = 0
    for (let x = 0; x < w; x++) if (lum[y * w + x] > thresh) c++
    rowInk[y] = c
  }
  // A row counts as text if it has a few ink pixels; allow 1px gaps inside a line.
  return runs(h, (y) => rowInk[y] > Math.max(1, w * 0.01), 2)
}

function segmentGlyphs(lum, w, y0, y1, thresh) {
  const bandH = y1 - y0
  const colInk = new Array(w).fill(0)
  for (let x = 0; x < w; x++) {
    let c = 0
    for (let y = y0; y < y1; y++) if (lum[y * w + x] > thresh) c++
    colInk[x] = c
  }
  // Treat ~12% of band height as the gap between glyphs; runs() minGap handles it.
  const gap = Math.max(1, Math.round(bandH * 0.12))
  const boxes = runs(w, (x) => colInk[x] > 0, gap)
  // trim each box to its real top and bottom
  return boxes.map(([x0, x1]) => {
    let ty = y1, by = y0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (lum[y * w + x] > thresh) { if (y < ty) ty = y; if (y >= by) by = y + 1 }
    }
    return { x0, x1, y0: Math.min(ty, by - 1), y1: Math.max(by, ty + 1) }
  })
}

// ---- glyph extraction -------------------------------------------------------

const atlas = { glyphs: {}, meta: { sources: 0, lines: 0, mismatches: 0, gapWidths: [], bandHeights: [] } }
const counters = {}

function saveGlyph(lum, w, box, thresh, ch, bandTop, bandH) {
  const gw = box.x1 - box.x0, gh = box.y1 - box.y0
  if (gw < 1 || gh < 1) return
  const canvas = createCanvas(gw, gh)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(gw, gh)
  // Alpha = normalized ink above threshold; RGB = white (tint when drawing).
  let maxv = thresh + 1
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const v = lum[(box.y0 + y) * w + (box.x0 + x)]
    if (v > maxv) maxv = v
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const v = lum[(box.y0 + y) * w + (box.x0 + x)]
    const a = v <= thresh ? 0 : Math.min(1, (v - thresh) / (maxv - thresh))
    const o = (y * gw + x) * 4
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
    img.data[o + 3] = Math.round(a * 255)
  }
  ctx.putImageData(img, 0, 0)

  const cp = ch.codePointAt(0)
  const dir = path.join(GLYPH_DIR, String(cp))
  fs.mkdirSync(dir, { recursive: true })
  counters[cp] = (counters[cp] || 0) + 1
  const file = path.join('glyphs', String(cp), `${counters[cp]}.png`)
  fs.writeFileSync(path.join(OUT, file), canvas.toBuffer('image/png'))

  const g = (atlas.glyphs[ch] ||= { cp, samples: [] })
  // `top` = glyph ink offset from the line band top, so drawing can place
  // ascenders/descenders on a common baseline. `bandH` = the row height.
  g.samples.push({ file, w: gw, h: gh, top: box.y0 - bandTop, bandH })
}

async function processPair(buf, text, crop) {
  let { lum, w, h } = await loadPixels(buf)
  if (crop) {
    // cut the sub-rectangle out of the full image
    const { x, y, w: cw, h: ch } = crop
    const out = new Float32Array(cw * ch)
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) out[j * cw + i] = lum[(y + j) * w + (x + i)]
    lum = out; w = cw; h = ch
  }
  const thresh = otsu(lum)
  const rows = segmentRows(lum, w, h, thresh)
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length)
  atlas.meta.sources++

  // Match detected rows to label lines by position; counts must be equal.
  if (rows.length !== lines.length) {
    atlas.meta.mismatches++
    return { ok: false, reason: `rows ${rows.length} != lines ${lines.length}` }
  }
  let saved = 0
  for (let r = 0; r < rows.length; r++) {
    const [y0, y1] = rows[r]
    const lineText = lines[r]
    const chars = [...lineText].filter((c) => c !== ' ')
    const boxes = segmentGlyphs(lum, w, y0, y1, thresh)
    atlas.meta.lines++
    if (boxes.length !== chars.length) {
      atlas.meta.mismatches++
      continue // skip the unclear line so misaligned glyphs don't get into the atlas
    }
    atlas.meta.bandHeights.push(y1 - y0)
    for (let i = 0; i < boxes.length; i++) {
      if (i > 0) atlas.meta.gapWidths.push(boxes[i].x0 - boxes[i - 1].x1)
      saveGlyph(lum, w, boxes[i], thresh, chars[i], y0, y1 - y0)
      saved++
    }
  }
  return { ok: true, saved }
}

// ---- gather inputs ----------------------------------------------------------

async function run() {
  fs.mkdirSync(GLYPH_DIR, { recursive: true })
  const inputs = []

  if (fs.existsSync(SAMPLES)) {
    for (const f of fs.readdirSync(SAMPLES)) {
      if (!f.endsWith('.json')) continue
      const png = path.join(SAMPLES, f.replace(/\.json$/, '.png'))
      if (!fs.existsSync(png)) continue
      try {
        const text = JSON.parse(fs.readFileSync(path.join(SAMPLES, f), 'utf8')).text
        if (text) inputs.push({ buf: fs.readFileSync(png), text })
      } catch { /* skip */ }
    }
  }
  if (REFS && fs.existsSync(REFS)) {
    const refs = JSON.parse(fs.readFileSync(REFS, 'utf8'))
    for (const r of refs) {
      const p = path.resolve(path.dirname(REFS), r.image)
      if (r.text && fs.existsSync(p)) inputs.push({ buf: fs.readFileSync(p), text: r.text, crop: r.crop })
    }
  }

  if (inputs.length === 0) {
    console.log('No (image,text) inputs found.')
    console.log(`  OCR samples dir: ${SAMPLES} ${fs.existsSync(SAMPLES) ? '(empty)' : '(missing)'}`)
    console.log('  Capture + confirm a few contracts in the app (enable "Save training samples"),')
    console.log('  or pass --refs <json> with hand-cropped { image, text } line entries.')
    return
  }

  let saved = 0
  for (const inp of inputs) {
    const res = await processPair(inp.buf, inp.text, inp.crop)
    if (res.ok) saved += res.saved
  }

  const gaps = atlas.meta.gapWidths
  atlas.meta.avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 6
  const bh = atlas.meta.bandHeights
  atlas.meta.lineHeight = bh.length ? Math.round(bh.reduce((a, b) => a + b, 0) / bh.length) : 32
  delete atlas.meta.gapWidths
  delete atlas.meta.bandHeights
  fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(atlas, null, 2))

  const chars = Object.keys(atlas.glyphs).sort()
  console.log(`Glyph atlas -> ${OUT}`)
  console.log(`  inputs: ${inputs.length}  lines: ${atlas.meta.lines}  mismatches: ${atlas.meta.mismatches}`)
  console.log(`  glyphs saved: ${saved}  unique chars: ${chars.length}`)
  console.log(`  coverage: ${chars.map((c) => (c === ' ' ? '␠' : c)).join('')}`)
}

run().catch((e) => { console.error(e); process.exit(1) })
