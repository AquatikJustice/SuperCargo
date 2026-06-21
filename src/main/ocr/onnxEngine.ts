// Custom CRNN+CTC recognizer that runs the exported ONNX model via onnxruntime-node.
//
// Drop-in alternative to TesseractEngine: train in scripts/train/, export
// model.onnx + charset.json, put them in userData/ocr-model/, and pick engine
// "onnx". Preprocessing must match scripts/train/dataset.py:
//   grayscale, height 32, normalize (x/255 - 0.5)/0.5, input [1,1,32,W],
//   output [1,T,C], CTC blank = index 0, charset.json = { chars: ["<blank>", ...] }.
//
// onnxruntime-node is imported lazily so a missing or broken runtime reports
// "unavailable" instead of crashing the app at startup.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app, nativeImage } from 'electron'
import type { OcrEngine, OcrRecognition } from './engine'

const IMG_H = 32

// onnxruntime-node ships no types here (optional dep), so describe the part we use.
interface OrtTensor {
  data: Float32Array
  dims: number[]
}
interface OrtSession {
  inputNames?: string[]
  outputNames?: string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>
  release?(): Promise<void>
}
interface OrtModule {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
  InferenceSession?: { create(p: string): Promise<OrtSession> }
  default?: { InferenceSession?: { create(p: string): Promise<OrtSession> } }
}
const loadOrt = async (): Promise<OrtModule> => (await import('onnxruntime-node')) as unknown as OrtModule

export class OnnxEngine implements OcrEngine {
  readonly id = 'onnx'
  readonly label = 'Custom (ONNX CRNN)'

  private session: OrtSession | null = null
  private chars: string[] | null = null
  private loading: Promise<boolean> | null = null
  private loadFailed = false

  private modelDir(): string {
    return path.join(app.getPath('userData'), 'ocr-model')
  }
  private modelPath(): string {
    return path.join(this.modelDir(), 'model.onnx')
  }
  private charsetPath(): string {
    return path.join(this.modelDir(), 'charset.json')
  }

  async isAvailable(): Promise<boolean> {
    if (this.loadFailed) return false
    try {
      await import('onnxruntime-node')
      return true
    } catch {
      return false
    }
  }

  async assetsReady(): Promise<boolean> {
    return fs.existsSync(this.modelPath()) && fs.existsSync(this.charsetPath())
  }

  private async load(): Promise<boolean> {
    if (this.session && this.chars) return true
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        if (!fs.existsSync(this.modelPath()) || !fs.existsSync(this.charsetPath())) {
          throw new Error('model.onnx / charset.json not found in ocr-model/')
        }
        const ort = await loadOrt()
        const create = ort.InferenceSession?.create ?? ort.default?.InferenceSession?.create
        if (!create) throw new Error('onnxruntime-node missing InferenceSession.create')
        this.session = await create(this.modelPath())
        this.chars = JSON.parse(fs.readFileSync(this.charsetPath(), 'utf8')).chars
        return true
      } catch (e) {
        this.loadFailed = true
        console.error('[ocr] failed to load ONNX engine:', e)
        return false
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /** PNG buffer -> Float32 [1,1,32,W] normalized to [-1,1]; returns {data,width}. */
  private preprocess(png: Buffer): { data: Float32Array; width: number } {
    const resized = nativeImage.createFromBuffer(png).resize({ height: IMG_H })
    const { width } = resized.getSize()
    const bmp = resized.toBitmap() // BGRA pixels, length width*32*4
    const w = Math.max(1, width)
    const data = new Float32Array(IMG_H * w)
    for (let y = 0; y < IMG_H; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2]
        const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        data[y * w + x] = (gray - 0.5) / 0.5
      }
    }
    return { data, width: w }
  }

  private decode(logits: Float32Array, T: number, C: number): { text: string; confidence: number } {
    const chars = this.chars as string[]
    let out = ''
    let prev = -1
    let confSum = 0
    let confN = 0
    for (let t = 0; t < T; t++) {
      // pick the top class (argmax) and its softmax probability over the C classes at this step
      let best = 0, bestV = -Infinity, sumExp = 0, max = -Infinity
      for (let c = 0; c < C; c++) {
        const v = logits[t * C + c]
        if (v > max) max = v
      }
      for (let c = 0; c < C; c++) {
        const e = Math.exp(logits[t * C + c] - max)
        sumExp += e
        if (logits[t * C + c] > bestV) { bestV = logits[t * C + c]; best = c }
      }
      if (best !== prev && best !== 0) {
        out += chars[best] ?? ''
        confSum += Math.exp(bestV - max) / sumExp
        confN++
      }
      prev = best
    }
    return { text: out, confidence: confN ? (confSum / confN) * 100 : 0 }
  }

  async recognize(png: Buffer): Promise<OcrRecognition> {
    if (!(await this.load())) throw new Error('ONNX engine is unavailable')
    const session = this.session
    if (!session) throw new Error('ONNX engine is unavailable')
    const ort = await loadOrt()
    const { data, width } = this.preprocess(png)
    const input = new ort.Tensor('float32', data, [1, 1, IMG_H, width])
    const inName = session.inputNames?.[0] ?? 'input'
    const outName = session.outputNames?.[0] ?? 'logits'
    const result = await session.run({ [inName]: input })
    const logits = result[outName]
    const [, T, C] = logits.dims
    return this.decode(logits.data, T, C)
  }

  async dispose(): Promise<void> {
    try {
      await this.session?.release?.()
    } catch {
      /* ignore */
    }
    this.session = null
    this.chars = null
  }
}
