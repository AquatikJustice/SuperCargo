// OCR entry point. main/index.ts talks only to this module.
//
// Holds the one active engine and runs the full pass:
//   capture display -> crop panel -> recognize -> parse -> fuzzy-match to UEX ->
//   keep crop for opt-in training. The engine is chosen in settings.

import type { AppSettings, OcrEngineInfo, OcrResult } from '@shared/types'
import { parseOcrText, matchObjectives } from '@shared/ocrParse'
import { captureDisplay, cropImage, toUpscaledPng, toGrayscalePng, toPreviewDataUrl } from '../capture'
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

/** Capture a full-display preview for the calibration UI. */
export async function capturePreview(settings: AppSettings): Promise<string | null> {
  const img = await captureDisplay(settings.ocrDisplayId)
  return img ? toPreviewDataUrl(img) : null
}

/** Run a full OCR pass and return parsed, UEX-matched objectives. */
export async function runOcr(settings: AppSettings): Promise<OcrResult> {
  const engine = engineFor(settings.ocrEngine || 'tesseract')
  const base: OcrResult = { ok: false, engine: engine.id, ms: 0, confidence: 0, rawText: '', objectives: [] }

  const full = await captureDisplay(settings.ocrDisplayId)
  if (!full) return { ...base, error: 'screen capture failed (no source available)' }

  const cropped = cropImage(full, settings.ocrCrop)
  // Recognition runs on a 2x upscale: the panel comes in around 150 DPI and
  // Tesseract reads it better near 300.
  const ocrImage = toUpscaledPng(cropped, 2)
  // Keep the preview near native size (up to 1280px). It is shown large in the
  // contribute view where the user must read the panel to correct it.
  const imageDataUrl = toPreviewDataUrl(cropped, 1280)
  // Store a grayscale crop at native size for samples/upload (about half the size).
  const grayPng = toGrayscalePng(cropped)

  const started = Date.now()
  let recognition
  try {
    recognition = await engine.recognize(ocrImage)
  } catch (e) {
    return { ...base, imageDataUrl, error: e instanceof Error ? e.message : String(e) }
  }
  const ms = Date.now() - started

  const parsed = parseOcrText(recognition.text)
  const commodities = loadCachedCommodities()?.commodities ?? []
  const locations = loadCachedLocations()?.locations ?? []
  const objectives = matchObjectives(parsed.objectives, commodities, locations)

  // Keep the crop so a confirmed read can become a training sample later.
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
    sampleId
  }
}

/** Promote a confirmed read into the training corpus (opt-in). */
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
  // Read the crop before commit (commit renames pending -> data).
  const png = settings.contributeTrainingData ? readPending(sampleId) : null

  let kept = false
  if (settings.ocrSaveSamples) kept = commitSample(sampleId, full)

  // Opt-in anonymous upload to the shared training bucket.
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
