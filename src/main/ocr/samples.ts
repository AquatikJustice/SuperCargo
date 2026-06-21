// Training-sample storage for the future custom OCR model.
//
// Each capture saves its cropped PNG under .../ocr-samples/pending/<id>.png.
// When the user confirms or corrects the read (and has opted in), we move the
// crop into .../ocr-samples/data/ next to a JSON label. That confirmed
// (image, text) corpus is what trains the eventual CRNN, built for free from
// normal use. Nothing is kept unless the user opts in.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

function root(): string {
  return path.join(app.getPath('userData'), 'ocr-samples')
}
function pendingDir(): string {
  return path.join(root(), 'pending')
}
function dataDir(): string {
  return path.join(root(), 'data')
}

let counter = 0
/** Make a sortable id that won't collide, without calling Date.now in a hot path. */
function newId(): string {
  counter = (counter + 1) % 100000
  return `${Date.now().toString(36)}-${counter.toString(36)}`
}

/** Read a pending crop's PNG bytes by id (for upload), or null if gone. */
export function readPending(id: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(pendingDir(), `${id}.png`))
  } catch {
    return null
  }
}

/** Stash a crop awaiting confirmation. Returns the sample id. */
export function stashPending(png: Buffer): string {
  const id = newId()
  try {
    fs.mkdirSync(pendingDir(), { recursive: true })
    fs.writeFileSync(path.join(pendingDir(), `${id}.png`), png)
  } catch (e) {
    console.error('[ocr] failed to stash pending sample:', e)
  }
  return id
}

export interface SampleLabel {
  /** The user-confirmed transcription of the crop. */
  text: string
  /** Structured fields, for stratified training later. */
  fields?: Record<string, unknown>
  engine: string
  savedAt: string
}

/** Promote a pending crop into the labelled training set. */
export function commitSample(id: string, label: SampleLabel): boolean {
  const src = path.join(pendingDir(), `${id}.png`)
  if (!fs.existsSync(src)) return false
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    const dst = path.join(dataDir(), `${id}.png`)
    fs.renameSync(src, dst)
    fs.writeFileSync(path.join(dataDir(), `${id}.json`), JSON.stringify(label, null, 2), 'utf8')
    return true
  } catch (e) {
    console.error('[ocr] failed to commit sample:', e)
    return false
  }
}

/** Best-effort cleanup of pending crops older than the given age (ms). */
export function prunePending(maxAgeMs = 60 * 60 * 1000): void {
  try {
    const dir = pendingDir()
    if (!fs.existsSync(dir)) return
    const now = Date.now()
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      try {
        if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Count of committed training samples (shown in Settings). */
export function sampleCount(): number {
  try {
    return fs.readdirSync(dataDir()).filter((f) => f.endsWith('.png')).length
  } catch {
    return 0
  }
}
