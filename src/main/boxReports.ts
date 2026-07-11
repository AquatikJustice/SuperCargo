// opt-in report when a contract with hand-corrected box sizes ends; feeds the contract-overrides list.
// insert-only table, the publishable key can't read it back.
import type { AppSettings, BoxSizeReport } from '@shared/types'
import { SUPABASE_URL, SUPABASE_KEY } from './telemetry'

const TABLE = 'box_size_reports'

// archive can re-fire on lifecycle quirks; one report per mission per session
const sent = new Set<string>()

export function report(settings: AppSettings, appVersion: string, r: BoxSizeReport): void {
  if (!settings.shareUsageStats || !settings.telemetryClientId) return
  if (!r || !r.missionId || !r.title || sent.has(r.missionId)) return
  sent.add(r.missionId)
  void (async () => {
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
          client_id: settings.telemetryClientId,
          app_version: appVersion,
          mission_id: r.missionId,
          title: r.title,
          generator: r.generator ?? null,
          contract_name: r.contractName ?? null,
          data_source: r.dataSource,
          status: r.status,
          max_box_size: r.maxBoxSize,
          report: r
        })
      })
      if (!res.ok) console.error('[boxReports] rejected:', res.status)
    } catch (e) {
      console.error('[boxReports] send failed:', e)
    }
  })()
}
