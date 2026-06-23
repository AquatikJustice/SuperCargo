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
  Location,
  Commodity,
  OcrResult,
  OcrEngineInfo,
  HistoryEntry,
  HistoryStatus,
  CargoLayout
} from '@shared/types'
import { calculateBoxes } from '@shared/box'
import { contractRef } from '@shared/contract'
import { newRunId } from '@shared/run'
import { payoutFactor, snapPayout } from '@shared/payout'
import { DEFAULT_SHIP, SHIPS, type Ship } from '@shared/ships'
import { isRosterShip } from '@shared/uexMap'
import { withModules, shipCapacity } from '@shared/shipModules'
import { activeContracts, destinationsInOrder, toHistoryEntry } from './manifest'
import { computeRoutePlan, type RoutePlan } from './route'
import { snapshotLayout, reconcileLayout } from './layout'

// The bundled snapshot still lists edition variants, the mining Golem, and raw
// cargo-module rows. Filter and fold modules so the fallback roster (shown
// before the first UEX sync) matches the live data the main process serves.
const ROSTER_SHIPS = withModules(SHIPS.filter((s) => isRosterShip(s.name)))

export type ViewId = 'manifest' | 'contracts' | 'grid' | 'history' | 'settings'

export interface ManualObjectiveInput {
  commodity: string
  scuAmount: number
  destination: string
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
  ocrEngine: 'tesseract',
  ocrDisplayId: '',
  ocrCrop: { x: 0.32, y: 0.2, w: 0.36, h: 0.6 },
  ocrHotkey: 'CommandOrControl+Shift+C',
  ocrSaveSamples: false,
  contractsDataPath: '',
  contributeTrainingData: false,
  telemetryClientId: '',
  alwaysOnTop: false,
  theme: 'dark',
  uiZoom: 1.1,
  autoCheckUpdates: true,
  // Pre-init fallback only (real value loads from main on init). Default true so
  // the welcome screen does not flash before settings are ready.
  onboarded: true
}

