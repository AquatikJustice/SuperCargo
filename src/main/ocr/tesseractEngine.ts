// lazy load so a broken install degrades instead of crashing boot

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import type { OcrWord } from '@shared/types'
import type { OcrEngine, OcrRecognition } from './engine'

// keep types local so the dep stays optional
type TessWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
type TessBlock = { paragraphs: { lines: { words: TessWord[] }[] }[] }
type TessData = { text: string; confidence: number; blocks?: TessBlock[] | null }
type TessWorker = {
  recognize: (
    img: Buffer,
    opts?: Record<string, unknown>,
    output?: Record<string, unknown>
  ) => Promise<{ data: TessData }>
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

  private cachedData(): string {
    return path.join(this.tessdataDir(), 'eng.traineddata')
  }

  private bundledData(): string | undefined {
    return [
      path.join(process.resourcesPath, 'tessdata', 'eng.traineddata.gz'),
      path.join(app.getAppPath(), 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz')
    ].find((p) => fs.existsSync(p))
  }

  // Electron makes tesseract.js fetch langPath; the cache reads off disk
  private seedCache(): void {
    fs.mkdirSync(this.tessdataDir(), { recursive: true })
    const bundled = this.bundledData()
    if (bundled && !fs.existsSync(this.cachedData())) fs.copyFileSync(bundled, this.cachedData())
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
      return fs.existsSync(this.cachedData()) || !!this.bundledData()
    } catch {
      return false
    }
  }

  private async ensureWorker(): Promise<TessWorker | null> {
    if (this.worker) return this.worker
    if (this.loading) return this.loading

    this.loading = (async () => {
      try {
        this.seedCache()
        const tesseract = (await import('tesseract.js')) as unknown as TessModule
        const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker
        if (!createWorker) throw new Error('tesseract.js missing createWorker')
        // createWorker never settles on a bad language load
        let fail: (e: unknown) => void = () => {}
        const failed = new Promise<never>((_, reject) => (fail = reject))
        const worker: TessWorker = await Promise.race([
          createWorker('eng', 1, {
            cachePath: this.tessdataDir(),
            gzip: true,
            // else it rethrows outside our try
            errorHandler: (e: unknown) => {
              console.error('[ocr] tesseract worker error:', e)
              fail(e)
            }
          }),
          failed
        ])
        // psm 3 stops column text bleeding (the everus bug)
        await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' })
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
    const { data } = await worker.recognize(png, {}, { blocks: true })
    const words: OcrWord[] = []
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const line of para.lines ?? [])
          for (const w of line.words ?? [])
            if (w.text.trim())
              words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })
    return { text: data.text ?? '', confidence: data.confidence ?? 0, words }
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
