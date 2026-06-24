// recover active hauls mid-session

import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import type { ScannedContract } from '@shared/types'

export function scanActiveContracts(logPath: string): ScannedContract[] {
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch {
    return []
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()

  for (const line of content.split(/\r?\n/)) {
    if (!line) continue
    const parsed = parseLine(line, markers)
    if (!parsed) continue
    switch (parsed.kind) {
      case 'accepted':
        if (parsed.isHauling) {
          active.set(parsed.event.missionId, { accepted: parsed.event, objectives: [] })
        }
        break
      case 'objective': {
        const contract = active.get(parsed.event.missionId)
        if (contract) contract.objectives.push(parsed.event)
        break
      }
      case 'ended':
        active.delete(parsed.event.missionId)
        break
    }
  }

  return [...active.values()]
}
