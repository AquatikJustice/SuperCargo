// anonymous launch snapshot: unique-user count + which features get used.
// insert-only table, the publishable key can't read it back.
import type { AppSettings, HistoryEntry } from '@shared/types'
import { SUPABASE_URL, SUPABASE_KEY } from './telemetry'

const TABLE = 'usage_pings'
const MIN_GAP_MS = 20 * 60 * 60 * 1000 // roughly once a day per user

export function completedShips(entries: HistoryEntry[]): string[] {
  const ships = new Set<string>()
  for (const e of entries) {
    if (e.status === 'completed' && e.replay?.ship) ships.add(e.replay.ship)
  }
  return [...ships]
}

function snapshot(settings: AppSettings, appVersion: string, ships: string[]): Record<string, unknown> {
  return {
    client_id: settings.telemetryClientId,
    app_version: appVersion,
    platform: process.platform,
    arch: process.arch,
    ocr_engine: settings.ocrEngine || 'tesseract',
    ships,
    ocr_fields_total: settings.ocrFieldsTotal ?? 0,
    ocr_fields_edited: settings.ocrFieldsEdited ?? 0,
    ocr_edits: settings.ocrEdits ?? {},
    space_delivery_piles: settings.spaceDeliveryPiles,
    contribute_training: settings.contributeTrainingData,
    auto_capture: settings.ocrAutoCapture
  }
}

// returns the sent-at ISO on success (for the throttle stamp), else null
export async function maybePing(
  settings: AppSettings,
  appVersion: string,
  ships: string[]
): Promise<string | null> {
  if (!settings.shareUsageStats || !settings.telemetryClientId) return null
  const last = settings.lastUsagePingAt ? Date.parse(settings.lastUsagePingAt) : 0
  if (Date.now() - last < MIN_GAP_MS) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(snapshot(settings, appVersion, ships))
    })
    if (res.ok) return new Date().toISOString()
    console.error('[usageStats] ping rejected:', res.status)
  } catch (e) {
    console.error('[usageStats] ping failed:', e)
  }
  return null
}
