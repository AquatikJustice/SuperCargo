// Opt-in training-data contribution: upload confirmed, grayscale contract-panel
// crops to a shared Supabase Storage bucket so the org's OCR model improves from
// everyone's use. Privacy-first: opt-in (default OFF), anonymous client id, only
// the tight panel crop + the user's confirmed text, nothing else.
//
// The bucket is PRIVATE with an INSERT-ONLY policy, so this publishable key can
// upload but cannot read, list, or delete anything (verified). Uploads are queued
// to disk and retried, so an offline machine or a paused project just means
// samples upload later, none are lost.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

// Publishable (anon) key, safe to embed by design. The insert-only storage
// policy is what protects the bucket. Rotate in the dashboard if ever abused.
const SUPABASE_URL = 'https://rjljbmbuegqerhxyaypq.supabase.co'
const SUPABASE_KEY = 'sb_publishable_wb_4KDrnvRc39ZaUfsUFxw_3Cvy1cxC'
const BUCKET = 'ocr-samples'
const RETRY_MS = 5 * 60 * 1000

interface QueueItem {
  id: string
  clientId: string
}
interface QueueFile {
  items: QueueItem[]
  uploaded: number
}

function outboxDir(): string {
  return path.join(app.getPath('userData'), 'outbox')
}
function queuePath(): string {
  return path.join(app.getPath('userData'), 'upload-queue.json')
}

let queue: QueueFile = { items: [], uploaded: 0 }
let processing = false
let timer: NodeJS.Timeout | null = null

function loadQueue(): void {
  try {
    queue = { items: [], uploaded: 0, ...JSON.parse(fs.readFileSync(queuePath(), 'utf8')) }
  } catch {
    queue = { items: [], uploaded: 0 }
  }
}
function saveQueue(): void {
  try {
    fs.writeFileSync(queuePath(), JSON.stringify(queue), 'utf8')
  } catch (e) {
    console.error('[telemetry] failed to persist queue:', e)
  }
}

async function putObject(objectPath: string, body: Buffer, contentType: string): Promise<boolean> {
  // Plain create (NO x-upsert): upsert would need a SELECT policy that the
  // write-only bucket deliberately lacks. Unique ids mean we never need it.
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType
    },
    body: new Uint8Array(body)
  })
  // 200 = stored; 409 = already exists (from an earlier partial run), treat as done.
  return res.status === 200 || res.status === 409
}

async function processQueue(): Promise<void> {
  if (processing || queue.items.length === 0) return
  processing = true
  try {
    const remaining: QueueItem[] = []
    for (const item of queue.items) {
      const png = path.join(outboxDir(), `${item.id}.png`)
      const json = path.join(outboxDir(), `${item.id}.json`)
      if (!fs.existsSync(png) || !fs.existsSync(json)) continue // dropped; skip
      try {
        const okPng = await putObject(`${item.clientId}/${item.id}.png`, fs.readFileSync(png), 'image/png')
        const okJson = await putObject(`${item.clientId}/${item.id}.json`, fs.readFileSync(json), 'application/json')
        if (okPng && okJson) {
          fs.unlinkSync(png)
          fs.unlinkSync(json)
          queue.uploaded++
        } else {
          remaining.push(item) // server-side failure, retry later
        }
      } catch {
        remaining.push(item) // network failure, retry later
      }
    }
    queue.items = remaining
    saveQueue()
  } finally {
    processing = false
  }
}

/** Queue a confirmed sample for upload (PNG already grayscale). */
export function enqueue(clientId: string, id: string, png: Buffer, label: object): void {
  try {
    fs.mkdirSync(outboxDir(), { recursive: true })
    fs.writeFileSync(path.join(outboxDir(), `${id}.png`), png)
    fs.writeFileSync(path.join(outboxDir(), `${id}.json`), JSON.stringify(label), 'utf8')
    queue.items.push({ id, clientId })
    saveQueue()
  } catch (e) {
    console.error('[telemetry] failed to enqueue sample:', e)
    return
  }
  void processQueue()
}

/** Load the queue and start the retry timer + an initial flush. */
export function init(): void {
  loadQueue()
  if (!timer) timer = setInterval(() => void processQueue(), RETRY_MS)
  void processQueue()
}

export function status(): { uploaded: number; queued: number } {
  return { uploaded: queue.uploaded, queued: queue.items.length }
}