let uidCounter = 0
function uid(prefix: string): string {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`
}

function makeObjective(input: ManualObjectiveInput, maxBoxSize: number): DeliveryObjective {
  return {
    id: uid('obj'),
    commodity: input.commodity.trim(),
    scuAmount: input.scuAmount,
    destination: input.destination.trim(),
    boxes: calculateBoxes(input.scuAmount, maxBoxSize),
    delivered: false
  }
}

/** Whether a contract still needs an OCR pass. The log gives us commodity,
 *  destination and SCU reliably; the one thing it never carries is the max box
 *  size. So OCR is only worth firing when that's still unknown. Otherwise the
 *  log already gave us everything and a capture would add nothing. */
function contractNeedsOcr(c: HaulingContract): boolean {
  return !c.boxSizeConfirmed
}

/** Build a log-sourced contract shell from a Contract Accepted event. */
function makeLogContract(e: ContractAcceptedEvent, refIndex: number): HaulingContract {
  return {
    id: e.missionId,
    title: e.title,
    rank: e.rank,
    haulType: e.haulType,
    pickup: e.pickup,
    reward: 0,
    // The log doesn't state box size; StarStrings contract data sometimes does,
    // otherwise default to 16 (corrected via OCR/manual entry).
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
  /** Frozen 3D cargo layout, set once the run's load is locked (null = live plan). */
  layout: CargoLayout | null
  /** Latest computed pickup->delivery route (null when there's nothing to route). */
  route: RoutePlan | null
  /** When true the stop order is sorted automatically; a manual drag sets it false. */
  isRouteAuto: boolean
  history: HistoryEntry[]
  appVersion: string
  update: UpdateState | null

  // ships (bundled snapshot, replaced by live UEXcorp sync)
  ships: Ship[]
  shipsSyncedAt: string
  // freight delivery/pickup locations (UEXcorp terminals w/ freight elevator)
  locations: Location[]
  locationsSyncedAt: string
  // commodities (UEXcorp) - manual-entry autocomplete + OCR fuzzy matching
  commodities: Commodity[]

  // OCR (Phase 2)
  ocrStatus: 'idle' | 'capturing' | 'recognizing'
  ocrResult: OcrResult | null
  ocrEngine: OcrEngineInfo | null

  // overlays
  captureOpen: boolean
  /** When set, the capture modal adds objectives to this existing contract. */
  captureTargetId: string | null
  compactOpen: boolean

  // lifecycle
  init: () => Promise<void>

  // ui
  setView: (view: ViewId) => void
  setGroupBy: (g: 'destination' | 'contract') => void
  toggleBoxMath: () => void
  openCapture: (targetId?: string) => void
  closeCapture: () => void
  openCompact: () => void
  closeCompact: () => void

  // settings
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>

  // manifest mutations
  addManualContract: (input: ManualContractInput) => void
  addObjectivesToContract: (
    contractId: string,
    objectives: ManualObjectiveInput[],
    maxBoxSize: number
  ) => void
  removeContract: (id: string) => void
  /** Archive a contract to history (as completed) and drop it from the manifest. */
  completeContract: (id: string) => void
  /** Archive a contract to history (as abandoned) and drop it from the manifest. */
  abandonContract: (id: string) => void
  setContractStatus: (id: string, status: HaulingContract['status']) => void
  /** Turn route ordering back to automatic (after a manual drag) and recompute. */
  resetRouteToAuto: () => void
  toggleObjectiveDelivered: (contractId: string, objectiveId: string) => void
  /** Freeze the cargo layout so positions stop moving as you deliver. */
  lockLayout: () => void
  /** Drop the frozen layout and go back to a live, re-flowing plan. */
  unlockLayout: () => void
  /** Record a turn-in at one destination: set delivered SCU per objective, mark them
   *  delivered (clearing the grid section), lock the layout if it wasn't, and archive
   *  any contract that's now fully turned in. */
  turnInDestination: (
    entries: Array<{ contractId: string; objectiveId: string; deliveredScu: number }>
  ) => void
  /** Correct an objective's SCU (e.g. an OCR misread) and re-box it. */
  setObjectiveScu: (contractId: string, objectiveId: string, scuAmount: number) => void
  /** Record how many SCU of an objective were turned in (drives partial payout).
   *  Clamped to 0..required. */
  setObjectiveDeliveredScu: (contractId: string, objectiveId: string, deliveredScu: number) => void
  /** Set a contract's full reward (the headline payout, before the partial factor). */
  setContractReward: (contractId: string, reward: number) => void
  /** Set delivered on a batch of objectives (e.g. "mark this destination done"). */
  setObjectivesDelivered: (
    refs: Array<{ contractId: string; objectiveId: string }>,
    delivered: boolean
  ) => void
  reorderStops: (from: number, to: number) => void
  /** Start a fresh run (generates a new run id). Also happens automatically when
   *  the manifest empties and a new contract is accepted. */
  startNewRun: () => void

  // history
  updateHistoryReward: (id: string, reward: number) => void
  clearHistory: () => void

  // update action
  checkForUpdates: () => Promise<void>

  // log scan
  scanSession: () => Promise<number>

  // OCR actions
  runOcr: () => Promise<void>
  clearOcr: () => void
  refreshOcrEngine: () => Promise<void>
}

function nextOrder(contracts: HaulingContract[], prevOrder: string[]): string[] {
  return destinationsInOrder(contracts, prevOrder)
}

export const useStore = create<StoreState>((set, get) => {
  // Save the manifest part to disk whenever it changes.
  const persist = (): void => {
    const { runId, contracts, order, layout } = get()
    void window.supercargo.saveManifest({ runId, contracts, order, layout: layout ?? undefined })
  }

  const commit = (contracts: HaulingContract[], order?: string[]): void => {
    const nextOrd = nextOrder(contracts, order ?? get().order)
    // Keep a locked layout in step with the contracts (delivered boxes drop out,
    // new cargo appends) without ever re-flowing. An empty manifest ends the run,
    // so the layout resets to a live plan.
    let layout = get().layout
    if (!contracts.length) layout = null
    else if (layout?.locked) layout = reconcileLayout(contracts, layout)
    set({ contracts, order: nextOrd, layout })
    persist()
  }

  // --- route ordering (debounced; log bursts fire many objective events) ---
  // Only the main window owns route ordering. The compact overlay shares this
  // store code but must not recompute or reorder (it would fight the main window).
  const isCompactWindow =
    typeof window !== 'undefined' && window.location.hash.replace('#', '') === 'compact'
  let rerouteTimer: ReturnType<typeof setTimeout> | null = null
  const doReroute = async (): Promise<void> => {
    const { contracts, locations, settings, ships } = get()
    const ship = ships.find((s) => s.name === settings.activeShip)
    const capacity = shipCapacity(ship, settings.installedModules[settings.activeShip])
    // Skip contracts still held pending OCR. They aren't shown yet, so they
    // shouldn't affect the sorted order until they surface. Distances are computed
    // locally from the bundled game-file coordinates, so no fetch is needed.
    const plan = computeRoutePlan(
      contracts.filter((c) => !c.pendingOcr),
      locations,
      capacity
    )
    set({ route: plan })
    // Apply the sorted stop order automatically (unless the user dragged manually).
    if (plan && get().isRouteAuto) {
      const order = nextOrder(get().contracts, plan.destOrder)
      const cur = get().order
      const changed = order.length !== cur.length || order.some((d, i) => d !== cur[i])
      if (changed) {
        set({ order })
        persist()
      }
    }
  }
  const scheduleReroute = (): void => {
    if (isCompactWindow) return
    if (rerouteTimer) clearTimeout(rerouteTimer)
    rerouteTimer = setTimeout(() => {
      rerouteTimer = null
      void doReroute()
    }, 250)
  }

  const persistHistory = (entries: HistoryEntry[]): void => {
    void window.supercargo.saveHistory({ entries })
  }

  // Snapshot a finished contract into history (newest first, deduped by id).
  const archive = (contract: HaulingContract, status: HistoryStatus): void => {
    const entry = toHistoryEntry(contract, status, get().runId, new Date().toISOString())
    const history = [entry, ...get().history.filter((h) => h.id !== entry.id)]
    set({ history })
    persistHistory(history)
  }

  // --- abandon/fail coalescing -------------------------------------------------
  // A deliberate in-game abandon logs `EndMission[Abandon] Reason[Player left]`
  // for one contract. A force-close or disconnect logs the same signature for
  // every active contract at once. We can't tell them apart from the line itself,
  // so we coalesce: buffer ended contracts briefly, and only auto-archive when a
  // single one ended in the window (a real abandon). If 2 or more ended together
  // it's a session-leave, so keep them all (they survive a relog). A lone false
  // positive (disconnect with exactly one active contract) heals itself: the
  // contract re-emits Contract Accepted on relog and is re-added.
  let abandonTimer: ReturnType<typeof setTimeout> | null = null
  const pendingEnds = new Map<string, HistoryStatus>()
  const ABANDON_COALESCE_MS = 2500
  const flushEnds = (): void => {
    abandonTimer = null
    const pending = [...pendingEnds]
    pendingEnds.clear()
    if (pending.length !== 1) {
      if (pending.length > 1)
        console.info(
          `[abandon] ${pending.length} contracts ended together; treating as a disconnect/force-close, keeping them`
        )
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

  // Un-hold a contract that was held pending OCR (see isHeld). `missionId`
  // un-holds just that one; omit it to un-hold all. Called when the capture is
  // submitted or dismissed, plus a safety timeout so nothing stays hidden if the
  // capture never opens.
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
    layout: null,
    route: null,
    isRouteAuto: true,
    history: [],
    appVersion: '',
    update: null,
    ships: ROSTER_SHIPS,
    shipsSyncedAt: '',
    locations: [],
    locationsSyncedAt: '',
    commodities: [],
    ocrStatus: 'idle',
    ocrResult: null,
    ocrEngine: null,
    captureOpen: false,
    captureTargetId: null,
    compactOpen: false,

    init: async () => {
      const [settings, manifest, historyDoc, watcher, appVersion, roster, locRoster, comRoster] =
        await Promise.all([
          window.supercargo.getSettings(),
          window.supercargo.loadManifest(),
          window.supercargo.loadHistory(),
          window.supercargo.getWatcherStatus(),
          window.supercargo.getAppVersion(),
          window.supercargo.getUexShips(),
          window.supercargo.getUexLocations(),
          window.supercargo.getUexCommodities()
        ])

      // Move any finished contracts still sitting in the manifest (from before
      // history existed) into the history log, leaving the manifest active-only.
      // Clear any stale OCR hold from a previous run: no capture is in flight on
      // a fresh launch, so a still-pending contract must surface, not stay hidden.
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

      const layout =
        active.length && manifest.layout ? reconcileLayout(active, manifest.layout) : null

      set({
        settings,
        runId: manifest.runId,
        contracts: active,
        order: nextOrder(active, manifest.order),
        layout,
        history,
        watcher,
        appVersion,
        ships: roster && roster.ships.length ? roster.ships : ROSTER_SHIPS,
        shipsSyncedAt: roster?.syncedAt ?? '',
        locations: locRoster?.locations ?? [],
        locationsSyncedAt: locRoster?.syncedAt ?? '',
        commodities: comRoster?.commodities ?? [],
        ready: true
      })
      scheduleReroute() // compute the initial order from the loaded manifest

      window.supercargo.onShips((r) => {
        if (r.ships.length) set({ ships: r.ships, shipsSyncedAt: r.syncedAt })
      })
      window.supercargo.onLocations((r) => {
        set({ locations: r.locations, locationsSyncedAt: r.syncedAt })
        scheduleReroute() // new location data (incl. coords) can change the route
      })
      window.supercargo.onCommodities((r) => {
        set({ commodities: r.commodities })
      })

      // Subscribe to push events from the main process.
      window.supercargo.onWatcherStatus((s) => set({ watcher: s }))
      window.supercargo.onUpdate((u) => set({ update: u }))
      window.supercargo.onContractAccepted((e: ContractAcceptedEvent) => {
        const { contracts } = get()
        // Skip contracts we already have (e.g. relog re-emits the same missionId):
        // no re-add and no OCR capture, so relog doesn't spam the capture modal.
        if (contracts.some((c) => c.id === e.missionId)) return
        // One trip = one run: if the manifest is empty when a fresh contract
        // arrives, roll to a new run id so each batch groups separately in
        // History. (Relog re-emits are filtered above, so they never roll.)
        if (contracts.length === 0) {
          const { runId, history } = get()
          set({ runId: newRunId([runId, ...history.map((h) => h.runId)]) })
        }
        const contract = makeLogContract(e, contracts.length)
        // Only fire OCR when the log left a gap we need, i.e. the box size is
        // still unknown. If StarStrings already supplied it (boxSizeConfirmed),
        // the log gave us everything and we skip the capture. Auto-capture is also
        // opt-in, so check the same setting main uses before deciding to hold.
        const willOcr = get().settings.ocrAutoCapture && contractNeedsOcr(contract)
        // Hold the contract until the capture is resolved, so its data isn't shown
        // under the capture modal (which would look like an about-to-dupe).
        commit([...contracts, willOcr ? { ...contract, pendingOcr: true } : contract])
        set({ isRouteAuto: true })
        scheduleReroute()
        if (willOcr) {
          window.supercargo.requestOcrCapture(e.missionId)
          // Safety net: never leave a contract hidden if the capture never opens
          // (e.g. the engine is slow/unavailable). Reveal it after a grace period.
          setTimeout(() => resolvePending(e.missionId), 20000)
        }
      })
      window.supercargo.onObjective((e: ObjectiveEvent) => {
        const { contracts } = get()
        const idx = contracts.findIndex((c) => c.id === e.missionId)
        if (idx < 0) return
        const c = contracts[idx]
        // Match an existing objective by commodity+destination. The log is the
        // source of truth for SCU, so if one already exists (e.g. an earlier
        // OCR/manual read) we correct its SCU to the log's value and re-box,
        // never duplicate it. A log replay with the same SCU is a no-op.
        const ek = `${e.commodity.trim().toLowerCase()}|${e.destination.trim().toLowerCase()}`
        const exIdx = c.objectives.findIndex(
          (o) => `${o.commodity.trim().toLowerCase()}|${o.destination.trim().toLowerCase()}` === ek
        )
        let objectives = c.objectives
        if (exIdx >= 0) {
          if (c.objectives[exIdx].scuAmount === e.scuAmount) return // unchanged
          objectives = [...c.objectives]
          objectives[exIdx] = {
            ...objectives[exIdx],
            scuAmount: e.scuAmount,
            boxes: calculateBoxes(e.scuAmount, c.maxBoxSize)
          }
        } else {
          objectives = [
            ...c.objectives,
            makeObjective({ commodity: e.commodity, scuAmount: e.scuAmount, destination: e.destination }, c.maxBoxSize)
          ]
        }
        const updated = [...contracts]
        updated[idx] = { ...c, objectives }
        commit(updated)
        scheduleReroute()
      })
      window.supercargo.onContractEnded((e: ContractEndedEvent) => {
        const { contracts } = get()
        const contract = contracts.find((c) => c.id === e.missionId)
        if (!contract) return
        if (e.completion === 'Complete') {
          // A real completion: archive to history and drop from the manifest now.
          archive(contract, 'completed')
          commit(contracts.filter((c) => c.id !== e.missionId))
          set({ isRouteAuto: true })
          scheduleReroute()
          return
        }
        // Abandon / Fail: don't act immediately. Coalesce so a force-close or
        // disconnect storm (same Abandon/"Player left" for every active contract)
        // doesn't wipe the manifest. A lone end in the window = a real abandon =
        // archived; 2 or more together = a session-leave = kept. See flushEnds.
        if (e.completion === 'Abandon' || e.completion === 'Fail') {
          queueEnd(e.missionId, e.completion === 'Fail' ? 'failed' : 'abandoned')
        }
      })
      window.supercargo.onOpenCapture(() => set({ captureOpen: true, captureTargetId: null }))

      // Cross-window manifest sync (main <-> compact overlay window). Apply the
      // incoming doc without re-persisting so the two windows don't ping-pong.
      window.supercargo.onManifestChanged((doc) => {
        set({ runId: doc.runId, contracts: doc.contracts, order: doc.order, layout: doc.layout ?? null })
        scheduleReroute()
      })
      window.supercargo.onCompactState((s) => set({ compactOpen: s.open }))

      // OCR push events (global hotkey / auto-capture after a contract accept).
      window.supercargo.onOcrStatus((s) =>
        set({ ocrStatus: (s as StoreState['ocrStatus']) ?? 'idle' })
      )
      window.supercargo.onOcrResult((r) => {
        // Auto-capture after a log accept tags the result with the contract's
        // missionId, so merge into that contract instead of creating a duplicate.
        const target =
          r.targetMissionId && get().contracts.some((c) => c.id === r.targetMissionId)
            ? r.targetMissionId
            : null
        set({ ocrResult: r, ocrStatus: 'idle', captureOpen: true, captureTargetId: target })
      })
      void get().refreshOcrEngine()
    },

    setView: (view) => set({ view }),
    setGroupBy: (groupBy) => set({ groupBy }),
    toggleBoxMath: () => set((s) => ({ showBoxMath: !s.showBoxMath })),
    openCapture: (targetId) => set({ captureOpen: true, captureTargetId: targetId ?? null }),
    closeCapture: () => {
      // Dismissing the capture (without submitting) releases any held contract so
      // its log data shows; we just don't get the OCR'd box size for it.
      resolvePending()
      set({ captureOpen: false, captureTargetId: null })
    },
    // Compact mode is now a separate always-on-top window pinned over the game's
    // top-right corner (main process owns it); we just toggle it and track state.
    openCompact: () => {
      void window.supercargo.compactShow()
      set({ compactOpen: true })
    },
    closeCompact: () => {
      void window.supercargo.compactHide()
      set({ compactOpen: false })
    },

    updateSettings: async (patch) => {
      const settings = await window.supercargo.setSettings(patch)
      set({ settings })
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
        // Merge by commodity+destination (not SCU). If the contract already has an
        // objective for this commodity+destination (e.g. the game log added it),
        // we keep that objective's SCU (the log wins; OCR's SCU can be a misread)
        // and only take the box size from this capture. Merging on SCU instead
        // would let a misread land as a phantom duplicate.
        const key = (commodity: string, destination: string): string =>
          `${commodity.trim().toLowerCase()}|${destination.trim().toLowerCase()}`
        const seen = new Set(c.objectives.map((o) => key(o.commodity, o.destination)))
        const newObjs = objectives
          .filter((o) => o.commodity.trim() && o.destination.trim() && o.scuAmount > 0)
          .filter((o) => !seen.has(key(o.commodity, o.destination)))
          .map((o) => makeObjective(o, maxBoxSize))
        // Re-box existing objectives too, in case the max box size changed.
        const existing = c.objectives.map((o) => ({
          ...o,
          boxes: calculateBoxes(o.scuAmount, maxBoxSize)
        }))
        // The box size came from an OCR read / reviewed capture, so it's now known,
        // and the hold is released so the contract shows with its real data.
        return {
          ...c,
          maxBoxSize,
          boxSizeConfirmed: true,
          pendingOcr: false,
          objectives: [...existing, ...newObjs]
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

    completeContract: (id) => {
      const contract = get().contracts.find((c) => c.id === id)
      if (contract) archive(contract, 'completed')
      commit(get().contracts.filter((c) => c.id !== id))
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    abandonContract: (id) => {
      const contract = get().contracts.find((c) => c.id === id)
      if (contract) archive(contract, 'abandoned')
      commit(get().contracts.filter((c) => c.id !== id))
      set({ isRouteAuto: true })
      scheduleReroute()
    },

    updateHistoryReward: (id, reward) => {
      // Editing the full reward re-derives the actual payout from the stored
      // completion %, so partial turn-ins stay correct.
      const history = get().history.map((h) =>
        h.id === id ? { ...h, reward, payout: snapPayout(reward * payoutFactor(h.completionPct ?? 1)) } : h
      )
      set({ history })
      persistHistory(history)
    },

    clearHistory: () => {
      set({ history: [] })
      persistHistory([])
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
      const { runId, history } = get()
      set({ runId: newRunId([runId, ...history.map((h) => h.runId)]), layout: null })
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

    lockLayout: () => {
      const { contracts, order, layout } = get()
      if (layout?.locked || !activeContracts(contracts).length) return
      set({ layout: snapshotLayout(contracts, order) })
      persist()
    },

    unlockLayout: () => {
      if (!get().layout) return
      set({ layout: null })
      persist()
    },

    turnInDestination: (entries) => {
      if (!entries.length) return
      // Auto-lock from the CURRENT load first, so the just-loaded positions are
      // captured before this stop's boxes drop out of the view.
      if (!get().layout?.locked) {
        const { contracts, order } = get()
        if (activeContracts(contracts).length) set({ layout: snapshotLayout(contracts, order) })
      }
      const byContract = new Map<string, Map<string, number>>()
      for (const e of entries) {
        const m = byContract.get(e.contractId) ?? new Map<string, number>()
        m.set(e.objectiveId, e.deliveredScu)
        byContract.set(e.contractId, m)
      }
      const updated = get().contracts.map((c) => {
        const m = byContract.get(c.id)
        if (!m) return c
        return {
          ...c,
          objectives: c.objectives.map((o) =>
            m.has(o.id)
              ? {
                  ...o,
                  delivered: true,
                  deliveredScu: Math.max(0, Math.min(o.scuAmount, Math.round(m.get(o.id) as number)))
                }
              : o
          )
        }
      })
      // A contract with every objective now delivered is a finished run: archive it.
      const finished = updated.filter((c) => byContract.has(c.id) && c.objectives.every((o) => o.delivered))
      for (const c of finished) archive(c, 'completed')
      const finishedIds = new Set(finished.map((c) => c.id))
      commit(updated.filter((c) => !finishedIds.has(c.id)))
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

    reorderStops: (from, to) => {
      const order = [...get().order]
      if (from < 0 || from >= order.length || to < 0 || to >= order.length) return
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      // Manual drag wins: stop auto-sorting until a contract is added or removed.
      set({ order, isRouteAuto: false })
      persist()
    },

    checkForUpdates: async () => {
      set({ update: { kind: 'checking' } })
      await window.supercargo.checkForUpdates()
    },

    scanSession: async () => {
      const scanned = await window.supercargo.scanSession()
      let contracts = get().contracts
      let imported = 0
      for (const s of scanned) {
        if (contracts.some((c) => c.id === s.accepted.missionId)) continue
        const contract = makeLogContract(s.accepted, contracts.length)
        contract.objectives = s.objectives.map((o) =>
          makeObjective(
            { commodity: o.commodity, scuAmount: o.scuAmount, destination: o.destination },
            contract.maxBoxSize
          )
        )
        contracts = [...contracts, contract]
        imported += 1
      }
      if (imported > 0) commit(contracts)
      return imported
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
