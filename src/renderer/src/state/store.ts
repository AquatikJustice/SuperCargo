import { create } from 'zustand'
import type {
  AppSettings,
  HaulingContract,
  DeliveryObjective,
  WatcherStatus,
  UpdateState,
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  ContractPaidEvent,
  Location,
  Commodity,
  OcrResult,
  OcrEngineInfo,
  HistoryEntry,
  HistoryStatus,
  CargoLayout,
  FrozenBox,
  ManualPlacement,
  LoadedPin,
  ScannedContract
} from '@shared/types'
import { calculateBoxes } from '@shared/box'
import { contractRef } from '@shared/contract'
import { newRunId } from '@shared/run'
import { payoutFactor, snapPayout } from '@shared/payout'
import { DEFAULT_SHIP, SHIPS, type Ship } from '@shared/ships'
import { isRosterShip } from '@shared/uexMap'
import { withModules } from '@shared/shipModules'
import { gridCapacity, gridsFor, loadableGrids, setGridFaces, type CargoGrid } from '@shared/cargoGrids'
import { activeContracts, destinationsInOrder, toHistoryEntry } from './manifest'
import { computeRoutePlan, type RoutePlan } from './route'
import { reconcileLayout } from './layout'
import type { LoadingStep } from './loading'
import type { PackBox } from '@shared/packer'

// fallback before first uex sync
const ROSTER_SHIPS = withModules(SHIPS.filter((s) => isRosterShip(s.name)))

export type ViewId = 'manifest' | 'contracts' | 'grid' | 'history' | 'settings'

export interface ManualObjectiveInput {
  commodity: string
  scuAmount: number
  destination: string
  /** empty = use contract pickup */
  pickups?: string[]
}

export interface ManualContractInput {
  title: string
  rank: string
  haulType: string
  pickup: string
  reward: number
  maxBoxSize: number
  objectives: ManualObjectiveInput[]
}

const DEFAULT_SETTINGS: AppSettings = {
  gameLogPath: '',
  gameChannel: 'LIVE',
  activeShip: DEFAULT_SHIP,
  installedModules: {},
  ocrCaptureDelay: 3,
  ocrAutoCapture: false,
  ocrCaptureTarget: 'window',
  ocrEngine: 'tesseract',
  ocrDisplayId: '',
  ocrCrop: { x: 0.32, y: 0.2, w: 0.36, h: 0.6 },
  ocrHotkey: 'CommandOrControl+Shift+C',
  contractsDataPath: '',
  contributeTrainingData: false,
  telemetryClientId: '',
  alwaysOnTop: false,
  theme: 'dark',
  uiZoom: 1.1,
  overlayOpacity: 0.85,
  overlayScale: 1,
  overlayCorner: 'tr',
  overlayClickThrough: false,
  autoCheckUpdates: true,
  // avoids a welcome-screen flash
  onboarded: true
}

