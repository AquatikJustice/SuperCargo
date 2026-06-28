import type { Ship } from './ships'

/** rect as fractions (0..1) of the display */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type ContractStatus = 'active' | 'completed' | 'abandoned' | 'failed'
export type DataSource = 'log' | 'ocr' | 'manual'
export type CompletionType = 'Complete' | 'Abandon' | 'Fail' | 'Disconnect'
export type GroupBy = 'destination' | 'contract'
export type GameChannel = string

export interface BoxAllocation {
  scuSize: number
  count: number
}

export interface DeliveryObjective {
  id: string
  commodity: string
  scuAmount: number
  destination: string
  /** empty = use contract pickup */
  pickups?: string[]
  destinationFull?: string
  boxes: BoxAllocation[]
  delivered: boolean
  /** undefined = full turn-in */
  deliveredScu?: number
  /** soft turn-in marked in loading mode, editable until the game log confirms; undefined = not yet turned in */
  turnedInScu?: number
  /** route node keys where this cargo has been collected, for the manifest pickup checklist */
  pickedUpAt?: string[]
}

export interface HaulingContract {
  /** mission guid, or generated for manual entries */
  id: string
  title: string
  rank: string
  haulType: string
  pickup: string
  reward: number
  maxBoxSize: number
  /** false = 16 SCU fallback; gates OCR auto-capture */
  boxSizeConfirmed?: boolean
  acceptedAt: string // ISO
  status: ContractStatus
  objectives: DeliveryObjective[]
  dataSource: DataSource
  /** short ui ref, e.g. "C01" */
  ref: string
  blueprint?: boolean
  blueprints?: string[]
  reputation?: number
  /** held + hidden until first OCR capture resolves; never persisted true */
  pendingOcr?: boolean
}

/** per-channel Game.log path */
export type DetectedInstalls = Record<string, string>

export interface WatcherStatus {
  connected: boolean
  path: string | null
  pollIntervalMs: number
  channel: string | null
  error?: string
}

/** saved orbit camera for the 3D cargo grid: where the eye sits and what it looks at */
export interface GridView {
  pos: [number, number, number]
  target: [number, number, number]
}

export interface AppSettings {
  gameLogPath: string
  gameChannel: GameChannel

  activeShip: string
  /** absent = all modules fitted */
  installedModules: Record<string, string[]>

  ocrCaptureDelay: number
  ocrAutoCapture: boolean
  ocrEngine: string
  /** '' = primary */
  ocrDisplayId: string
  ocrCrop: CropRect
  /** electron accelerator, '' = disabled */
  ocrHotkey: string

  /** '' = auto-locate next to game log */
  contractsDataPath: string

  /** keep + upload each confirmed capture to train the shared OCR model */
  contributeTrainingData: boolean
  telemetryClientId: string

  alwaysOnTop: boolean
  theme: 'dark' | 'light'
  /** 1 = 100% */
  uiZoom: number

  /** orbit camera per ship, so the 3D grid view survives leaving the page and restarts */
  gridView?: Record<string, GridView>

  autoCheckUpdates: boolean

  onboarded: boolean
}

/** superset of PackBox; delivered boxes stay packed so cells don't shift */
export interface FrozenBox {
  id: string
  size: number
  color: string
  dest: string
  commodity: string
  stopIdx: number
  contractId: string
  objectiveId: string
  destination: string
  delivered: boolean
  /** ordinal within its objective, for stable manual-placement keys */
  slot?: number
  // packed position, stamped when frozen; absent = didn't fit
  gridId?: string
  x?: number
  y?: number
  z?: number
  w?: number
  l?: number
  h?: number
  rotated?: boolean
}

/** unlocked = re-flows with route; locked = positions frozen */
export interface CargoLayout {
  locked: boolean
  boxes: FrozenBox[]
}

/** a box the user hand-placed in manual mode, keyed by objectiveId#slot so it
 *  survives manifest edits. coords are bay-local cells, like a Placement. */
export interface ManualPlacement {
  gridId: string
  x: number
  y: number
  z: number
  rotated: boolean
}

export interface ManifestDoc {
  runId: string
  contracts: HaulingContract[]
  /** destination names, in delivery order */
  order: string[]
  /** visit sequence (node keys) the user set by reordering stops */
  stopOrder?: string[]
  /** present once the load is locked */
  layout?: CargoLayout
  /** empty = let the solver pick the start */
  startLocation?: string
  /** hand-placed boxes from manual mode, keyed by objectiveId#slot */
  manualLayout?: Record<string, ManualPlacement>
  /** resume the loading/manual walkthrough where you left off after a restart */
  loadingActive?: boolean
  manualActive?: boolean
  loadingIdx?: number
}

export type HistoryStatus = 'completed' | 'abandoned' | 'failed'

/** a finished contract's reproducible inputs, so a run can be replayed step by step
 *  when debugging a route or loading issue. the contract is reset to its
 *  pre-delivery state so re-running the planner reproduces the original route. */
export interface RunReplay {
  ship: string
  installedModules?: string[]
  startLocation: string
  order: string[]
  stopOrder: string[]
  contract: HaulingContract
}

