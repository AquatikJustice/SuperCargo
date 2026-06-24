import { parseContractTitle, isHaulingGenerator, cleanTitle, hasBlueprintMarker } from '@shared/contract'
import type {
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  CompletionType
} from '@shared/types'

const PATTERN_TIMESTAMP = /^<([0-9T:\-.Z]+)>/
const PATTERN_MARKER =
  /CreateMarker.*missionId \[([^\]]+)\].*generator name \[([^\]]+)\].*contract \[([^\]]+)\]/
const PATTERN_MARKER_DEF_ID = /contractDefinitionId\[([^\]]+)\]/
const PATTERN_ACCEPTED =
  /Added notification "Contract Accepted:\s*(.*?)"\s*\[[^\]]*\].*?MissionId: \[([^\]]+)\]/
const PATTERN_OBJECTIVE =
  /Added notification "New Objective: Deliver\s+\d+\/(\d+)\s+SCU of\s+(.+?)\s+to\s+(.+?)[:."].*?MissionId: \[([^\]]+)\]/
const PATTERN_END_MISSION =
  /<EndMission>.*MissionId\[([^\]]+)\].*CompletionType\[(\w+)\](?:.*?Reason\[([^\]]+)\])?/

export type ParsedLine =
  | { kind: 'marker'; missionId: string; generator: string; contractName: string; defId?: string }
  | { kind: 'accepted'; event: ContractAcceptedEvent; isHauling: boolean }
  | { kind: 'objective'; event: ObjectiveEvent }
  | { kind: 'ended'; event: ContractEndedEvent }
  | null

export function parseTimestamp(line: string): string | null {
  const match = PATTERN_TIMESTAMP.exec(line)
  return match ? match[1] : null
}

// kept to backfill generator/title later
export interface MarkerEntry {
  generator: string
  contractName: string
  defId?: string
}

// mutates the markers map
export function parseLine(line: string, markers: Map<string, MarkerEntry>): ParsedLine {
  let match: RegExpExecArray | null

  if ((match = PATTERN_MARKER.exec(line))) {
    const [, missionId, generator, contractName] = match
    const defMatch = PATTERN_MARKER_DEF_ID.exec(line)
    const defId = defMatch ? defMatch[1] : undefined
    if (!markers.has(missionId)) {
      markers.set(missionId, { generator, contractName, defId })
    }
    return { kind: 'marker', missionId, generator, contractName, defId }
  }

  if ((match = PATTERN_ACCEPTED.exec(line))) {
    const [, rawTitle, missionId] = match
    const marker = markers.get(missionId)
    const generator = marker?.generator ?? ''
    const { rank, haulType, pickup } = parseContractTitle(rawTitle)
    const ts = parseTimestamp(line) ?? new Date().toISOString()
    const event: ContractAcceptedEvent = {
      missionId,
      title: cleanTitle(rawTitle),
      generator,
      contractName: marker?.contractName ?? '',
      rank,
      haulType,
      pickup,
      acceptedAt: ts,
      blueprint: hasBlueprintMarker(rawTitle)
    }
    // no marker yet, use title
    const isHauling = generator ? isHaulingGenerator(generator) : /haul/i.test(rawTitle)
    return { kind: 'accepted', event, isHauling }
  }

  if ((match = PATTERN_OBJECTIVE.exec(line))) {
    const [, scu, commodity, destination, missionId] = match
    return {
      kind: 'objective',
      event: {
        missionId,
        scuAmount: parseInt(scu, 10),
        commodity: commodity.trim(),
        destination: destination.trim()
      }
    }
  }

  if ((match = PATTERN_END_MISSION.exec(line))) {
    const [, missionId, completion, reason] = match
    return { kind: 'ended', event: { missionId, completion: completion as CompletionType, reason } }
  }

  return null
}
