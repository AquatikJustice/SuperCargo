// Generate the app icon set from resources/icon.svg (the cargo-stack logo).
//
//   node scripts/gen-icon.mjs
//
// Emits:
//   resources/icon.png   (512, used as the BrowserWindow/taskbar icon via ?asset)
//   build/icon.png       (512, electron-builder source)
//   build/icon.ico       (multi-size Windows icon: 16..256, PNG-compressed)
//
// Re-rasterizes the SVG at every size (sharper small icons than downscaling one
// big raster). Uses @napi-rs/canvas, already a devDependency.

import { loadImage, createCanvas } from '@napi-rs/canvas'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = fs.readFileSync(path.join(root, 'resources/icon.svg'))

async function renderPng(size) {
  const img = await loadImage(svg)
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

/** Pack PNG buffers into a Vista+ ICO file (each entry stored as a PNG). */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((e, i) => {
    const b = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0) // width (0 = 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1) // height
    dir.writeUInt8(0, b + 2) // palette
    dir.writeUInt8(0, b + 3) // reserved
    dir.writeUInt16LE(1, b + 4) // color planes
    dir.writeUInt16LE(32, b + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, b + 8) // bytes in resource
    dir.writeUInt32LE(offset, b + 12) // offset
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

fs.mkdirSync(path.join(root, 'build'), { recursive: true })

const big = await renderPng(512)
fs.writeFileSync(path.join(root, 'resources/icon.png'), big)
fs.writeFileSync(path.join(root, 'build/icon.png'), big)

const entries = []
for (const size of ICO_SIZES) entries.push({ size, png: await renderPng(size) })
fs.writeFileSync(path.join(root, 'build/icon.ico'), buildIco(entries))

console.log(`icon: wrote resources/icon.png, build/icon.png (512), build/icon.ico (${ICO_SIZES.join(',')})`)
