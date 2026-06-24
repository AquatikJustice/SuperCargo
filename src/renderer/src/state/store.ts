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

// fallback roster before first uex sync
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
  // pre-init only; true so welcome screen doesn't flash
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
    // 16 default when unknown, corrected via ocr/manual
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
  /** empty = solver picks cheapest start */
  startLocation: string
  /** null = live plan */
  layout: CargoLayout | null
  route: RoutePlan | null
  /** manual drag sets false */
  isRouteAuto: boolean
  history: HistoryEntry[]
  appVersion: string
  update: UpdateState | null

  // bundled snapshot, replaced by uex sync
  ships: Ship[]
  shipsSyncedAt: string
  locations: Location[]
  locationsSyncedAt: string
  commodities: Commodity[]

  ocrStatus: 'idle' | 'capturing' | 'recognizing'
  ocrResult: OcrResult | null
  ocrEngine: OcrEngineInfo | null

  // overlays
  captureOpen: boolean
  /** capture adds to this existing contract */
  captureTargetId: string | null
  compactOpen: boolean

  init: () => Promise<void>

  setView: (view: ViewId) => void
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
  setContractStatus: (id: string, status: HaulingContract['status']) => void
  resetRouteToAuto: () => void
  toggleObjectiveDelivered: (contractId: string, objectiveId: string) => void
  lockLayout: () => void
  unlockLayout: () => void
  turnInDestination: (
    entries: Array<{ contractId: string; objectiveId: string; deliveredScu: number }>
  ) => void
  setObjectiveScu: (contractId: string, objectiveId: string, scuAmount: number) => void
  /** changing maxBoxSize re-boxes every objective */
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
  reorderStops: (from: number, to: number) => void
  setStartLocation: (loc: string) => void
  startNewRun: () => void

  // history
  updateHistoryReward: (id: string, reward: number) => void
  clearHistory: () => void

  checkForUpdates: () => Promise<void>

  scanSession: () => Promise<number>

  runOcr: () => Promise<void>
  clearOcr: () => void
  refreshOcrEngine: () => Promise<void>
}

function nextOrder(contracts: HaulingContract[], prevOrder: string[]): string[] {
  return destinationsInOrder(contracts, prevOrder)
}

export const useStore = create<StoreState>((set, get) => {
  const persist = (): void => {
    const { runId, contracts, order, layout, startLocation } = get()
    void window.supercargo.saveManifest({ runId, contracts, order, layout: layout ?? undefined, startLocation })
  }

  const commit = (contracts: HaulingContract[], order?: string[]): void => {
    const nextOrd = nextOrder(contracts, order ?? get().order)
    // keep locked layout in sync without re-flowing
    let layout = get().layout
    if (!contracts.length) layout = null
    else if (layout?.locked) layout = reconcileLayout(contracts, layout)
    set({ contracts, order: nextOrd, layout })
    persist()
  }

  // only main owns route ordering, compact would fight it
  const isCompactWindow =
    typeof window !== 'undefined' && window.location.hash.replace('#', '') === 'compact'
  let rerouteTimer: ReturnType<typeof setTimeout> | null = null
  const doReroute = async (): Promise<void> => {
    const { contracts, locations, settings, ships, startLocation } = get()
    const ship = ships.find((s) => s.name === settings.activeShip)
    const capacity = shipCapacity(ship, settings.installedModules[settings.activeShip])
    // pending-ocr contracts aren't shown yet
    const plan = computeRoutePlan(
      contracts.filter((c) => !c.pendingOcr),
      locations,
      capacity,
      startLocation
    )
    set({ route: plan })
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

  // newest first, deduped by id
  const archive = (contract: HaulingContract, status: HistoryStatus): void => {
    const entry = toHistoryEntry(contract, status, get().runId, new Date().toISOString())
    const history = [entry, ...get().history.filter((h) => h.id !== entry.id)]
    set({ history })
    persistHistory(history)
  }

  // disconnect ends every contract at once, looks like abandon;
  // coalesce, only auto-archive a lone end (2+ = session leave, keep)
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

  // un-hold pending-ocr; omit id = release all
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
    startLocation: '',
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
        startLocation: manifest.startLocation ?? '',
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
      scheduleReroute() // initial order from loaded manifest

      window.supercargo.onShips((r) => {
        if (r.ships.length) set({ ships: r.ships, shipsSyncedAt: r.syncedAt })
      })
      window.supercargo.onLocations((r) => {
        set({ locations: r.locations, locationsSyncedAt: r.syncedAt })
        scheduleReroute() // new coords can change the route
      })
      window.supercargo.onCommodities((r) => {
        set({ commodities: r.commodities })
      })

      window.supercargo.onWatcherStatus((s) => set({ watcher: s }))
      window.supercargo.onUpdate((u) => set({ update: u }))
      window.supercargo.onContractAccepted((e: ContractAcceptedEvent) => {
        const { contracts } = get()
        // dedup relog re-emits, no dupe capture
        if (contracts.some((c) => c.id === e.missionId)) return
        // empty manifest = new trip, roll run id so batches group separately
        if (contracts.length === 0) {
          const { runId, history } = get()
          set({ runId: newRunId([runId, ...history.map((h) => h.runId)]) })
        }
        const contract = makeLogContract(e, contracts.length)
        const willOcr = get().settings.ocrAutoCapture && contractNeedsOcr(contract)
        // hold until capture resolves, else looks like a dupe
        commit([...contracts, willOcr ? { ...contract, pendingOcr: true } : contract])
        set({ isRouteAuto: true })
        scheduleReroute()
        if (willOcr) {
          // open the capture view now so the wait shows progress, not a dead ui
          set({ captureOpen: true, captureTargetId: e.missionId, ocrResult: null, ocrStatus: 'recognizing' })
          window.supercargo.requestOcrCapture(e.missionId)
          // safety net if capture never opens
          setTimeout(() => resolvePending(e.missionId), 20000)
        }
      })
      window.supercargo.onObjective((e: ObjectiveEvent) => {
        const { contracts } = get()
        const idx = contracts.findIndex((c) => c.id === e.missionId)
        if (idx < 0) return
        const c = contracts[idx]
        // match commodity+destination, fix scu in place not dupe
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
          archive(contract, 'completed')
          commit(contracts.filter((c) => c.id !== e.missionId))
          set({ isRouteAuto: true })
          scheduleReroute()
          return
        }
        // coalesce so a disconnect storm doesn't wipe the manifest
        if (e.completion === 'Abandon' || e.completion === 'Fail') {
          queueEnd(e.missionId, e.completion === 'Fail' ? 'failed' : 'abandoned')
        }
      })
      window.supercargo.onOpenCapture(() => set({ captureOpen: true, captureTargetId: null }))

      // apply without persisting, else the windows ping-pong
      window.supercargo.onManifestChanged((doc) => {
        set({
          runId: doc.runId,
          contracts: doc.contracts,
          order: doc.order,
          startLocation: doc.startLocation ?? '',
          layout: doc.layout ?? null
        })
        scheduleReroute()
      })
      window.supercargo.onCompactState((s) => set({ compactOpen: s.open }))

      window.supercargo.onOcrStatus((s) =>
        set({ ocrStatus: (s as StoreState['ocrStatus']) ?? 'idle' })
      )
      window.supercargo.onOcrResult((r) => {
        // merge into the tagged contract, not a dupe
        const target =
          r.targetMissionId && get().contracts.some((c) => c.id === r.targetMissionId)
            ? r.targetMissionId
            : null
        set({ ocrResult: r, ocrStatus: 'idle', captureOpen: true, captureTargetId: target })
      })
      void get().refreshOcrEngine()
      // backfill contracts the live watcher missed
      void get().scanSession()
    },

    setView: (view) => set({ view }),
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
        // key on commodity+destination, not scu (ocr misread would dupe)
        const key = (commodity: string, destination: string): string =>
          `${commodity.trim().toLowerCase()}|${destination.trim().toLowerCase()}`
        const seen = new Set(c.objectives.map((o) => key(o.commodity, o.destination)))
        const newObjs = objectives
          .filter((o) => o.commodity.trim() && o.destination.trim() && o.scuAmount > 0)
          .filter((o) => !seen.has(key(o.commodity, o.destination)))
          .map((o) => makeObjective(o, maxBoxSize))
        // re-box existing in case maxBoxSize changed
        const existing = c.objectives.map((o) => ({
          ...o,
          boxes: calculateBoxes(o.scuAmount, maxBoxSize)
        }))
        // box size now confirmed, release the hold
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
      // re-derive payout from stored completion % for partials
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
      set({ runId: newRunId([runId, ...history.map((h) => h.runId)]), layout: null, startLocation: '' })
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
      // lock first, before this stop's boxes drop out
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
      const finished = updated.filter((c) => byContract.has(c.id) && c.objectives.every((o) => o.delivered))
      for (const c of finished) archive(c, 'completed')
      const finishedIds = new Set(finished.map((c) => c.id))
      commit(updated.filter((c) => !finishedIds.has(c.id)))
      scheduleReroute()
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

    reorderStops: (from, to) => {
      const order = [...get().order]
      if (from < 0 || from >= order.length || to < 0 || to >= order.length) return
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved)
      // manual drag wins until contracts change
      set({ order, isRouteAuto: false })
      persist()
    },

    setStartLocation: (loc) => {
      if (loc === get().startLocation) return
      // new start changes order, resume auto-sort
      set({ startLocation: loc, isRouteAuto: true })
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
      let changed = 0
      // backfill objectives a partial live capture missed
      let contracts = get().contracts.map((c) => {
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
              makeObjective(
                { commodity: o.commodity, scuAmount: o.scuAmount, destination: o.destination },
                c.maxBoxSize
              )
            )
          ]
        }
      })
      // add active contracts not in the manifest at all
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
        changed += 1
      }
      if (changed > 0) {
        commit(contracts)
        scheduleReroute()
      }
      return changed
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
