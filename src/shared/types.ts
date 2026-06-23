// Shared data models - used by both the main and renderer processes.
// Mirrors spec section 8 (Manifest Manager) and section 13 (Settings).

import type { Ship } from './ships'

/** A rectangle expressed as fractions (0..1) of a display's width/height. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type ContractStatus = 'active' | 'completed' | 'abandoned' | 'failed'
export type DataSource = 'log' | 'ocr' | 'manual'
export type GroupBy = 'destination' | 'contract'
export type GameChannel = 'LIVE' | 'PTU' | 'EPTU' | 'HOTFIX' | string

/** A single box stack of one SCU size for one commodity going to one stop. */
export interface BoxAllocation {
  scuSize: number
  count: number
}

export interface DeliveryObjective {
  id: string
  commodity: string
  scuAmount: number
  destination: string
  /** Optional fuller description of the destination, when known. */
  destinationFull?: string
  /** Calculated from scuAmount + the contract's maxBoxSize. */
  boxes: BoxAllocation[]
  delivered: boolean
  /** SCU actually turned in for this objective (the in-game SUBMIT pays out on
   *  delivered/required). Undefined = not yet marked -> treated as a FULL turn-in
   *  when the contract is submitted as completed. */
  deliveredScu?: number
}

export interface HaulingContract {
  /** Mission GUID from the game log, or a generated id for manual entries. */
  id: string
  title: string
  rank: string
  haulType: string
  pickup: string
  reward: number
  maxBoxSize: number
  /** True when maxBoxSize is a KNOWN value (StarStrings / OCR / manual entry),
   *  false when it's the 16 SCU fallback. Drives whether OCR auto-capture is
   *  needed: the log gives commodity/destination/SCU but never the box size, so
   *  OCR is only fired when this is false. */
  boxSizeConfirmed?: boolean
  acceptedAt: string // ISO timestamp
  status: ContractStatus
  objectives: DeliveryObjective[]
  dataSource: DataSource
  /** Short reference shown in the UI, e.g. "C01". */
  ref: string
  /** True when StarStrings flagged the contract title with a `[BP]` blueprint marker. */
  blueprint?: boolean
  /** Specific blueprints this contract can award (StarStrings, named contracts only). */
  blueprints?: string[]
  /** Reputation awarded, when known (StarStrings annotation). */
  reputation?: number
  /** True while the contract is HELD awaiting its first OCR capture: it exists in
   *  the store (so the capture can merge into it) but is hidden from the manifest /
   *  contracts / grid / route until the capture is submitted or dismissed, so its
   *  data isn't shown underneath the open capture modal. Never persisted as true
   *  across a restart (cleared on load). */
  pendingOcr?: boolean
}

/** Per-channel detected Game.log path. */
export type DetectedInstalls = Record<string, string>

export interface WatcherStatus {
  connected: boolean
  /** Resolved Game.log path currently being tailed, if any. */
  path: string | null
  pollIntervalMs: number
  channel: string | null
  /** Populated when the watcher cannot tail (e.g. file missing). */
  error?: string
}

export interface AppSettings {
  // Game
  gameLogPath: string
  gameChannel: GameChannel

  // Ship
  activeShip: string
  /** Per-ship installed cargo modules (by module id). Absent = all modules fitted. */
  installedModules: Record<string, string[]>

  // OCR (Phase 2)
  /** Seconds to wait after a contract is accepted before auto-capturing. */
  ocrCaptureDelay: number
  /** Auto-capture ~ocrCaptureDelay s after the log reports a contract accept. */
  ocrAutoCapture: boolean
  /** Recognizer engine id (swappable). 'tesseract' for now. */
  ocrEngine: string
  /** Display to capture. '' = primary. Matches Electron's display id (string). */
  ocrDisplayId: string
  /** Crop region as fractions (0..1) of the chosen display - the mobiGlas panel. */
  ocrCrop: CropRect
  /** Global hotkey to trigger a capture (Electron accelerator), '' = disabled. */
  ocrHotkey: string
  /** Opt-in: save each confirmed (crop, label) pair as a training sample. */
  ocrSaveSamples: boolean

