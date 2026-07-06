// screen capture for OCR

import { desktopCapturer, screen, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import type { CropRect, DisplayInfo } from '@shared/types'

// Electron's numeric display id gets reassigned across a reboot, so key on
// position+resolution instead. Stable as long as the physical layout doesn't move.
function displayKey(d: Electron.Display): string {
  const b = d.bounds
  return `${b.x}_${b.y}_${b.width}x${b.height}`
}

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: displayKey(d),
    label: d.label || `Display ${i + 1} (${d.size.width}×${d.size.height})`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId
  }))
}

function resolveDisplay(displayId: string): Electron.Display {
  if (displayId) {
    // stable key, but still honor a numeric id saved before this change
    const found = screen
      .getAllDisplays()
      .find((d) => displayKey(d) === displayId || String(d.id) === displayId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

const GAME_WINDOW = /star\s*citizen/i

// exclusive fullscreen hands back a black frame; treat that as a miss so we fall back to display capture
function isMostlyBlack(img: NativeImage): boolean {
  const { width, height } = img.getSize()
  if (width < 4 || height < 4) return true
  const bmp = img.toBitmap() // BGRA
  const step = Math.max(4, (Math.floor(bmp.length / 4 / 5000) || 1) * 4)
  let lit = 0
  let checked = 0
  for (let i = 0; i + 2 < bmp.length; i += step) {
    checked++
    if (bmp[i] > 16 || bmp[i + 1] > 16 || bmp[i + 2] > 16) lit++
  }
  return checked > 0 && lit / checked < 0.01
}

// grab the game window's own surface so anything on top of it isn't in the shot
export async function captureGameWindow(): Promise<NativeImage | null> {
  const displays = screen.getAllDisplays()
  const width = Math.max(...displays.map((d) => d.size.width * (d.scaleFactor || 1)))
  const height = Math.max(...displays.map((d) => d.size.height * (d.scaleFactor || 1)))

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: Math.round(width), height: Math.round(height) }
  })
  const matches = sources.filter((s) => GAME_WINDOW.test(s.name) && !s.thumbnail.isEmpty())
  if (!matches.length) return null
  // biggest match is the game, not a tooltip or child window
  const img = matches.reduce((a, b) => {
    const sa = a.thumbnail.getSize()
    const sb = b.thumbnail.getSize()
    return sb.width * sb.height > sa.width * sa.height ? b : a
  }).thumbnail
  return isMostlyBlack(img) ? null : img
}

export async function captureDisplay(displayId: string): Promise<NativeImage | null> {
  const display = resolveDisplay(displayId)
  const scale = display.scaleFactor || 1
  const width = Math.round(display.size.width * scale)
  const height = Math.round(display.size.height * scale)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  })
  if (sources.length === 0) return null

  // match source to display
  const match =
    sources.find((s) => s.display_id && s.display_id === String(display.id)) ?? sources[0]
  const img = match.thumbnail
  return img.isEmpty() ? null : img
}

// crop to fractional rect
export function cropImage(img: NativeImage, crop: CropRect): NativeImage {
  const size = img.getSize()
  const rect = {
    x: Math.max(0, Math.round(crop.x * size.width)),
    y: Math.max(0, Math.round(crop.y * size.height)),
    width: Math.min(size.width, Math.round(crop.w * size.width)),
    height: Math.min(size.height, Math.round(crop.h * size.height))
  }
  // too small: use whole frame
  if (rect.width < 4 || rect.height < 4) return img
  if (rect.x + rect.width > size.width) rect.width = size.width - rect.x
  if (rect.y + rect.height > size.height) rect.height = size.height - rect.y
  return img.crop(rect)
}

// light preview for calibration
export function toPreviewDataUrl(img: NativeImage, maxWidth = 1280): string {
  const size = img.getSize()
  const scaled =
    size.width > maxWidth
      ? img.resize({ width: maxWidth, quality: 'good' })
      : img
  return scaled.toDataURL()
}

export function toPng(img: NativeImage): Buffer {
  return img.toPNG()
}

// upscale 2x for OCR
export function toUpscaledPng(img: NativeImage, factor = 2): Buffer {
  const { width, height } = img.getSize()
  if (factor <= 1 || width < 4 || height < 4) return img.toPNG()
  return img
    .resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' })
    .toPNG()
}

// grayscale for smaller samples
export function toGrayscalePng(img: NativeImage): Buffer {
  const { width, height } = img.getSize()
  const bmp = img.toBitmap() // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    const lum = Math.round(0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2])
    bmp[i] = bmp[i + 1] = bmp[i + 2] = lum
  }
  return nativeImage.createFromBitmap(bmp, { width, height }).toPNG()
}