export interface HistoryEntry {
  id: string
  ref: string
  title: string
  rank: string
  haulType: string
  pickup: string
  /** editable in History */
  reward: number
  totalScu: number
  totalBoxes: number
  destinations: string[]
  objectiveCount: number
  status: HistoryStatus
  /** fraction turned in, 0..1 */
  completionPct: number
  /** reward scaled by completionPct; earnings sum this */
  payout: number
  acceptedAt: string
  endedAt: string
  runId: string
  dataSource: DataSource
  /** captured inputs to replay this run when debugging; absent on older entries */
  replay?: RunReplay
}

export interface HistoryDoc {
  entries: HistoryEntry[]
}

export interface ContractAcceptedEvent {
  missionId: string
  title: string
  generator: string
  contractName: string
  rank: string
  haulType: string
  pickup: string
  acceptedAt: string
  blueprint: boolean
  blueprints?: string[]
  reputation?: number
  maxBoxSize?: number
}

export interface ObjectiveEvent {
  missionId: string
  scuAmount: number
  commodity: string
  destination: string
}

export interface ContractEndedEvent {
  missionId: string
  completion: CompletionType
  reason?: string
}

export interface UexSyncResult {
  ok: boolean
  count?: number
  syncedAt?: string
  error?: string
}

export interface UexSyncSummary {
  ok: boolean
  ships?: number
  locations?: number
  commodities?: number
  syncedAt?: string
  error?: string
}

export interface ShipRoster {
  ships: Ship[]
  syncedAt: string
}

export interface Location {
  name: string // e.g. "HUR-L1 Green Glade Station"
  code: string // e.g. "HUR-L1"
  maxContainerSize: number // trading container, not hauling
  uexId: number
  /** UEX has_loading_dock; undefined = unknown */
  hasElevator?: boolean
  /** starmap meters, origin = star; undefined = no match */
  x?: number
  y?: number
  z?: number
  system?: string
  /** lets us match pickups named by operator + body */
  operator?: string
  /** parent moon/planet, e.g. "Cellin" */
  body?: string
}

export interface LocationRoster {
  locations: Location[]
  syncedAt: string
}

export interface Commodity {
  name: string // e.g. "Hydrogen Fuel"
  code: string // e.g. "HYDF"
  kind: string // e.g. "Gas", "Metal"
  uexId: number
}

export interface CommodityRoster {
  commodities: Commodity[]
  syncedAt: string
}

/** WALL = solid side, EXIT = cargo leaves here, AISLE = walkway you can pull into. */
export type BayFaceKind = 'wall' | 'exit' | 'aisle'
/** the six bay faces, by signed axis (y+ = roof side, y- = floor). */
export type BayDir = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-'

export interface BayMarkup {
  id: string
  faces?: Partial<Record<BayDir, BayFaceKind>>
  /** which combined hold this bay belongs to; bays sharing a group pack as one room.
   *  overrides the generated group; absent = use generated. */
  group?: number
  /** position/size override correcting the generated layout; absent = use generated. */
  x?: number
  y?: number
  z?: number
  w?: number
  l?: number
  h?: number
}

/** authored markup for one ship: orientation + per-bay faces and layout fixes. */
export interface ShipMarkup {
  ship: string
  /** which signed axis points to the bow / to starboard (up is y+). */
  frame?: { fore: BayDir; starboard: BayDir }
  bays: BayMarkup[]
}

export interface GridFacesRoster {
  gridFaces: ShipMarkup[]
  syncedAt: string
}

export interface ScannedContract {
  accepted: ContractAcceptedEvent
  objectives: ObjectiveEvent[]
}

export interface DisplayInfo {
  id: string
  label: string
  width: number
  height: number
  primary: boolean
}

export interface MatchResult {
  /** raw OCR token */
  input: string
  /** null if nothing close enough */
  match: string | null
  /** 0..1, 1 = exact */
  score: number
  /** alternatives for the correction dropdown */
  suggestions: string[]
}

export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrObjective {
  commodity: MatchResult
  scuAmount: number
  destination: MatchResult
  pickups?: MatchResult[]
}

export interface OcrResult {
  ok: boolean
  error?: string
  engine: string
  /** recognize time, ms */
  ms: number
  /** 0..100 */
  confidence: number
  rawText: string
  imageDataUrl?: string
  maxBoxSize?: number
  reward?: number
  objectives: OcrObjective[]
  /** pass to ocrSaveSample to keep the crop */
  sampleId?: string
  /** merge target so auto-fired passes don't dupe */
  targetMissionId?: string
}

export interface OcrEngineInfo {
  id: string
  label: string
  /** false = runtime failed to load */
  available: boolean
  /** false = may fetch assets on first run */
  assetsReady: boolean
  detail?: string
}

export interface ContractDataStatus {
  active: boolean
  source: string | null
  titles: number
  blueprintContracts: number
}

export interface DataSyncResult {
  reached: boolean
  changed: boolean
  updated: string[]
}

export type UpdateState =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'none'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }
