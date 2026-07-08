import { parseContractTitle, isHaulingGenerator, cleanTitle, hasBlueprintMarker } from '@shared/contract'
import type {
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  CompletionType,
  ShareEvent
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
// the completion notice carries the real id; the Awarded line right after it has an all-zero id
const PATTERN_COMPLETE =
  /Added notification "Contract Complete:\s*.*?"\s*\[[^\]]*\].*?MissionId: \[([^\]]+)\]/
const PATTERN_AWARD = /Added notification "Awarded\s+([\d,]+)\s+aUEC/
// shared TO you: names the owner by id only. joined/left: someone on a contract you own
const PATTERN_SHARED = /<MissionShared>.*ownerId\[([^\]]+)\].*missionId\[([^\]]+)\]/
const PATTERN_JOINED = /<PlayerJoined>.*mission_id\s+([0-9a-f-]+)\s+-\s+player_id\s+(\d+)/
const PATTERN_LEFT = /<PlayerLeft>.*mission_id\s+([0-9a-f-]+)\s+-\s+player_id\s+(\d+)/

export type ParsedLine =
  | { kind: 'marker'; missionId: string; generator: string; contractName: string; defId?: string }
  | { kind: 'accepted'; event: ContractAcceptedEvent; isHauling: boolean }
  | { kind: 'objective'; event: ObjectiveEvent }
  | { kind: 'ended'; event: ContractEndedEvent }
  | { kind: 'completeNotice'; missionId: string }
  | { kind: 'awarded'; amount: number }
  | { kind: 'share'; event: ShareEvent }
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

  if ((match = PATTERN_COMPLETE.exec(line))) {
    return { kind: 'completeNotice', missionId: match[1] }
  }

  if ((match = PATTERN_AWARD.exec(line))) {
    return { kind: 'awarded', amount: parseInt(match[1].replace(/,/g, ''), 10) }
  }

  if ((match = PATTERN_SHARED.exec(line))) {
    return { kind: 'share', event: { missionId: match[2], kind: 'shared', actorId: match[1] } }
  }

  if ((match = PATTERN_JOINED.exec(line))) {
    return { kind: 'share', event: { missionId: match[1], kind: 'joined', actorId: match[2] } }
  }

  if ((match = PATTERN_LEFT.exec(line))) {
    return { kind: 'share', event: { missionId: match[1], kind: 'left', actorId: match[2] } }
  }

  return null
}
