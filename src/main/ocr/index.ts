import type { AppSettings, OcrEngineInfo, OcrResult } from '@shared/types'
import { parseOcrText, matchObjectives, reorderColumns } from '@shared/ocrParse'
import { captureGameWindow, captureDisplay, cropImage, toUpscaledPng, toGrayscalePng, toPreviewDataUrl } from '../capture'
import type { NativeImage } from 'electron'
import { loadCachedCommodities, loadCachedLocations } from '../uex'
import * as telemetry from '../telemetry'
import type { OcrEngine } from './engine'
import { TesseractEngine } from './tesseractEngine'
import { OnnxEngine } from './onnxEngine'
import { stashPending, commitSample, readPending, sampleCount, type SampleLabel } from './samples'

let activeEngine: OcrEngine | null = null

function engineFor(id: string): OcrEngine {
  if (activeEngine && activeEngine.id === id) return activeEngine
  if (activeEngine) void activeEngine.dispose()
  activeEngine = id === 'onnx' ? new OnnxEngine() : new TesseractEngine()
  return activeEngine
}

export async function engineInfo(settings: AppSettings): Promise<OcrEngineInfo> {
  const engine = engineFor(settings.ocrEngine || 'tesseract')
  const [available, assetsReady] = await Promise.all([
    engine.isAvailable(),
    engine.assetsReady()
  ])
  return {
    id: engine.id,
    label: engine.label,
    available,
    assetsReady,
    detail: available
      ? assetsReady
        ? `${sampleCount()} training samples collected`
        : 'Language data downloads on first capture'
      : 'Engine failed to load'
  }
}

export async function capturePreview(settings: AppSettings): Promise<string | null> {
  let img = settings.ocrCaptureTarget === 'display' ? null : await captureGameWindow()
  if (!img) img = await captureDisplay(settings.ocrDisplayId)
  return img ? toPreviewDataUrl(img) : null
}

// aroundCapture lets the caller hide its own windows for just the screenshot, not the whole OCR
export async function runOcr(
  settings: AppSettings,
  aroundCapture: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()
): Promise<OcrResult> {
  const engine = engineFor(settings.ocrEngine || 'tesseract')
  const base: OcrResult = { ok: false, engine: engine.id, ms: 0, confidence: 0, rawText: '', objectives: [] }

  // window capture excludes overlapping windows so it needs no hiding; falls back to display capture otherwise
  let full: NativeImage | null =
    settings.ocrCaptureTarget === 'display' ? null : await captureGameWindow()
  if (!full) full = await aroundCapture(() => captureDisplay(settings.ocrDisplayId))
  if (!full) return { ...base, error: 'screen capture failed (no source available)' }

  const fullSize = full.getSize()
  const captureRes = `${fullSize.width}x${fullSize.height}`
  const cropped = cropImage(full, settings.ocrCrop)
  // 2x at 1080p, less above
  const factor = Math.min(2, Math.max(1, 2160 / cropped.getSize().height))
  const ocrImage = toUpscaledPng(cropped, factor)
  const imageDataUrl = toPreviewDataUrl(cropped, 1280)
  const grayPng = toGrayscalePng(cropped)

  const started = Date.now()
  let recognition
  try {
    recognition = await engine.recognize(ocrImage)
  } catch (e) {
    return { ...base, imageDataUrl, captureRes, error: e instanceof Error ? e.message : String(e) }
  }
  const ms = Date.now() - started

  const parsed = parseOcrText(recognition.text)
  const commodities = loadCachedCommodities()?.commodities ?? []
  const locations = loadCachedLocations()?.locations ?? []
  let objectives = matchObjectives(parsed.objectives, commodities, locations)

  // keep reordered parse if better
  if (recognition.words?.length) {
    const reordered = reorderColumns(recognition.words)
    if (reordered) {
      const alt = matchObjectives(parseOcrText(reordered).objectives, commodities, locations)
      const resolved = (os: typeof objectives): number =>
        os.filter((o) => o.commodity.match && o.destination.match).length
      if (resolved(alt) > resolved(objectives)) objectives = alt
    }
  }

  const sampleId = stashPending(grayPng)

  return {
    ok: true,
    engine: engine.id,
    ms,
    confidence: recognition.confidence,
    rawText: recognition.text,
    imageDataUrl,
    maxBoxSize: parsed.maxBoxSize,
    reward: parsed.reward,
    objectives,
    sampleId,
    captureRes
  }
}

export function saveSample(
  settings: AppSettings,
  sampleId: string,
  label: Omit<SampleLabel, 'engine' | 'savedAt'>
): boolean {
  const full: SampleLabel = {
    ...label,
    engine: settings.ocrEngine || 'tesseract',
    savedAt: new Date().toISOString()
  }
  // read before commit renames it
  const png = settings.contributeTrainingData ? readPending(sampleId) : null

  let kept = false
  if (settings.contributeTrainingData) kept = commitSample(sampleId, full)

  if (settings.contributeTrainingData && png && settings.telemetryClientId) {
    telemetry.enqueue(settings.telemetryClientId, sampleId, png, {
      ...full,
      sampleId,
      clientId: settings.telemetryClientId
    })
  }
  return kept
}

export { sampleCount }