  // Contract data (StarStrings localization) - optional enhancement
  /** Override path to a contracts.ini; '' = auto-locate next to the game log. */
  contractsDataPath: string

  // Training-data contribution (opt-in, anonymous)
  /** Upload confirmed grayscale crops to the shared training bucket. Default false. */
  contributeTrainingData: boolean
  /** Anonymous random id grouping this client's uploads. Generated on first run. */
  telemetryClientId: string

  // Display
  alwaysOnTop: boolean
  theme: 'dark' | 'light'
  /** UI zoom factor (text + layout scale) for readability. 1 = 100%. Default 1.1. */
  uiZoom: number

  // Updates
  autoCheckUpdates: boolean

  // Onboarding
  /** True once the user has seen the first-launch welcome + privacy screen. */
  onboarded: boolean
}

/** One box at a fixed spot in the frozen cargo layout. A superset of the packer's
 *  PackBox (so it feeds packCargo directly) plus what it takes to keep the layout
 *  in step with the contracts: which objective it belongs to, and whether it's been
 *  turned in (delivered boxes stay in the pack so nothing slides into their cells,
 *  but they're hidden from the view). */
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
}

/** The cargo layout, frozen once the run is underway. While unlocked the grid is a
 *  live plan that re-flows with the route; once locked the box positions never move
 *  - turn-ins just hide a destination's section and new cargo is appended at the
 *  back. */
export interface CargoLayout {
  locked: boolean
  boxes: FrozenBox[]
}

/** Persisted manifest document (active contracts + the user's stop order). */
export interface ManifestDoc {
  runId: string
  contracts: HaulingContract[]
  /** Ordered list of destination names defining delivery sequence. */
  order: string[]
  /** Frozen 3D cargo layout, present once the run's load is locked. */
  layout?: CargoLayout
}

export type HistoryStatus = 'completed' | 'abandoned' | 'failed'

/** A finished contract archived to the history log (separate from the manifest). */
export interface HistoryEntry {
  id: string
  ref: string
  title: string
  rank: string
  haulType: string
  pickup: string
  /** Payout. Often unknown from the log (0) - editable on the History page. */
  reward: number
  totalScu: number
  totalBoxes: number
  destinations: string[]
  objectiveCount: number
  status: HistoryStatus
  /** Fraction of required cargo turned in (0..1). 1 for a full completion, 0 for
   *  an untouched abandon, in-between for a partial turn-in. */
  completionPct: number
  /** Actual aUEC paid = reward x the partial-payout factor for completionPct.
   *  Equals `reward` at 100%. This is what earnings totals sum. */
  payout: number
  acceptedAt: string
  /** When it completed/abandoned (ISO). */
  endedAt: string
  /** Run it belonged to. */
  runId: string
  dataSource: 'log' | 'ocr' | 'manual'
}

/** Persisted history document. */
export interface HistoryDoc {
  entries: HistoryEntry[]
}

// ---- Log watcher event payloads (main -> renderer) ------------------------

export interface ContractAcceptedEvent {
  missionId: string
  title: string
  generator: string
  contractName: string
  rank: string
  haulType: string
  pickup: string
  acceptedAt: string
  /** StarStrings `[BP]` marker was present on the (raw) title - blueprint chance. */
  blueprint: boolean
  /** Specific blueprints (StarStrings contracts.ini, named contracts) - enriched in main. */
  blueprints?: string[]
  /** Reputation awarded (StarStrings annotation), when known. */
  reputation?: number
  /** Max box size in SCU stated by the contract text (StarStrings), when known. */
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
  completion: string // Complete | Abandon | Fail | Disconnect | ...
  reason?: string // e.g. "Player left" (session end) vs a real abandon
}

// ---- UEXcorp sync (ships + freight locations) ------------------------------

export interface UexSyncResult {
  ok: boolean
  count?: number
  syncedAt?: string
  error?: string
}

/** Result of syncing all rosters at once. */
export interface UexSyncSummary {
  ok: boolean
  ships?: number
  locations?: number
  commodities?: number
  syncedAt?: string
  error?: string
}

