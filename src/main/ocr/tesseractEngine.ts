// Tesseract recognizer (tesseract.js), the default OCR engine.
//
// tesseract.js is loaded lazily so a missing or broken install reports an
// "engine unavailable" status instead of crashing the app at boot. The worker
// stays warm between captures. Language data (eng.traineddata) is cached under
// userData/tessdata; the first run downloads it if missing (a later milestone
// bundles it for fully-offline use, see docs/PROGRESS.md).

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import type { OcrEngine, OcrRecognition } from './engine'

// Don't import tesseract.js types statically so the dependency stays optional.
type TessWorker = {
  recognize: (img: Buffer) => Promise<{ data: { text: string; confidence: number } }>
  setParameters: (p: Record<string, unknown>) => Promise<unknown>
  terminate: () => Promise<unknown>
}
type CreateWorker = (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker>
type TessModule = { createWorker?: CreateWorker; default?: { createWorker?: CreateWorker } }

export class TesseractEngine implements OcrEngine {
  readonly id = 'tesseract'
  readonly label = 'Tesseract (tesseract.js)'

  private worker: TessWorker | null = null
  private loading: Promise<TessWorker | null> | null = null
  private loadFailed = false

  private tessdataDir(): string {
    return path.join(app.getPath('userData'), 'tessdata')
  }

  async isAvailable(): Promise<boolean> {
    if (this.loadFailed) return false
    try {
      await this.ensureWorker()
      return this.worker !== null
    } catch {
      return false
    }
  }

  async assetsReady(): Promise<boolean> {
    try {
      return fs.existsSync(path.join(this.tessdataDir(), 'eng.traineddata'))
    } catch {
      return false
    }
  }

  private async ensureWorker(): Promise<TessWorker | null> {
    if (this.worker) return this.worker
    if (this.loading) return this.loading

    this.loading = (async () => {
      try {
        const cachePath = this.tessdataDir()
        fs.mkdirSync(cachePath, { recursive: true })
        // Optional dependency, loaded lazily so it stays out of the static graph.
        const tesseract = (await import('tesseract.js')) as unknown as TessModule
        const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker
        if (!createWorker) throw new Error('tesseract.js missing createWorker')
        const worker: TessWorker = await createWorker('eng', 1, {
          cachePath,
          gzip: true
        })
        // The contract screen is white text on a dark UI, so favor accuracy.
        await worker.setParameters({ preserve_interword_spaces: '1' })
        this.worker = worker
        return worker
      } catch (e) {
        this.loadFailed = true
        console.error('[ocr] tesseract.js failed to load:', e)
        return null
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  async recognize(png: Buffer): Promise<OcrRecognition> {
    const worker = await this.ensureWorker()
    if (!worker) throw new Error('tesseract engine is unavailable')
    const { data } = await worker.recognize(png)
    return { text: data.text ?? '', confidence: data.confidence ?? 0 }
  }

  async dispose(): Promise<void> {
    const w = this.worker
    this.worker = null
    if (w) {
      try {
        await w.terminate()
      } catch {
        /* ignore */
      }
    }
  }
}
