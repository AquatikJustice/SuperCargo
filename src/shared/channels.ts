// shared between main and preload

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  detectInstalls: 'installs:detect',
  pickLogFile: 'dialog:pickLogFile',

  manifestLoad: 'manifest:load',
  manifestSave: 'manifest:save',

  historyLoad: 'history:load',
  historySave: 'history:save',

  uexGetShips: 'uex:getShips',
  uexGetLocations: 'uex:getLocations',
  uexGetCommodities: 'uex:getCommodities',

  watcherStatus: 'watcher:status',
  watcherRestart: 'watcher:restart',
  scanSession: 'watcher:scanSession',

  windowControl: 'window:control',
  setAlwaysOnTop: 'window:setAlwaysOnTop',
  windowIsMaximized: 'window:isMaximized',

  compactShow: 'compact:show',
  compactHide: 'compact:hide',
  compactResize: 'compact:resize',
  loadingStateSet: 'loading:set',

  ocrListDisplays: 'ocr:listDisplays',
  ocrEngineInfo: 'ocr:engineInfo',
  ocrPreview: 'ocr:preview',
  ocrRun: 'ocr:run',
  ocrSaveSample: 'ocr:saveSample',
  ocrRequestCapture: 'ocr:requestCapture',

  contractDataStatus: 'contractData:status',
  contractDataRescan: 'contractData:rescan',

  telemetryStatus: 'telemetry:status',

  updaterCheck: 'updater:check',
  updaterQuitAndInstall: 'updater:quitAndInstall',

  appVersion: 'app:version',

  // push events (main -> renderer)
  evtWatcherStatus: 'evt:watcher:status',
  evtContractAccepted: 'evt:contract:accepted',
  evtObjective: 'evt:objective',
  evtContractEnded: 'evt:contract:ended',
  evtUpdate: 'evt:update',
  evtOpenCapture: 'evt:openCapture',
  evtShips: 'evt:ships',
  evtLocations: 'evt:locations',
  evtCommodities: 'evt:commodities',
  evtWindowState: 'evt:window:state',
  evtOcrResult: 'evt:ocr:result',
  evtOcrStatus: 'evt:ocr:status',
  evtManifestChanged: 'evt:manifest:changed', // saved by another window
  evtCompactState: 'evt:compact:state',
  evtLoadingState: 'evt:loading:state' // main window's loading-mode step
} as const
