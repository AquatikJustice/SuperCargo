import type { Ship } from './ships'
import type { PackBox } from './packer'

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

/** a contract dropoff marker's coords, pulled from the CreateMarker log line */
export interface MarkerDropoff {
  /** dropoff index within the mission (dropoff_<uuid>_N) */
  index: number
  x: number
  y: number
  z: number
}

export interface DeliveryObjective {
  id: string
  commodity: string
  scuAmount: number
  destination: string
  /** empty = use contract pickup */
  pickups?: string[]
  /** full pickup list before the last-pickup-only collapse; present = collapsed */
  originalPickups?: string[]
  destinationFull?: string
  boxes: BoxAllocation[]
  /** pre-edit breakdown, stamped on first hand edit; absent = never corrected */
  originalBoxes?: BoxAllocation[]
  delivered: boolean
  /** undefined = full turn-in */
  deliveredScu?: number
  /** soft turn-in from loading mode, editable until game log confirms; undefined = not yet turned in */
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
  /** someone shared this contract with you (you're not the owner) */
  sharedWithMe?: boolean
  /** player ids who joined a contract you own and shared out; kept for the count */
  sharedWith?: string[]
  /** curated once (OCR review/manual); game re-logs objectives so we stop appending after, avoids phantom dupes */
  objectivesSettled?: boolean
  /** the player who shared this contract left it; mission survives and the reward stops splitting */
  sharerLeft?: boolean
  /** log generator name, e.g. "Covalex_Hauling" */
  generator?: string
  /** mission template, e.g. "HaulCargo_SingleToMulti3_..." */
  contractName?: string
  /** per-commodity max box size (lowercased name), from contract overrides */
  commodityBoxSizes?: Record<string, number>
  /** pre-edit max box, stamped on first hand edit */
  originalMaxBoxSize?: number
  /** all cargo at the last listed pickup (game bug); objectives stay collapsed while set */
  lastPickupOnly?: boolean
  /** user flipped the pickup-bug toggle by hand; feeds override authoring */
  lastPickupOnlyManual?: boolean
  /** dropoff marker coords from the log, for recovering a destination the game left unresolved */
  markerDropoffs?: MarkerDropoff[]
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

/** saved orbit camera for the 3D cargo grid */
export interface GridView {
  pos: [number, number, number]
  target: [number, number, number]
}

export interface OcrEditTally {
  commodity?: number
  scu?: number
  destination?: number
  pickup?: number
  reward?: number
  boxSize?: number
}

export interface AppSettings {
  gameLogPath: string
  gameChannel: GameChannel

  activeShip: string
  /** absent = all modules fitted */
  installedModules: Record<string, string[]>
  /** leave a cell of space between different stops' cargo when it fits */
  spaceDeliveryPiles: boolean

  ocrCaptureDelay: number
  ocrAutoCapture: boolean
  /** 'window' = grab just the Star Citizen window; 'display' = whole screen (hides our windows for the shot) */
  ocrCaptureTarget: 'window' | 'display'
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

  /** anonymous usage snapshot on launch; on by default */
  shareUsageStats: boolean
  /** OCR read accuracy, tallied at review: fields OCR attempted vs fields the user had to correct */
  ocrFieldsTotal?: number
  ocrFieldsEdited?: number
  ocrEdits?: OcrEditTally
  /** "WxH" of the last OCR capture, i.e. the resolution the game runs at */
  ocrGameRes?: string
  /** last usage ping, ISO; throttles pings to ~once a day */
  lastUsagePingAt?: string

  alwaysOnTop: boolean
  theme: 'dark' | 'light'
  /** 1 = 100% */
  uiZoom: number

  /** 0.4..1; higher blocks the game's re-tracked mission text */
  overlayOpacity: number
  /** overlay size multiplier, 1 = default */
  overlayScale: number
  /** which screen corner the overlay pins to */
  overlayCorner: 'tl' | 'tr' | 'bl' | 'br'
  /** overlay ignores the mouse so clicks fall through to the game */
  overlayClickThrough: boolean

