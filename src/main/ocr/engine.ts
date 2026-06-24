// swappable engine, custom model later

import type { OcrWord } from '@shared/types'

export interface OcrRecognition {
  text: string
  /** 0..100 */
  confidence: number
  /** word boxes for column reconstruction, when the engine has them */
  words?: OcrWord[]
}

export interface OcrEngine {
  readonly id: string
  readonly label: string
  isAvailable(): Promise<boolean>
  assetsReady(): Promise<boolean>
  recognize(png: Buffer): Promise<OcrRecognition>
  dispose(): Promise<void>
}
