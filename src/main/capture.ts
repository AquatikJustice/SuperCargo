// Screen capture for the OCR pipeline (main process).
//
// We capture in the main process via desktopCapturer with the thumbnail sized to
// the display's full pixel resolution. This avoids renderer getUserMedia and any
// media permission prompts. The captured NativeImage is cropped to the calibrated
// mobiGlas panel and handed to the OCR pipeline as a PNG buffer.

import { desktopCapturer, screen, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import type { CropRect, DisplayInfo } from '@shared/types'

/** Enumerate displays the user can target for capture. */
export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: d.label || `Display ${i + 1} (${d.size.width}×${d.size.height})`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId
  }))
}

function resolveDisplay(displayId: string): Electron.Display {
  if (displayId) {
    const found = screen.getAllDisplays().find((d) => String(d.id) === displayId)
    if (found) return found
  }
  return screen.getPrimaryDisplay()
}

/**
 * Capture a full-resolution screenshot of the chosen display. Returns the
 * NativeImage, or null if no matching capture source was produced.
 */
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

  // Match the capture source to the requested display when the platform exposes
  // display_id; otherwise fall back to the first (single-monitor) source.
  const match =
    sources.find((s) => s.display_id && s.display_id === String(display.id)) ?? sources[0]
  const img = match.thumbnail
  return img.isEmpty() ? null : img
}

/** Crop a NativeImage to a fractional rect, returning a fresh image. */
export function cropImage(img: NativeImage, crop: CropRect): NativeImage {
  const size = img.getSize()
  const rect = {
    x: Math.max(0, Math.round(crop.x * size.width)),
    y: Math.max(0, Math.round(crop.y * size.height)),
    width: Math.min(size.width, Math.round(crop.w * size.width)),
    height: Math.min(size.height, Math.round(crop.h * size.height))
  }
  // If the rect is too small, fall back to the whole frame.
  if (rect.width < 4 || rect.height < 4) return img
  if (rect.x + rect.width > size.width) rect.width = size.width - rect.x
  if (rect.y + rect.height > size.height) rect.height = size.height - rect.y
  return img.crop(rect)
}

/** Downscale a data-URL-able preview so calibration screenshots stay light. */
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

/**
 * Upscale before recognition. Tesseract estimates the contract panel at ~150 DPI
 * and wants ~300, so doubling with a high-quality filter lifts the read on the
 * thin in-game text. Color is left alone: Tesseract grayscales and binarizes
 * internally, so pre-graying or inverting changes nothing.
 */
export function toUpscaledPng(img: NativeImage, factor = 2): Buffer {
  const { width, height } = img.getSize()
  if (factor <= 1 || width < 4 || height < 4) return img.toPNG()
  return img
    .resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' })
    .toPNG()
}

/**
 * Grayscale PNG of an image. This roughly halves the size of stored/uploaded
 * training crops, and the OCR pipeline works on grayscale anyway so nothing is
 * lost. Uses nativeImage's BGRA bitmap so we need no extra image dependency at
 * runtime.
 */
export function toGrayscalePng(img: NativeImage): Buffer {
  const { width, height } = img.getSize()
  const bmp = img.toBitmap() // BGRA
  for (let i = 0; i < bmp.length; i += 4) {
    const lum = Math.round(0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2])
    bmp[i] = bmp[i + 1] = bmp[i + 2] = lum
  }
  return nativeImage.createFromBitmap(bmp, { width, height }).toPNG()
}