let uidCounter = 0
function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`
}

const BOX_SIZES = [1, 2, 4, 8, 16, 24, 32]
function snapMaxBox(n: number): number {
  const fit = BOX_SIZES.filter((s) => s <= n)
  return fit.length ? fit[fit.length - 1] : 1
}

function makeObjective(input: ManualObjectiveInput, maxBoxSize: number): DeliveryObjective {
  const pickups = input.pickups?.map((p) => p.trim()).filter(Boolean)
  return {
    id: uid('obj'),
    commodity: input.commodity.trim(),
    scuAmount: input.scuAmount,
    destination: input.destination.trim(),
    pickups: pickups && pickups.length ? pickups : undefined,
    boxes: calculateBoxes(input.scuAmount, maxBoxSize),
    delivered: false
  }
}

function contractNeedsOcr(c: HaulingContract): boolean {
  return !c.boxSizeConfirmed
}

function makeLogContract(e: ContractAcceptedEvent, refIndex: number): HaulingContract {
  return {
    id: e.missionId,
    title: e.title,
    rank: e.rank,
    haulType: e.haulType,
    pickup: e.pickup,
    reward: 0,
    // 16 default, fixed via ocr/manual
    maxBoxSize: e.maxBoxSize ?? 16,
    boxSizeConfirmed: e.maxBoxSize != null,
    acceptedAt: e.acceptedAt,
    status: 'active',
    objectives: [],
    dataSource: 'log',
    ref: contractRef(refIndex),
    blueprint: e.blueprint,
    blueprints: e.blueprints,
    reputation: e.reputation
  }
}

interface StoreState {
  ready: boolean
  view: ViewId
  groupBy: 'destination' | 'contract'
  showBoxMath: boolean
  settings: AppSettings
  watcher: WatcherStatus
  runId: string
  contracts: HaulingContract[]
  order: string[]
  /** empty = use the suggestion */
  stopOrder: string[]
  /** empty = solver picks start */
  startLocation: string
  /** null = live plan */
  layout: CargoLayout | null
  route: RoutePlan | null
  /** manual drag sets false */
  isRouteAuto: boolean
  /** boxes overloaded off-grid this run, keyed by objectiveId#slot */
  looseBoxes: string[]
  /** objectiveIds the user pushed to a later trip ("come back for it") */
  deferredObjectives: string[]
  /** missionIds dismissed by the user, kept so scan-session won't re-import them */
  dismissedMissions: string[]
  /** contracts a session scan found but that aren't reviewed into the list yet */
  scanQueue: ScannedContract[]
  scanReviewOpen: boolean
  history: HistoryEntry[]
  appVersion: string
  update: UpdateState | null

  // bundled snapshot, replaced by uex sync
  ships: Ship[]
  shipsSyncedAt: string
  locations: Location[]
  locationsSyncedAt: string
  commodities: Commodity[]
  /** bumps to re-derive grid faces */
  gridFacesSyncedAt: string

  ocrStatus: 'idle' | 'capturing' | 'recognizing'
  ocrResult: OcrResult | null
  ocrEngine: OcrEngineInfo | null

  // overlays
  captureOpen: boolean
  /** capture adds to this contract */
  captureTargetId: string | null
  compactOpen: boolean

  // survives leaving the grid page
  loadingActive: boolean
  /** drag boxes by hand */
  manualActive: boolean
  /** keyed by objectiveId#slot */
  manualLayout: Record<string, ManualPlacement>
  /** boxes aboard, locked where they were loaded; keyed by objectiveId#slot */
  loadedPins: Record<string, LoadedPin>
  loadingIdx: number
  /** frozen so turn-ins keep steps */
  loadingSteps: LoadingStep[] | null
  /** frozen so turn-ins don't repack */
  loadingBoxes: PackBox[] | null

  init: () => Promise<void>

  setView: (view: ViewId) => void
  setLoadingActive: (v: boolean | ((p: boolean) => boolean)) => void
  setManualActive: (v: boolean) => void
  setManualPlacement: (key: string, placement: ManualPlacement) => void
  mergeManualPlacements: (placements: Record<string, ManualPlacement>) => void
  clearManualPlacement: (key: string) => void
  clearAllManual: () => void
  setLoadingIdx: (v: number | ((p: number) => number)) => void
  setLoadingSteps: (v: LoadingStep[] | null | ((p: LoadingStep[] | null) => LoadingStep[] | null)) => void
  setLoadingBoxes: (v: PackBox[] | null | ((p: PackBox[] | null) => PackBox[] | null)) => void
  setGroupBy: (g: 'destination' | 'contract') => void
  toggleBoxMath: () => void
  openCapture: (targetId?: string) => void
  closeCapture: () => void
  openCompact: () => void
  closeCompact: () => void

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // manifest mutations
  addManualContract: (input: ManualContractInput) => void
  addObjectivesToContract: (
    contractId: string,
    objectives: ManualObjectiveInput[],
    maxBoxSize: number
  ) => void
  removeContract: (id: string) => void
  completeContract: (id: string) => void
  abandonContract: (id: string) => void
  fileCompleted: (id: string) => void
  setContractStatus: (id: string, status: HaulingContract['status']) => void
  resetRouteToAuto: () => void
  toggleObjectiveDelivered: (contractId: string, objectiveId: string) => void
  lockLayout: (boxes: FrozenBox[]) => void
  unlockLayout: () => void
  turnInDestination: (
    entries: Array<{ contractId: string; objectiveId: string; deliveredScu: number }>
  ) => void
  /** undo a soft turn-in */
  unmarkTurnIn: (objectiveIds: string[]) => void
  /** toggle a pickup checkoff */
  setPickedUp: (contractId: string, objectiveId: string, pickupKey: string, picked: boolean) => void
  clearAllPickedUp: () => void
  setObjectiveScu: (contractId: string, objectiveId: string, scuAmount: number) => void
  /** maxBoxSize change re-boxes everything */
  editContract: (
    id: string,
    patch: { title?: string; pickup?: string; rank?: string; reward?: number; maxBoxSize?: number }
  ) => void
  editObjective: (
    contractId: string,
    objectiveId: string,
    patch: { commodity?: string; destination?: string }
  ) => void
  setObjectiveDeliveredScu: (contractId: string, objectiveId: string, deliveredScu: number) => void
  setContractReward: (contractId: string, reward: number) => void
  setObjectivesDelivered: (
    refs: Array<{ contractId: string; objectiveId: string }>,
    delivered: boolean
  ) => void
  reorderStops: (fromKey: string, toKey: string) => void
  setStartLocation: (loc: string) => void
  setBoxLoose: (key: string, loose: boolean) => void
  /** lock freshly loaded boxes at the spot the plan gave them */
  addLoadedPins: (pins: Record<string, LoadedPin>) => void
  clearLoadedPin: (key: string) => void
  /** push an objective to a later trip, or bring it back */
  setObjectiveDeferred: (objectiveId: string, deferred: boolean) => void
  /** forget every mid-walk decision: come-back deferrals and off-grid stashes */
  resetWalkDecisions: () => void
  startNewRun: () => void

  // history
  updateHistoryReward: (id: string, reward: number) => void
  clearHistory: () => void
  /** remove every entry in run */
  deleteRun: (runId: string) => void

  checkForUpdates: () => Promise<void>

  /** pull active contracts from the log into the review queue; returns queued count */
  scanSession: () => Promise<number>
  openScanReview: () => void
  closeScanReview: () => void
  /** commit a scanned mission to the manifest as-is with the chosen box size */
  addScanItem: (missionId: string, maxBoxSize: number) => void
  /** commit a scanned mission then open OCR capture to fill its details */
  scanItemDetails: (missionId: string) => void
  /** drop from the queue for now; a later scan will re-offer it */
  skipScanItem: (missionId: string) => void
  /** drop it and remember not to re-import it */
  dismissScanItem: (missionId: string) => void

  runOcr: () => Promise<void>
  clearOcr: () => void
  refreshOcrEngine: () => Promise<void>
}

function nextOrder(contracts: HaulingContract[], prevOrder: string[]): string[] {
  return destinationsInOrder(contracts, prevOrder)
}

// guards re-binding on repeat init
let listenersBound = false
// unsubscribes, for HMR teardown
let listenerSubs: Array<() => void> = []
const track = (u: () => void): void => {
  listenerSubs.push(u)
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerSubs.forEach((u) => u())
    listenerSubs = []
    listenersBound = false
  })
  // hot-swap strands the components
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}

export const useStore = create<StoreState>((set, get) => {
  const persist = (): void => {
    // main owns the file
    if (isCompactWindow) return
    const { runId, contracts, order, stopOrder, layout, startLocation, manualLayout, loadedPins, loadingActive, manualActive, loadingIdx, looseBoxes, deferredObjectives, dismissedMissions } = get()
    void window.supercargo.saveManifest({ runId, contracts, order, stopOrder, layout: layout ?? undefined, startLocation, manualLayout, loadedPins, loadingActive, manualActive, loadingIdx, loose: looseBoxes, deferred: deferredObjectives, dismissed: dismissedMissions })
  }

  // active ship's grids
  const holdGrids = (): CargoGrid[] => {
    const { settings } = get()
    return gridsFor(settings.activeShip, settings.installedModules[settings.activeShip])
  }

  const commit = (contracts: HaulingContract[], order?: string[]): void => {
    const nextOrd = nextOrder(contracts, order ?? get().order)
    // sync locked layout, no re-flow
    let layout = get().layout
    if (!contracts.length) layout = null
    else if (layout?.locked) layout = reconcileLayout(contracts, layout, holdGrids())
    set({ contracts, order: nextOrd, layout })
    persist()
  }

  // only main owns route ordering
  const isCompactWindow =
    typeof window !== 'undefined' && window.location.hash.replace('#', '') === 'compact'
  let rerouteTimer: ReturnType<typeof setTimeout> | null = null
  const doReroute = async (): Promise<void> => {
    const { contracts, locations, settings, startLocation, isRouteAuto, stopOrder, deferredObjectives } = get()
    const installed = settings.installedModules[settings.activeShip]
    const capacity = gridCapacity(settings.activeShip, installed)
    const bays = loadableGrids(settings.activeShip, installed)
    // manual keeps order, auto re-solves
    const plan = computeRoutePlan(
      contracts.filter((c) => !c.pendingOcr),
      locations,
      capacity,
      startLocation,
      bays,
      isRouteAuto ? undefined : stopOrder,
      deferredObjectives
    )
    set({ route: plan })
    // compact only displays the route
    if (!plan || isCompactWindow) return
    const cur = get()
    const patch: Partial<StoreState> = {}
    const order = nextOrder(cur.contracts, plan.destOrder)
    if (order.length !== cur.order.length || order.some((d, i) => d !== cur.order[i])) patch.order = order
    // auto adopts the suggested order
    if (
      isRouteAuto &&
      (plan.stopKeys.length !== cur.stopOrder.length || plan.stopKeys.some((k, i) => k !== cur.stopOrder[i]))
    )
      patch.stopOrder = plan.stopKeys
    if (Object.keys(patch).length) {
      set(patch)
      persist()
    }
  }
  const scheduleReroute = (): void => {
    if (rerouteTimer) clearTimeout(rerouteTimer)
    rerouteTimer = setTimeout(() => {
      rerouteTimer = null
      void doReroute()
    }, 250)
  }

  const persistHistory = (entries: HistoryEntry[]): void => {
    void window.supercargo.saveHistory({ entries })
  }

  // bake soft turn-ins into delivery
  const finalizeDelivery = (contract: HaulingContract): HaulingContract => ({
    ...contract,
    objectives: contract.objectives.map((o) =>
      o.turnedInScu !== undefined
        ? { ...o, delivered: true, deliveredScu: o.turnedInScu }
        : { ...o, delivered: true }
    )
  })

  // newest first, deduped by id
  const archive = (contract: HaulingContract, status: HistoryStatus): void => {
    const s = get()
    const entry = toHistoryEntry(contract, status, s.runId, new Date().toISOString())
    // snapshot inputs for replay
    entry.replay = {
      ship: s.settings.activeShip,
      installedModules: s.settings.installedModules[s.settings.activeShip],
      startLocation: s.startLocation,
      order: s.order,
      stopOrder: s.stopOrder,
      contract: {
        ...contract,
        status: 'active',
        objectives: contract.objectives.map((o) => ({
          ...o,
          delivered: false,
          deliveredScu: undefined,
          turnedInScu: undefined,
          pickedUpAt: undefined
        }))
      }
    }
    const history = [entry, ...s.history.filter((h) => h.id !== entry.id)]
    set({ history })
    persistHistory(history)
  }

  // only archive a lone end
  let abandonTimer: ReturnType<typeof setTimeout> | null = null
  const pendingEnds = new Map<string, HistoryStatus>()
  const ABANDON_COALESCE_MS = 2500
  const flushEnds = (): void => {
    abandonTimer = null
    const pending = [...pendingEnds]
    pendingEnds.clear()
    if (pending.length !== 1) {
      if (pending.length > 1)
        console.info(`[abandon] ${pending.length} ended together, looks like a disconnect, keeping them`)
      return
    }
    const [id, status] = pending[0]
    const { contracts } = get()
    const contract = contracts.find((c) => c.id === id)
    if (!contract) return
    archive(contract, status)
    commit(contracts.filter((c) => c.id !== id))
    set({ isRouteAuto: true })
    scheduleReroute()
  }
  const queueEnd = (missionId: string, status: HistoryStatus): void => {
    pendingEnds.set(missionId, status)
    if (abandonTimer) clearTimeout(abandonTimer)
    abandonTimer = setTimeout(flushEnds, ABANDON_COALESCE_MS)
  }

  // release pending-ocr holds
  const resolvePending = (missionId?: string): void => {
    const { contracts } = get()
    let changed = false
    const next = contracts.map((c) => {
      if (c.pendingOcr && (!missionId || c.id === missionId)) {
        changed = true
        return { ...c, pendingOcr: false }
      }
      return c
    })
    if (changed) {
      commit(next)
      scheduleReroute()
    }
  }

  const dropScanItem = (missionId: string): void => {
    const queue = get().scanQueue.filter((s) => s.accepted.missionId !== missionId)
    set({ scanQueue: queue })
    if (!queue.length) set({ scanReviewOpen: false })
  }

  // move a reviewed scan item into the live manifest, mirroring a fresh log accept
  const commitScanContract = (
    item: ScannedContract,
    opts: { maxBoxSize?: number; boxSizeConfirmed?: boolean; pendingOcr?: boolean }
  ): void => {
    const { contracts, runId, history } = get()
    if (contracts.some((c) => c.id === item.accepted.missionId)) return
    // first contract of an empty manifest starts a new trip
    if (contracts.length === 0) {
      set({ runId: newRunId([runId, ...history.map((h) => h.runId)]), loadingActive: false, manualActive: false, loadingIdx: 0 })
    }
    const contract = makeLogContract(item.accepted, contracts.length)
    if (opts.maxBoxSize != null) contract.maxBoxSize = opts.maxBoxSize
    if (opts.boxSizeConfirmed != null) contract.boxSizeConfirmed = opts.boxSizeConfirmed
    contract.objectives = item.objectives.map((o) =>
      makeObjective({ commodity: o.commodity, scuAmount: o.scuAmount, destination: o.destination }, contract.maxBoxSize)
    )
    commit([...contracts, opts.pendingOcr ? { ...contract, pendingOcr: true } : contract])
    set({ isRouteAuto: true })
    scheduleReroute()
  }

  return {
    ready: false,
    view: 'manifest',
    groupBy: 'destination',
    showBoxMath: true,
    settings: DEFAULT_SETTINGS,
    watcher: { connected: false, path: null, pollIntervalMs: 200, channel: null },
    runId: '',
    contracts: [],
    order: [],
    stopOrder: [],
    startLocation: '',
    layout: null,
    route: null,
    isRouteAuto: true,
    looseBoxes: [],
    deferredObjectives: [],
    dismissedMissions: [],
    scanQueue: [],
    scanReviewOpen: false,
    history: [],
    appVersion: '',
    update: null,
    ships: ROSTER_SHIPS,
    shipsSyncedAt: '',
    locations: [],
    locationsSyncedAt: '',
    commodities: [],
    gridFacesSyncedAt: '',
    ocrStatus: 'idle',
    ocrResult: null,
    ocrEngine: null,
    captureOpen: false,
    captureTargetId: null,
    compactOpen: false,
    loadingActive: false,
    manualActive: false,
    manualLayout: {},
    loadedPins: {},
    loadingIdx: 0,
    loadingSteps: null,
    loadingBoxes: null,

    init: async () => {
      const [
        settings,
        manifest,
        historyDoc,
        watcher,
        appVersion,
        roster,
        locRoster,
        comRoster,
        faceRoster
      ] = await Promise.all([
        window.supercargo.getSettings(),
        window.supercargo.loadManifest(),
        window.supercargo.loadHistory(),
        window.supercargo.getWatcherStatus(),
        window.supercargo.getAppVersion(),
        window.supercargo.getUexShips(),
        window.supercargo.getUexLocations(),
        window.supercargo.getUexCommodities(),
        window.supercargo.getUexGridFaces()
      ])
      // faces before grids for reconcile
      if (faceRoster?.gridFaces) setGridFaces(faceRoster.gridFaces)

      const active = manifest.contracts
        .filter((c) => c.status === 'active')
        .map((c) => (c.pendingOcr ? { ...c, pendingOcr: false } : c))
      const ended = manifest.contracts.filter((c) => c.status !== 'active')
      let history = historyDoc.entries
      if (ended.length) {
        const seen = new Set(history.map((h) => h.id))
        const migrated = ended
          .filter((c) => !seen.has(c.id))
          .map((c) => toHistoryEntry(c, c.status as HistoryStatus, manifest.runId, c.acceptedAt))
        history = [...migrated, ...history]
        persistHistory(history)
        void window.supercargo.saveManifest({
          runId: manifest.runId,
          contracts: active,
          order: nextOrder(active, manifest.order)
        })
      }

      const grids = gridsFor(settings.activeShip, settings.installedModules[settings.activeShip])
      const layout =
        active.length && manifest.layout ? reconcileLayout(active, manifest.layout, grids) : null

      set({
        settings,
        runId: manifest.runId,
        contracts: active,
        order: nextOrder(active, manifest.order),
        stopOrder: manifest.stopOrder ?? [],
        startLocation: manifest.startLocation ?? '',
        looseBoxes: manifest.loose ?? [],
        deferredObjectives: manifest.deferred ?? [],
        dismissedMissions: manifest.dismissed ?? [],
        manualLayout: manifest.manualLayout ?? {},
        loadedPins: manifest.loadedPins ?? {},
        // resume walkthrough only with cargo
        loadingActive: active.length ? (manifest.loadingActive ?? false) : false,
        manualActive: active.length ? (manifest.manualActive ?? false) : false,
        loadingIdx: manifest.loadingIdx ?? 0,
        layout,
        history,
        watcher,
        appVersion,
        ships: roster && roster.ships.length ? roster.ships : ROSTER_SHIPS,
        shipsSyncedAt: roster?.syncedAt ?? '',
        locations: locRoster?.locations ?? [],
        locationsSyncedAt: locRoster?.syncedAt ?? '',
        commodities: comRoster?.commodities ?? [],
        gridFacesSyncedAt: faceRoster?.syncedAt ?? '',
        ready: true
      })
      scheduleReroute()

      // bind once; a remount calls init again
      if (listenersBound) return
      listenersBound = true

      track(window.supercargo.onShips((r) => {
        if (r.ships.length) set({ ships: r.ships, shipsSyncedAt: r.syncedAt })
      }))
      track(window.supercargo.onLocations((r) => {
        set({ locations: r.locations, locationsSyncedAt: r.syncedAt })
        scheduleReroute() // new coords, new route
      }))
      track(window.supercargo.onCommodities((r) => {
        set({ commodities: r.commodities })
      }))
      track(window.supercargo.onGridFaces((r) => {
        setGridFaces(r.gridFaces)
        set({ gridFacesSyncedAt: r.syncedAt || String(Date.now()) })
        scheduleReroute()
      }))

      track(window.supercargo.onWatcherStatus((s) => set({ watcher: s })))
      track(window.supercargo.onUpdate((u) => set({ update: u })))
      track(window.supercargo.onContractAccepted((e: ContractAcceptedEvent) => {
        const { contracts, dismissedMissions } = get()
        // dedup relog re-emits
        if (contracts.some((c) => c.id === e.missionId)) return
        // the user dismissed this one; the log keeps re-offering it, so keep ignoring
        if (dismissedMissions.includes(e.missionId)) return
        // empty manifest = fresh trip
        if (contracts.length === 0) {
          const { runId, history } = get()
          set({ runId: newRunId([runId, ...history.map((h) => h.runId)]), loadingActive: false, manualActive: false, loadingIdx: 0 })
        }
        const contract = makeLogContract(e, contracts.length)
        const willOcr = get().settings.ocrAutoCapture && contractNeedsOcr(contract)
        // hold until capture resolves
        commit([...contracts, willOcr ? { ...contract, pendingOcr: true } : contract])
        set({ isRouteAuto: true })
        scheduleReroute()
        if (willOcr) {
          // open capture so the wait shows
          set({ captureOpen: true, captureTargetId: e.missionId, ocrResult: null, ocrStatus: 'recognizing' })
          window.supercargo.requestOcrCapture(e.missionId)
          // net if capture never opens
          setTimeout(() => resolvePending(e.missionId), 20000)
        }
      }))
      track(window.supercargo.onObjective((e: ObjectiveEvent) => {
        const { contracts } = get()
        const idx = contracts.findIndex((c) => c.id === e.missionId)
        if (idx < 0) return
        const c = contracts[idx]
        // fix scu in place, no dupe
        // include scu so two deliveries of the same commodity to the same place both register (#27);
        // the delivered total is fixed per objective, so a re-emit of the same one still dedups
        const ek = `${e.commodity.trim().toLowerCase()}|${e.destination.trim().toLowerCase()}|${e.scuAmount}`
        const exists = c.objectives.some(
          (o) => `${o.commodity.trim().toLowerCase()}|${o.destination.trim().toLowerCase()}|${o.scuAmount}` === ek
        )
        if (exists) return
        const objectives = [
          ...c.objectives,
          makeObjective({ commodity: e.commodity, scuAmount: e.scuAmount, destination: e.destination }, c.maxBoxSize)
        ]
        const updated = [...contracts]
        updated[idx] = { ...c, objectives }
        commit(updated)
        scheduleReroute()
      }))
      track(window.supercargo.onContractEnded((e: ContractEndedEvent) => {
        const { contracts } = get()
        const contract = contracts.find((c) => c.id === e.missionId)
        if (!contract) return
        if (e.completion === 'Complete') {
          pendingEnds.delete(e.missionId)
          archive(finalizeDelivery(contract), 'completed')
          commit(contracts.filter((c) => c.id !== e.missionId))
          set({ isRouteAuto: true })
          scheduleReroute()
          return
        }
        // a shared mission fires a bogus "Player left" abandon mid-haul during party churn;
        // the real end still arrives, so don't archive it
        if (e.completion === 'Abandon' && /left/i.test(e.reason ?? '')) return
        // coalesce against a disconnect wipe
        if (e.completion === 'Abandon' || e.completion === 'Fail') {
          queueEnd(e.missionId, e.completion === 'Fail' ? 'failed' : 'abandoned')
        }
      }))
      track(window.supercargo.onContractPaid((e: ContractPaidEvent) => {
        const history = get().history.map((h) =>
          h.id === e.missionId ? { ...h, actualPayout: e.amount } : h
        )
        set({ history })
        persistHistory(history)
      }))
      track(window.supercargo.onOpenCapture(() => set({ captureOpen: true, captureTargetId: null })))

      // apply without persisting, avoids ping-pong
      track(window.supercargo.onManifestChanged((doc) => {
        set({
          runId: doc.runId,
          contracts: doc.contracts,
          order: doc.order,
          stopOrder: doc.stopOrder ?? [],
          startLocation: doc.startLocation ?? '',
          looseBoxes: doc.loose ?? [],
          deferredObjectives: doc.deferred ?? [],
          dismissedMissions: doc.dismissed ?? [],
          manualLayout: doc.manualLayout ?? {},
          loadedPins: doc.loadedPins ?? {},
          layout: doc.layout ?? null
        })
        scheduleReroute()
      }))
      track(window.supercargo.onCompactState((s) => set({ compactOpen: s.open })))
      // overlay reflects opacity/scale changes made in the main window's settings
      track(window.supercargo.onSettings((s) => set({ settings: s })))

      track(window.supercargo.onOcrStatus((s) =>
        set({ ocrStatus: (s as StoreState['ocrStatus']) ?? 'idle' })
      ))
      track(window.supercargo.onOcrResult((r) => {
        // merge into the tagged contract
        const target =
          r.targetMissionId && get().contracts.some((c) => c.id === r.targetMissionId)
            ? r.targetMissionId
            : null
        set({ ocrResult: r, ocrStatus: 'idle', captureOpen: true, captureTargetId: target })
      }))
      void get().refreshOcrEngine()
      // backfill what the watcher missed
      void get().scanSession()
    },

    setView: (view) => set({ view }),
    setLoadingActive: (v) => {
      set((s) => ({ loadingActive: typeof v === 'function' ? v(s.loadingActive) : v }))
      persist()
    },
    setManualActive: (v) => {
      set({ manualActive: v })
      persist()
    },
    setManualPlacement: (key, placement) => {
      set((s) => ({ manualLayout: { ...s.manualLayout, [key]: placement } }))
      persist()
    },
    mergeManualPlacements: (placements) => {
      set((s) => ({ manualLayout: { ...s.manualLayout, ...placements } }))
      persist()
    },
    clearManualPlacement: (key) => {
      set((s) => {
        if (!(key in s.manualLayout)) return s
        const next = { ...s.manualLayout }
        delete next[key]
        return { manualLayout: next }
      })
      persist()
    },
    clearAllManual: () => {
      set({ manualLayout: {} })
      persist()
    },
    setLoadingIdx: (v) => {
      set((s) => ({ loadingIdx: typeof v === 'function' ? v(s.loadingIdx) : v }))
      persist()
    },
    setLoadingSteps: (v) => set((s) => ({ loadingSteps: typeof v === 'function' ? v(s.loadingSteps) : v })),
    setLoadingBoxes: (v) => set((s) => ({ loadingBoxes: typeof v === 'function' ? v(s.loadingBoxes) : v })),
    setGroupBy: (groupBy) => set({ groupBy }),
    toggleBoxMath: () => set((s) => ({ showBoxMath: !s.showBoxMath })),
    openCapture: (targetId) => set({ captureOpen: true, captureTargetId: targetId ?? null }),
    closeCapture: () => {
      // dismiss releases the held contract
      resolvePending()
      set({ captureOpen: false, captureTargetId: null })
    },
    openCompact: () => {
      void window.supercargo.compactShow()
      set({ compactOpen: true })
    },
    closeCompact: () => {
      void window.supercargo.compactHide()
      set({ compactOpen: false })
    },

    updateSettings: async (patch) => {
      const prev = get().settings
      const settings = await window.supercargo.setSettings(patch)
      set({ settings })
      // ship/modules set the hold
      const shipChanged = patch.activeShip !== undefined && patch.activeShip !== prev.activeShip
      const modulesChanged =
        patch.installedModules !== undefined &&
        JSON.stringify(patch.installedModules) !== JSON.stringify(prev.installedModules)
      if (shipChanged || modulesChanged) {
        // a different hold means a fresh walk: nothing pre-done, nothing
        // pre-placed, nothing pre-decided. Frozen plan, pickup ticks, hand
        // placements, locked aboard-spots, deferrals, and stashes all go
        set({ loadingSteps: null, loadingBoxes: null, loadingIdx: 0, manualLayout: {}, loadedPins: {}, deferredObjectives: [], looseBoxes: [] })
        persist()
        get().clearAllPickedUp()
        scheduleReroute()
      }
    },

    addManualContract: (input) => {
      const { contracts } = get()
      const contract: HaulingContract = {
        id: uid('manual'),
        title: input.title.trim() || `${input.rank || 'Manual'} | ${input.haulType || 'Haul'}`.trim(),
        rank: input.rank.trim(),
        haulType: input.haulType.trim(),
        pickup: input.pickup.trim(),
        reward: input.reward || 0,
        maxBoxSize: input.maxBoxSize,
        boxSizeConfirmed: true, // user entered it
        acceptedAt: new Date().toISOString(),
        status: 'active',
        objectives: input.objectives
          .filter((o) => o.commodity.trim() && o.destination.trim() && o.scuAmount > 0)
          .map((o) => makeObjective(o, input.maxBoxSize)),
        dataSource: 'manual',
        ref: contractRef(contracts.length)
      }
      commit([...contracts, contract])
      set({ captureOpen: false, captureTargetId: null, view: 'manifest', isRouteAuto: true })
      scheduleReroute()
    },

    addObjectivesToContract: (contractId, objectives, maxBoxSize) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        // the modal seeds existing objectives into editable rows, so the submitted set is authoritative.
        // replace rather than merge, but carry delivery progress for rows that survive unchanged.
        const sig = (commodity: string, destination: string, scu: number): string =>
          `${commodity.trim().toLowerCase()}|${destination.trim().toLowerCase()}|${scu}`
        const prior = new Map<string, DeliveryObjective[]>()
        for (const o of c.objectives) {
          const k = sig(o.commodity, o.destination, o.scuAmount)
          ;(prior.get(k) ?? prior.set(k, []).get(k)!).push(o)
        }
        const objectives2 = objectives
          .filter((o) => o.commodity.trim() && o.destination.trim() && o.scuAmount > 0)
          .map((o) => {
            const kept = prior.get(sig(o.commodity, o.destination, o.scuAmount))?.shift()
            const base = makeObjective(o, maxBoxSize)
            return kept
              ? {
                  ...base,
                  id: kept.id,
                  delivered: kept.delivered,
                  deliveredScu: kept.deliveredScu,
                  turnedInScu: kept.turnedInScu,
                  pickedUpAt: kept.pickedUpAt
                }
              : base
          })
        // box size confirmed, release hold
        return {
          ...c,
          maxBoxSize,
          boxSizeConfirmed: true,
          pendingOcr: false,
          objectives: objectives2
        }
      })
      commit(contracts)
      set({ captureOpen: false, captureTargetId: null, view: 'manifest', isRouteAuto: true })
      scheduleReroute()
    },

    removeContract: (id) => {
      const contracts = get().contracts.filter((c) => c.id !== id)
      commit(contracts)
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    // soft turn-in, reversible until Complete
    completeContract: (id) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== id) return c
        return {
          ...c,
          objectives: c.objectives.map((o) =>
            o.turnedInScu === undefined ? { ...o, turnedInScu: o.scuAmount } : o
          )
        }
      })
      commit(contracts)
    },

    abandonContract: (id) => {
      const contract = get().contracts.find((c) => c.id === id)
      if (contract) archive(contract, 'abandoned')
      commit(get().contracts.filter((c) => c.id !== id))
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    // file it ourselves when the game's done-event never lands (manual contracts, missed log)
    fileCompleted: (id) => {
      const contract = get().contracts.find((c) => c.id === id)
      if (!contract) return
      archive(finalizeDelivery(contract), 'completed')
      commit(get().contracts.filter((c) => c.id !== id))
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    updateHistoryReward: (id, reward) => {
      // editing the reward is an explicit override; drop the logged payout and re-derive from completion %
      const history = get().history.map((h) =>
        h.id === id
          ? { ...h, reward, actualPayout: undefined, payout: snapPayout(reward * payoutFactor(h.completionPct ?? 1)) }
          : h
      )
      set({ history })
      persistHistory(history)
    },

    clearHistory: () => {
      set({ history: [] })
      persistHistory([])
    },

    deleteRun: (runId) => {
      const history = get().history.filter((h) => (h.runId || '-') !== runId)
      set({ history })
      persistHistory(history)
    },

    setContractStatus: (id, status) => {
      const contracts = get().contracts.map((c) => (c.id === id ? { ...c, status } : c))
      commit(contracts)
    },

    resetRouteToAuto: () => {
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    startNewRun: () => {
      const { runId, history, contracts } = get()
      // don't lose payouts: file anything already turned in, drop the untouched rest
      contracts
        .filter((c) => c.objectives.some((o) => o.turnedInScu !== undefined))
        .forEach((c) => archive(finalizeDelivery(c), 'completed'))
      set({
        runId: newRunId([runId, ...history.map((h) => h.runId)]),
        contracts: [],
        order: [],
        route: null,
        layout: null,
        manualLayout: {},
        loadedPins: {},
        startLocation: '',
        stopOrder: [],
        isRouteAuto: true,
        looseBoxes: [],
        deferredObjectives: [],
        loadingActive: false,
        manualActive: false,
        loadingIdx: 0
      })
      persist()
    },

    toggleObjectiveDelivered: (contractId, objectiveId) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        return {
          ...c,
          objectives: c.objectives.map((o) =>
            o.id === objectiveId ? { ...o, delivered: !o.delivered } : o
          )
        }
      })
      commit(contracts)
      scheduleReroute()
    },

    lockLayout: (boxes) => {
      const { contracts, layout } = get()
      if (layout?.locked || !activeContracts(contracts).length) return
      // freeze the plan the grid shows
      set({ layout: { locked: true, boxes } })
      persist()
    },

    unlockLayout: () => {
      if (!get().layout) return
      set({ layout: null })
      persist()
    },

    // soft turn-in, live until Complete
    turnInDestination: (entries) => {
      if (!entries.length) return
      const amounts = new Map(entries.map((e) => [e.objectiveId, e.deliveredScu]))
      const updated = get().contracts.map((c) => {
        if (!c.objectives.some((o) => amounts.has(o.id))) return c
        return {
          ...c,
          objectives: c.objectives.map((o) =>
            amounts.has(o.id)
              ? { ...o, turnedInScu: Math.max(0, Math.min(o.scuAmount, Math.round(amounts.get(o.id) as number))) }
              : o
          )
        }
      })
      commit(updated)
    },

    setPickedUp: (contractId, objectiveId, pickupKey, picked) => {
      const updated = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        return {
          ...c,
          objectives: c.objectives.map((o) => {
            if (o.id !== objectiveId) return o
            const cur = o.pickedUpAt ?? []
            const next = picked ? [...new Set([...cur, pickupKey])] : cur.filter((k) => k !== pickupKey)
            return { ...o, pickedUpAt: next }
          })
        }
      })
      // un-ticking puts those boxes back on the dock; their spots unlock
      if (!picked) {
        const pins = get().loadedPins
        const keep = Object.entries(pins).filter(
          ([key, p]) => !(key.startsWith(`${objectiveId}#`) && p.pickupKey === pickupKey)
        )
        if (keep.length !== Object.keys(pins).length) set({ loadedPins: Object.fromEntries(keep) })
      }
      commit(updated)
    },

    addLoadedPins: (pins) => {
      if (!Object.keys(pins).length) return
      set((s) => ({ loadedPins: { ...s.loadedPins, ...pins } }))
      persist()
    },

    clearLoadedPin: (key) => {
      if (!(key in get().loadedPins)) return
      set((s) => {
        const pins = { ...s.loadedPins }
        delete pins[key]
        return { loadedPins: pins }
      })
      persist()
    },

    clearAllPickedUp: () => {
      if (Object.keys(get().loadedPins).length) {
        set({ loadedPins: {} })
        persist()
      }
      const updated = get().contracts.map((c) =>
        c.objectives.some((o) => o.pickedUpAt?.length)
          ? { ...c, objectives: c.objectives.map((o) => (o.pickedUpAt?.length ? { ...o, pickedUpAt: [] } : o)) }
          : c
      )
      if (updated.some((c, i) => c !== get().contracts[i])) commit(updated)
    },

    unmarkTurnIn: (objectiveIds) => {
      const ids = new Set(objectiveIds)
      if (!ids.size) return
      const updated = get().contracts.map((c) => {
        if (!c.objectives.some((o) => ids.has(o.id) && o.turnedInScu !== undefined)) return c
        return {
          ...c,
          objectives: c.objectives.map((o) =>
            ids.has(o.id) && o.turnedInScu !== undefined ? { ...o, turnedInScu: undefined } : o
          )
        }
      })
      commit(updated)
    },

    editContract: (id, patch) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== id) return c
        const next = { ...c }
        if (patch.title !== undefined) next.title = patch.title.trim()
        if (patch.pickup !== undefined) next.pickup = patch.pickup.trim()
        if (patch.rank !== undefined) next.rank = patch.rank.trim()
        if (patch.reward !== undefined) next.reward = Math.max(0, Math.round(patch.reward))
        if (patch.maxBoxSize !== undefined) {
          const mbs = snapMaxBox(patch.maxBoxSize)
          next.maxBoxSize = mbs
          next.boxSizeConfirmed = true
          next.objectives = next.objectives.map((o) => ({ ...o, boxes: calculateBoxes(o.scuAmount, mbs) }))
        }
        return next
      })
      commit(contracts)
      scheduleReroute()
    },

    editObjective: (contractId, objectiveId, patch) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        return {
          ...c,
          objectives: c.objectives.map((o) => {
            if (o.id !== objectiveId) return o
            const next = { ...o }
            if (patch.commodity !== undefined) next.commodity = patch.commodity.trim()
            if (patch.destination !== undefined) next.destination = patch.destination.trim()
            return next
          })
        }
      })
      commit(contracts)
      scheduleReroute()
    },

    setObjectiveScu: (contractId, objectiveId, scuAmount) => {
      if (!Number.isFinite(scuAmount) || scuAmount <= 0) return
      const contracts = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        let changed = false
        const objectives = c.objectives.map((o) => {
          if (o.id !== objectiveId || o.scuAmount === scuAmount) return o
          changed = true
          return { ...o, scuAmount, boxes: calculateBoxes(scuAmount, c.maxBoxSize) }
        })
        return changed ? { ...c, objectives } : c
      })
      commit(contracts)
      scheduleReroute()
    },

    setObjectiveDeliveredScu: (contractId, objectiveId, deliveredScu) => {
      const contracts = get().contracts.map((c) => {
        if (c.id !== contractId) return c
        let changed = false
        const objectives = c.objectives.map((o) => {
          if (o.id !== objectiveId) return o
          const clamped = Math.max(0, Math.min(o.scuAmount, Math.round(deliveredScu)))
          if (o.deliveredScu === clamped) return o
          changed = true
          return { ...o, deliveredScu: clamped }
        })
        return changed ? { ...c, objectives } : c
      })
      commit(contracts)
    },

    setContractReward: (contractId, reward) => {
      const next = Math.max(0, Math.round(reward))
      const contracts = get().contracts.map((c) =>
        c.id === contractId && c.reward !== next ? { ...c, reward: next } : c
      )
      commit(contracts)
    },

    setObjectivesDelivered: (refs, delivered) => {
      const byContract = new Map<string, Set<string>>()
      for (const r of refs) {
        const s = byContract.get(r.contractId) ?? new Set<string>()
        s.add(r.objectiveId)
        byContract.set(r.contractId, s)
      }
      const contracts = get().contracts.map((c) => {
        const ids = byContract.get(c.id)
        if (!ids) return c
        return {
          ...c,
          objectives: c.objectives.map((o) => (ids.has(o.id) ? { ...o, delivered } : o))
        }
      })
      commit(contracts)
      scheduleReroute()
    },

    reorderStops: (fromKey, toKey) => {
      const stopOrder = [...get().stopOrder]
      const from = stopOrder.indexOf(fromKey)
      const to = stopOrder.indexOf(toKey)
      if (from < 0 || to < 0 || from === to) return
      const [moved] = stopOrder.splice(from, 1)
      stopOrder.splice(to, 0, moved)
      // manual order wins for now
      set({ stopOrder, isRouteAuto: false })
      persist()
      scheduleReroute()
    },

    setStartLocation: (loc) => {
      if (loc === get().startLocation) return
      // new start, resume auto-sort
      set({ startLocation: loc, isRouteAuto: true })
      persist()
      scheduleReroute()
    },

    setBoxLoose: (key, loose) => {
      const cur = get().looseBoxes
      const has = cur.includes(key)
      if (loose === has) return
      set({ looseBoxes: loose ? [...cur, key] : cur.filter((k) => k !== key) })
      persist()
    },

    setObjectiveDeferred: (objectiveId, deferred) => {
      const cur = get().deferredObjectives
      const has = cur.includes(objectiveId)
      if (deferred === has) return
      set({ deferredObjectives: deferred ? [...cur, objectiveId] : cur.filter((id) => id !== objectiveId) })
      persist()
      scheduleReroute()
    },

    resetWalkDecisions: () => {
      const { deferredObjectives, looseBoxes } = get()
      if (!deferredObjectives.length && !looseBoxes.length) return
      set({ deferredObjectives: [], looseBoxes: [] })
      persist()
      scheduleReroute()
    },

    checkForUpdates: async () => {
      set({ update: { kind: 'checking' } })
      await window.supercargo.checkForUpdates()
    },

    scanSession: async () => {
      const scanned = await window.supercargo.scanSession()
      if (!scanned.length) return 0
      const key = (o: { commodity: string; destination: string }): string =>
        `${o.commodity.trim().toLowerCase()}|${o.destination.trim().toLowerCase()}`
      const byId = new Map(scanned.map((s) => [s.accepted.missionId, s]))
      // backfill objectives the live watcher missed on contracts we already have
      let changed = 0
      const contracts = get().contracts.map((c) => {
        const s = byId.get(c.id)
        if (!s) return c
        const seen = new Set(c.objectives.map(key))
        const missing = s.objectives.filter((o) => !seen.has(key(o)))
        if (!missing.length) return c
        changed += missing.length
        return {
          ...c,
          objectives: [
            ...c.objectives,
            ...missing.map((o) =>
              makeObjective({ commodity: o.commodity, scuAmount: o.scuAmount, destination: o.destination }, c.maxBoxSize)
            )
          ]
        }
      })
      if (changed > 0) {
        commit(contracts)
        scheduleReroute()
      }
      // everything not already in the list and not dismissed goes to the review queue.
      // the log can't hand us box size, and re-emits accepts without objectives, so we
      // never inject blind; the user reviews each one before it lands.
      const { dismissedMissions } = get()
      const have = new Set(get().contracts.map((c) => c.id))
      const queued = scanned.filter(
        (s) => !have.has(s.accepted.missionId) && !dismissedMissions.includes(s.accepted.missionId)
      )
      set({ scanQueue: queued })
      return queued.length
    },

    openScanReview: () => {
      if (get().scanQueue.length) set({ scanReviewOpen: true })
    },
    closeScanReview: () => set({ scanReviewOpen: false }),

    addScanItem: (missionId, maxBoxSize) => {
      const item = get().scanQueue.find((s) => s.accepted.missionId === missionId)
      if (item) {
        commitScanContract(item, { maxBoxSize, boxSizeConfirmed: true })
      }
      dropScanItem(missionId)
    },

    scanItemDetails: (missionId) => {
      const item = get().scanQueue.find((s) => s.accepted.missionId === missionId)
      dropScanItem(missionId)
      if (!item) return
      // hold it hidden until the capture resolves, same as a live accept.
      // leave scanReviewOpen alone: the capture modal masks the review while it's
      // up, and it comes back for the rest of the queue once capture closes.
      commitScanContract(item, { pendingOcr: true })
      set({ captureOpen: true, captureTargetId: missionId, ocrResult: null, ocrStatus: 'idle' })
    },

    skipScanItem: (missionId) => dropScanItem(missionId),

    dismissScanItem: (missionId) => {
      const cur = get().dismissedMissions
      if (!cur.includes(missionId)) {
        set({ dismissedMissions: [...cur, missionId] })
        persist()
      }
      dropScanItem(missionId)
    },

    runOcr: async () => {
      set({ ocrStatus: 'recognizing', ocrResult: null })
      try {
        const r = await window.supercargo.ocrRun()
        set({ ocrResult: r, ocrStatus: 'idle' })
      } catch (e) {
        set({
          ocrResult: {
            ok: false,
            engine: get().settings.ocrEngine || 'tesseract',
            ms: 0,
            confidence: 0,
            rawText: '',
            objectives: [],
            error: e instanceof Error ? e.message : String(e)
          },
          ocrStatus: 'idle'
        })
      }
    },

    clearOcr: () => set({ ocrResult: null }),

    refreshOcrEngine: async () => {
      try {
        const info = await window.supercargo.ocrEngineInfo()
        set({ ocrEngine: info })
      } catch {
        /* engine info is best-effort */
      }
    }
  }
})
