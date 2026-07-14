import { parseContractTitle, isHaulingGenerator, cleanTitle, hasBlueprintMarker } from '@shared/contract'
import type {
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  CompletionType,
  ShareEvent,
  MarkerDropoff
} from '@shared/types'

const PATTERN_TIMESTAMP = /^<([0-9T:\-.Z]+)>/
const PATTERN_MARKER =
  /CreateMarker.*missionId \[([^\]]+)\].*generator name \[([^\]]+)\].*contract \[([^\]]+)\]/
const PATTERN_MARKER_DEF_ID = /contractDefinitionId\[([^\]]+)\]/
const PATTERN_MARKER_OBJ = /objectiveId \[(dropoff|pickup)_[0-9a-f-]+_(\d+)\]/i
const PATTERN_MARKER_POS = /position \[x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+)\]/
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
// who am I; PlayerLeft carries a geid and only the local one means the contract is gone
const PATTERN_IDENTITY = /<AccountLoginCharacterStatus_Character>.*?\bgeid (\d+)\b.*?\bname (\S+)/
// shared = owner id only; joined/left = players on your contract
const PATTERN_SHARED = /<MissionShared>.*ownerId\[([^\]]+)\].*missionId\[([^\]]+)\]/
const PATTERN_JOINED = /<PlayerJoined>.*mission_id\s+([0-9a-f-]+)\s+-\s+player_id\s+(\d+)/
const PATTERN_LEFT = /<PlayerLeft>.*mission_id\s+([0-9a-f-]+)\s+-\s+player_id\s+(\d+)/

export type ParsedLine =
  | { kind: 'identity'; geid: string; handle: string }
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
  /** one CreateMarker line per objective, so these accumulate across lines */
  dropoffs: MarkerDropoff[]
}

// mutates the markers map
export function parseLine(line: string, markers: Map<string, MarkerEntry>): ParsedLine {
  let match: RegExpExecArray | null

  if ((match = PATTERN_IDENTITY.exec(line))) {
    return { kind: 'identity', geid: match[1], handle: match[2] }
  }

  if ((match = PATTERN_MARKER.exec(line))) {
    const [, missionId, generator, contractName] = match
    const defMatch = PATTERN_MARKER_DEF_ID.exec(line)
    const defId = defMatch ? defMatch[1] : undefined
    let entry = markers.get(missionId)
    if (!entry) {
      entry = { generator, contractName, defId, dropoffs: [] }
      markers.set(missionId, entry)
    }
    const objMatch = PATTERN_MARKER_OBJ.exec(line)
    const posMatch = PATTERN_MARKER_POS.exec(line)
    if (objMatch && posMatch && objMatch[1].toLowerCase() === 'dropoff') {
      const index = parseInt(objMatch[2], 10)
      if (!entry.dropoffs.some((d) => d.index === index)) {
        entry.dropoffs.push({ index, x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]), z: parseFloat(posMatch[3]) })
      }
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
      blueprint: hasBlueprintMarker(rawTitle),
      markerDropoffs: marker?.dropoffs.length ? [...marker.dropoffs].sort((a, b) => a.index - b.index) : undefined
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
