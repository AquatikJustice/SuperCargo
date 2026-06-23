import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { IPC } from '@shared/channels'
import type {
  AppSettings,
  ManifestDoc,
  HistoryDoc,
  WatcherStatus,
  DetectedInstalls,
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  UpdateState,
  ShipRoster,
  LocationRoster,
  CommodityRoster,
  ScannedContract,
  DisplayInfo,
  OcrEngineInfo,
  OcrResult,
  ContractDataStatus
} from '@shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  detectInstalls: (): Promise<{ installs: DetectedInstalls; ordered: string[] }> =>
    ipcRenderer.invoke(IPC.detectInstalls),
  pickLogFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickLogFile),

  // manifest
  loadManifest: (): Promise<ManifestDoc> => ipcRenderer.invoke(IPC.manifestLoad),
  saveManifest: (doc: ManifestDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.manifestSave, doc),

  // history
  loadHistory: (): Promise<HistoryDoc> => ipcRenderer.invoke(IPC.historyLoad),
  saveHistory: (doc: HistoryDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.historySave, doc),

  // bundled roster cache (ships / freight locations / commodities)
  getUexShips: (): Promise<ShipRoster | null> => ipcRenderer.invoke(IPC.uexGetShips),
  getUexLocations: (): Promise<LocationRoster | null> => ipcRenderer.invoke(IPC.uexGetLocations),
  getUexCommodities: (): Promise<CommodityRoster | null> => ipcRenderer.invoke(IPC.uexGetCommodities),

  // watcher
  getWatcherStatus: (): Promise<WatcherStatus> => ipcRenderer.invoke(IPC.watcherStatus),
  restartWatcher: (): Promise<boolean> => ipcRenderer.invoke(IPC.watcherRestart),
  scanSession: (): Promise<ScannedContract[]> => ipcRenderer.invoke(IPC.scanSession),

  // window
  windowControl: (action: 'minimize' | 'maximize' | 'close'): Promise<void> =>
    ipcRenderer.invoke(IPC.windowControl, action),
  setAlwaysOnTop: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setAlwaysOnTop, value),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowState: (cb: (s: { maximized: boolean }) => void): Unsubscribe =>
    on(IPC.evtWindowState, cb),

  // compact overlay window
  compactShow: (): Promise<void> => ipcRenderer.invoke(IPC.compactShow),
  compactHide: (): Promise<void> => ipcRenderer.invoke(IPC.compactHide),
  onCompactState: (cb: (s: { open: boolean }) => void): Unsubscribe =>
    on(IPC.evtCompactState, cb),
  onManifestChanged: (cb: (doc: ManifestDoc) => void): Unsubscribe =>
    on(IPC.evtManifestChanged, cb),

  // UI zoom (text + layout scale for readability). Uses webFrame so it scales
  // the viewport itself, so we avoid the layout overflow that CSS `zoom` would cause.
  setZoom: (factor: number): void => webFrame.setZoomFactor(factor),

  // OCR (Phase 2)
  ocrListDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.ocrListDisplays),
  ocrEngineInfo: (): Promise<OcrEngineInfo> => ipcRenderer.invoke(IPC.ocrEngineInfo),
  ocrPreview: (): Promise<string | null> => ipcRenderer.invoke(IPC.ocrPreview),
  ocrRun: (): Promise<OcrResult> => ipcRenderer.invoke(IPC.ocrRun),
  ocrSaveSample: (payload: {
    sampleId: string
    text: string
    fields?: Record<string, unknown>
  }): Promise<boolean> => ipcRenderer.invoke(IPC.ocrSaveSample, payload),
  onOcrResult: (cb: (r: OcrResult) => void): Unsubscribe => on(IPC.evtOcrResult, cb),
  onOcrStatus: (cb: (s: string) => void): Unsubscribe => on(IPC.evtOcrStatus, cb),
  // Ask the main process to auto-capture for a just-accepted contract. The
  // renderer only sends this when the contract is actually new (relog re-emits, and
  // contracts already in the manifest are skipped); main checks the opt-in.
  requestOcrCapture: (missionId: string): void =>
    ipcRenderer.send(IPC.ocrRequestCapture, missionId),

  // Contract data (StarStrings)
  getContractDataStatus: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataStatus),
  rescanContractData: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataRescan),

  // Training-data contribution
  getTelemetryStatus: (): Promise<{ uploaded: number; queued: number }> =>
    ipcRenderer.invoke(IPC.telemetryStatus),

  // updater
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterCheck),
  quitAndInstall: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterQuitAndInstall),

  // events (main -> renderer)
  onWatcherStatus: (cb: (s: WatcherStatus) => void): Unsubscribe =>
    on(IPC.evtWatcherStatus, cb),
  onContractAccepted: (cb: (e: ContractAcceptedEvent) => void): Unsubscribe =>
    on(IPC.evtContractAccepted, cb),
  onObjective: (cb: (e: ObjectiveEvent) => void): Unsubscribe => on(IPC.evtObjective, cb),
  onContractEnded: (cb: (e: ContractEndedEvent) => void): Unsubscribe =>
    on(IPC.evtContractEnded, cb),
  onUpdate: (cb: (s: UpdateState) => void): Unsubscribe => on(IPC.evtUpdate, cb),
  onOpenCapture: (cb: () => void): Unsubscribe => on(IPC.evtOpenCapture, cb),
  onShips: (cb: (roster: ShipRoster) => void): Unsubscribe => on(IPC.evtShips, cb),
  onLocations: (cb: (roster: LocationRoster) => void): Unsubscribe => on(IPC.evtLocations, cb),
  onCommodities: (cb: (roster: CommodityRoster) => void): Unsubscribe => on(IPC.evtCommodities, cb)
}

export type SuperCargoApi = typeof api

contextBridge.exposeInMainWorld('supercargo', api)