/** Cached ship roster pushed/returned to the renderer. */
export interface ShipRoster {
  ships: Ship[]
  syncedAt: string
}

/** A cargo delivery/pickup location (a terminal you can deliver hauling cargo to:
 *  an internal freight elevator and/or an external loading dock). */
export interface Location {
  name: string // displayname, e.g. "HUR-L1 Green Glade Station"
  code: string // nickname, e.g. "HUR-L1"
  maxContainerSize: number // trading container size (NOT used for hauling)
  uexId: number
  /** Has an EXTERNAL freight elevator / "loading dock" (UEX has_loading_dock) -
   *  top/side loading without taxiing the ship inside. Undefined = unknown. */
  hasElevator?: boolean
  /** Game-file starmap position (meters, origin = the system's star), for local
   *  distance math. Same `system` => a real Euclidean distance. Undefined when the
   *  location didn't match a starmap entity (falls back to grouping cost). */
  x?: number
  y?: number
  z?: number
  system?: string
}

export interface LocationRoster {
  locations: Location[]
  syncedAt: string
}

/** A commodity, for manual-entry autocomplete + OCR fuzzy matching. */
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

/** An active hauling contract recovered by scanning the current log session. */
export interface ScannedContract {
  accepted: ContractAcceptedEvent
  objectives: ObjectiveEvent[]
}

// ---- OCR (Phase 2) ---------------------------------------------------------

/** A display the user can pick for capture. */
export interface DisplayInfo {
  id: string
  label: string
  width: number
  height: number
  primary: boolean
}

/** Result of fuzzy-matching one OCR token against a canonical UEX list. */
export interface MatchResult {
  /** The raw token read by OCR. */
  input: string
  /** Best canonical match, or null if nothing was close enough. */
  match: string | null
  /** 0..1 similarity of the best match (1 = exact). */
  score: number
  /** Ranked alternative canonical names for the correction dropdown. */
  suggestions: string[]
}

/** One delivery objective parsed + fuzzy-matched from an OCR pass. */
export interface OcrObjective {
  commodity: MatchResult
  scuAmount: number
  destination: MatchResult
}

/** Full result of a capture -> recognize -> parse -> match pass. */
export interface OcrResult {
  ok: boolean
  error?: string
  /** Engine id that produced this result. */
  engine: string
  /** Wall-clock time of the recognize step, ms. */
  ms: number
  /** Mean recognizer confidence, 0..100. */
  confidence: number
  /** Raw recognized text (shown for debugging / manual correction). */
  rawText: string
  /** Data-URL PNG of the cropped panel (for preview + correction context). */
  imageDataUrl?: string
  /** Max box size in SCU parsed from the contract wording, if found. */
  maxBoxSize?: number
  /** Full contract reward (aUEC) read from the panel's top-right, if found. */
  reward?: number
  objectives: OcrObjective[]
  /** Id of the crop stashed on disk; pass to ocrSaveSample to keep it. */
  sampleId?: string
  /** Set when this pass was auto-fired after a log contract-accept: the missionId
   *  of that contract, so the renderer MERGES into it instead of adding a duplicate. */
  targetMissionId?: string
}

/** Reported state of the active OCR engine. */
export interface OcrEngineInfo {
  id: string
  label: string
  /** False when the engine's runtime (e.g. tesseract.js) failed to load. */
  available: boolean
  /** When false, recognition may need to fetch assets on first run. */
  assetsReady: boolean
  detail?: string
}

// ---- Contract data (StarStrings) -------------------------------------------

/** Status of the optional StarStrings contract-data layer. */
export interface ContractDataStatus {
  /** True when a contracts.ini/global.ini was found and parsed. */
  active: boolean
  /** Resolved source file(s), for display. */
  source: string | null
  /** Named contracts indexed by title. */
  titles: number
  /** How many of those carry specific blueprint lists. */
  blueprintContracts: number
}

// ---- Auto-updater event payloads ------------------------------------------

export type UpdateState =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'none'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }
