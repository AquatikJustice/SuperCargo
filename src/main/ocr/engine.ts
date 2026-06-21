// Swappable OCR engine interface.
//
// Tesseract is the engine today; a custom CRNN->ONNX model (run via
// onnxruntime-node) is meant to drop in later behind this same interface. The
// rest of the pipeline (capture -> parse -> match) never imports a concrete
// engine, only this contract.

export interface OcrRecognition {
  /** Recognized text, with line breaks preserved. */
  text: string
  /** Mean confidence, 0..100. */
  confidence: number
}

export interface OcrEngine {
  readonly id: string
  readonly label: string
  /** True once the engine's runtime (wasm/native module) has loaded. */
  isAvailable(): Promise<boolean>
  /** True when recognition assets (e.g. language data) are present locally. */
  assetsReady(): Promise<boolean>
  /** Recognize text from a PNG image buffer. */
  recognize(png: Buffer): Promise<OcrRecognition>
  /** Release any held resources (workers, native handles). */
  dispose(): Promise<void>
}
