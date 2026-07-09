// recover active hauls (and their sharing state) mid-session

import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import type { ScannedContract, ScanShare, SessionScan } from '@shared/types'

export function scanSessionLog(logPath: string): SessionScan {
  let content: string
  try {
    content = fs.readFileSync(logPath, 'utf8')
  } catch {
    return { contracts: [], shares: [] }
  }

  const markers = new Map<string, MarkerEntry>()
  const active = new Map<string, ScannedContract>()
  const joined = new Map<string, Set<string>>() // missionId -> player ids still on it
  const sharedToMe = new Set<string>()

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
      case 'share': {
        const e = parsed.event
        if (e.kind === 'shared') {
          sharedToMe.add(e.missionId)
        } else {
          const on = joined.get(e.missionId) ?? new Set<string>()
          if (e.kind === 'joined') on.add(e.actorId)
          else on.delete(e.actorId)
          joined.set(e.missionId, on)
        }
        break
      }
    }
  }

  const ids = new Set<string>([...sharedToMe, ...joined.keys()])
  const shares: ScanShare[] = [...ids].map((missionId) => ({
    missionId,
    sharedWithMe: sharedToMe.has(missionId),
    sharedWith: [...(joined.get(missionId) ?? [])]
  }))

  return { contracts: [...active.values()], shares }
}