  /** orbit camera per ship, survives leaving the page and restarts */
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

/** hand-placed box, keyed by objectiveId#slot so it survives manifest edits; coords are bay-local cells */
export interface ManualPlacement {
  gridId: string
  x: number
  y: number
  z: number
  rotated: boolean
}

/** box physically aboard, locked where it sat when its pickup was ticked; re-plans pack around these */
export interface LoadedPin extends ManualPlacement {
  pickupKey: string
  /** world extents at pin time; older pins rebuild them from box dims */
  w?: number
  l?: number
  h?: number
}

/** Stor-All crate parked in the hold as personal storage; planner treats its cells as gone */
export interface StorAllCrate {
  id: string
  size: number
  gridId: string
  x: number
  y: number
  z: number
  w: number
  l: number
  h: number
}

export interface RouteLoadLine {
  ref: string
  tell: string | null
  commodity: string
  /** scu moved this step */
  scu: number
  /** full objective scu */
  totalScu: number
  breakdown: string
  /** box sizes loaded this step */
  loadBoxes: number[]
  /** breakdown of the whole objective */
  totalBreakdown: string
  destination: string
  multiPickup: boolean
  objectiveId: string
  contractId: string
  /** 1-based trip for this objective */
  tripPos: number
  tripTotal: number
}

export interface LoadingStep {
  nodeKey: string
  label: string
  code: string
  region: string
  trip: number
  /** the synthetic step 0: empty ship at the depot, set up before heading out */
  start?: boolean
  kind: 'load' | 'drop'
  /** load destination, else the stop */
  boundFor: string
  /** 1-based load group, 0 on drop */
  groupPos: number
  groupTotal: number
  lines: RouteLoadLine[]
  loadIds: string[]
  dropIds: string[]
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
  /** where the last pickup/turn-in happened; the router plans from here */
  currentLocation?: string
  /** false = the user hand-ordered the stops; preserve it across a restart */
  isRouteAuto?: boolean
  /** boxes aboard mid-walk, locked at the spot they were loaded, keyed by objectiveId#slot */
  loadedPins?: Record<string, LoadedPin>
  /** resume the loading walkthrough where you left off after a restart */
  loadingActive?: boolean
  loadingIdx?: number
  /** boxes the user chose to overload off-grid, keyed by objectiveId#slot */
  loose?: string[]
  /** where each off-grid box sits in the virtual pane, keyed by objectiveId#slot */
  looseSpots?: Record<string, ManualPlacement>
  /** pickupKey each box went loose at, so a rewind past that step un-stashes it; keyed by objectiveId#slot */
  looseAt?: Record<string, string>
  /** missionIds the user dismissed; scan-session won't re-import them from the log */
  dismissed?: string[]
  /** objectiveIds the user pushed to a later trip */
  deferred?: string[]
  /** objectiveIds grabbed early at a node's first visit */
  grabbed?: string[]
  /** parked Stor-All crates, keyed by ship */
  storAlls?: Record<string, StorAllCrate[]>
  /** frozen loading walk, so restart resumes the exact plan (route would've dropped pickups for cargo now aboard) */
  loadingSteps?: LoadingStep[] | null
  loadingBoxes?: PackBox[] | null
}

export type HistoryStatus = 'completed' | 'abandoned' | 'failed'

/** finished contract's inputs reset to pre-delivery state, so re-running the planner reproduces the route for debugging */
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
  /** your cut scaled by completionPct; earnings sum this */
  payout: number
  /** heads splitting the reward if shared; re-derives payout on a reward edit */
  shareSplit?: number
  /** actual aUEC from the game log when we saw it; wins over the estimate for earnings */
  actualPayout?: number
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
  /** per-commodity max box size (lowercased name), from contract overrides */
  commodityBoxSizes?: Record<string, number>
  /** bugged multi-pickup class: everything spawns at the last pickup; from contract overrides */
  lastPickupOnly?: boolean
  markerDropoffs?: MarkerDropoff[]
}

/** community-sourced fix for a contract whose real box sizes differ from the defaults */
export interface ContractOverride {
  /** mission template, exact case-insensitive match */
  contractName?: string
  /** mission template substring, case-insensitive; tags a whole family (e.g. "ToSingle") */
  contractNameIncludes?: string
  /** fallback match on normalized title */
  title?: string
  maxBoxSize?: number
  /** commodity name -> max box size */
  commodities?: Record<string, number>
  /** all cargo at the last listed pickup (game bug); collapse the others */
  lastPickupOnly?: boolean
}

/** sent once, when a contract with hand-corrected box sizes ends */
export interface BoxSizeReport {
  missionId: string
  title: string
  generator?: string
  contractName?: string
  rank?: string
  haulType?: string
  pickup?: string
  dataSource: DataSource
  maxBoxSize: number
  /** present = MAX BOX was hand-corrected from this */
  originalMaxBoxSize?: number
  boxSizeConfirmed: boolean
  /** how the contract ended; untouched objectives on a completed run count as confirmed defaults */
  status: HistoryStatus
  objectives: {
    commodity: string
    destination: string
    scuAmount: number
    boxes: BoxAllocation[]
    /** present = breakdown was hand-corrected from this */
    originalBoxes?: BoxAllocation[]
    delivered: boolean
  }[]
  /** pickup-bug collapse in effect when the contract ended */
  lastPickupOnly?: boolean
  /** collapse was toggled by hand, not by an override; authoring signal */
  lastPickupOnlyManual?: boolean
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

export interface ContractPaidEvent {
  missionId: string
  /** actual aUEC the game awarded, already net of fees and any share split */
  amount: number
}

export interface ShareEvent {
  missionId: string
  /** shared = it was shared TO you; joined/left = someone came/went on yours */
  kind: 'shared' | 'joined' | 'left'
  /** owner id (shared) or the other player's id (joined/left); log gives no name */
  actorId: string
  /** left only: actor is the local player; undefined when the local geid wasn't seen */
  isLocal?: boolean
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
export type BayFaceKind = 'wall' | 'exit' | 'aisle' | 'floor'
/** the six bay faces, by signed axis (y+ = roof side, y- = floor). */
export type BayDir = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-'

export interface BayMarkup {
  id: string
  faces?: Partial<Record<BayDir, BayFaceKind>>
  /** which combined hold this bay belongs to, bays sharing a group pack as one room; absent = use generated */
  group?: number
  /** position/size override correcting the generated layout; absent = use generated. */
  x?: number
  y?: number
  z?: number
  w?: number
  l?: number
  h?: number
  /** visual-only euler spin (degrees) about the bay center, for off-axis layouts like Hull B's diamond; packer ignores it */
  rot?: [number, number, number]
  /** bay exists but the app must never show or fill it (Ironclad secure vaults); markup tool still shows it */
  hidden?: boolean
}

/** authored markup for one ship: orientation + per-bay faces and layout fixes. */
export interface ShipMarkup {
  ship: string
  /** which signed axis points to the bow / to starboard (up is y+). */
  frame?: { fore: BayDir; starboard: BayDir }
  /** off-grid stash pad beside the ship; absent = built-in size, on:false = no pad; x/y/z override auto-park spot */
  offGrid?: { on: boolean; w?: number; l?: number; h?: number; x?: number; y?: number; z?: number }
  /** bays are positioned around world 0, render at authored coords instead of auto-centering */
  anchored?: boolean
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

/** sharing state for one mission, rebuilt from a whole-log scan */
export interface ScanShare {
  missionId: string
  sharedWithMe: boolean
  sharedWith: string[]
  /** the sharer dropped off this mission; your cut is no longer split */
  ownerLeft?: boolean
}

export interface SessionScan {
  contracts: ScannedContract[]
  shares: ScanShare[]
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
  /** "WxH" of the full frame before cropping */
  captureRes?: string
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
