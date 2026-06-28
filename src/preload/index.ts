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
  GridFacesRoster,
  ScannedContract,
  DisplayInfo,
  OcrEngineInfo,
  OcrResult,
  ContractDataStatus,
  DataSyncResult
} from '@shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  detectInstalls: (): Promise<{ installs: DetectedInstalls; ordered: string[] }> =>
    ipcRenderer.invoke(IPC.detectInstalls),
  pickLogFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickLogFile),
  exportRunFile: (payload: { defaultName: string; json: string }): Promise<string | null> =>
    ipcRenderer.invoke(IPC.exportRunFile, payload),

  loadManifest: (): Promise<ManifestDoc> => ipcRenderer.invoke(IPC.manifestLoad),
  saveManifest: (doc: ManifestDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.manifestSave, doc),

  loadHistory: (): Promise<HistoryDoc> => ipcRenderer.invoke(IPC.historyLoad),
  saveHistory: (doc: HistoryDoc): Promise<boolean> =>
    ipcRenderer.invoke(IPC.historySave, doc),

  getUexShips: (): Promise<ShipRoster | null> => ipcRenderer.invoke(IPC.uexGetShips),
  getUexLocations: (): Promise<LocationRoster | null> => ipcRenderer.invoke(IPC.uexGetLocations),
  getUexCommodities: (): Promise<CommodityRoster | null> => ipcRenderer.invoke(IPC.uexGetCommodities),
  getUexGridFaces: (): Promise<GridFacesRoster | null> => ipcRenderer.invoke(IPC.uexGetGridFaces),

  getWatcherStatus: (): Promise<WatcherStatus> => ipcRenderer.invoke(IPC.watcherStatus),
  restartWatcher: (): Promise<boolean> => ipcRenderer.invoke(IPC.watcherRestart),
  scanSession: (): Promise<ScannedContract[]> => ipcRenderer.invoke(IPC.scanSession),

  windowControl: (action: 'minimize' | 'maximize' | 'close'): Promise<void> =>
    ipcRenderer.invoke(IPC.windowControl, action),
  setAlwaysOnTop: (value: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setAlwaysOnTop, value),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowState: (cb: (s: { maximized: boolean }) => void): Unsubscribe =>
    on(IPC.evtWindowState, cb),

  compactShow: (): Promise<void> => ipcRenderer.invoke(IPC.compactShow),
  compactHide: (): Promise<void> => ipcRenderer.invoke(IPC.compactHide),
  compactResize: (height: number): Promise<void> => ipcRenderer.invoke(IPC.compactResize, height),
  onCompactState: (cb: (s: { open: boolean }) => void): Unsubscribe =>
    on(IPC.evtCompactState, cb),
  setLoadingState: (s: { active: boolean; idx: number }): void =>
    ipcRenderer.send(IPC.loadingStateSet, s),
  onLoadingState: (cb: (s: { active: boolean; idx: number }) => void): Unsubscribe =>
    on(IPC.evtLoadingState, cb),
  onManifestChanged: (cb: (doc: ManifestDoc) => void): Unsubscribe =>
    on(IPC.evtManifestChanged, cb),

  // webFrame zoom avoids layout overflow
  setZoom: (factor: number): void => webFrame.setZoomFactor(factor),

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
  requestOcrCapture: (missionId: string): void =>
    ipcRenderer.send(IPC.ocrRequestCapture, missionId),

  getContractDataStatus: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataStatus),
  rescanContractData: (): Promise<ContractDataStatus> =>
    ipcRenderer.invoke(IPC.contractDataRescan),

  refreshData: (): Promise<DataSyncResult> => ipcRenderer.invoke(IPC.dataRefresh),

  getTelemetryStatus: (): Promise<{ uploaded: number; queued: number }> =>
    ipcRenderer.invoke(IPC.telemetryStatus),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterCheck),
  quitAndInstall: (): Promise<boolean> => ipcRenderer.invoke(IPC.updaterQuitAndInstall),

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
  onCommodities: (cb: (roster: CommodityRoster) => void): Unsubscribe => on(IPC.evtCommodities, cb),
  onGridFaces: (cb: (roster: GridFacesRoster) => void): Unsubscribe => on(IPC.evtGridFaces, cb)
}

export type SuperCargoApi = typeof api

contextBridge.exposeInMainWorld('supercargo', api)
