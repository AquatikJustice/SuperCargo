// opt-in report when a user corrects box sizes; feeds the contract-overrides list.
// insert-only table, the publishable key can't read it back.
import type { AppSettings, BoxSizeReport } from '@shared/types'
import { SUPABASE_URL, SUPABASE_KEY } from './telemetry'

const TABLE = 'box_size_reports'
const SETTLE_MS = 30_000

// several edits in a row collapse to the last one per mission
const pending = new Map<string, NodeJS.Timeout>()

async function send(clientId: string, appVersion: string, r: BoxSizeReport): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        client_id: clientId,
        app_version: appVersion,
        mission_id: r.missionId,
        title: r.title,
        generator: r.generator ?? null,
        contract_name: r.contractName ?? null,
        data_source: r.dataSource,
        kind: r.kind,
        max_box_size: r.maxBoxSize,
        report: r
      })
    })
    if (!res.ok) console.error('[boxReports] rejected:', res.status)
  } catch (e) {
    console.error('[boxReports] send failed:', e)
  }
}

export function report(settings: AppSettings, appVersion: string, r: BoxSizeReport): void {
  if (!settings.shareUsageStats || !settings.telemetryClientId) return
  if (!r || !r.missionId || !r.title) return
  const clientId = settings.telemetryClientId
  const old = pending.get(r.missionId)
  if (old) clearTimeout(old)
  const timer = setTimeout(() => {
    pending.delete(r.missionId)
    void send(clientId, appVersion, r)
  }, SETTLE_MS)
  timer.unref?.()
  pending.set(r.missionId, timer)
}
