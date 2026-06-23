// IPC channel names shared between main and preload.

export const IPC = {
  // settings
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  detectInstalls: 'installs:detect',
  pickLogFile: 'dialog:pickLogFile',

  // manifest persistence
  manifestLoad: 'manifest:load',
  manifestSave: 'manifest:save',

  // history persistence
  historyLoad: 'history:load',
  historySave: 'history:save',

  // bundled roster cache (ships / freight locations / commodities)
  uexGetShips: 'uex:getShips',
  uexGetLocations: 'uex:getLocations',
  uexGetCommodities: 'uex:getCommodities',

  // watcher
  watcherStatus: 'watcher:status',
  watcherRestart: 'watcher:restart',
  scanSession: 'watcher:scanSession',

  // window
  windowControl: 'window:control', // minimize | maximize | close
  setAlwaysOnTop: 'window:setAlwaysOnTop',
  windowIsMaximized: 'window:isMaximized',

  // compact overlay window (separate always-on-top window over the game corner)
  compactShow: 'compact:show',
  compactHide: 'compact:hide',

  // OCR (Phase 2)
  ocrListDisplays: 'ocr:listDisplays',
  ocrEngineInfo: 'ocr:engineInfo',
  ocrPreview: 'ocr:preview', // capture a full-display screenshot for calibration
  ocrRun: 'ocr:run', // capture + crop + recognize + parse + match
  ocrSaveSample: 'ocr:saveSample',
  ocrRequestCapture: 'ocr:requestCapture', // renderer asks for an auto-capture (new contract only)

  // Contract data (StarStrings)
  contractDataStatus: 'contractData:status',
  contractDataRescan: 'contractData:rescan',

  // Training-data contribution (telemetry)
  telemetryStatus: 'telemetry:status',

  // updater
  updaterCheck: 'updater:check',
  updaterQuitAndInstall: 'updater:quitAndInstall',

  // app
  appVersion: 'app:version',

  // --- push events (main -> renderer) ---
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
  evtOcrResult: 'evt:ocr:result', // a hotkey/auto-trigger pass finished
  evtOcrStatus: 'evt:ocr:status', // 'capturing' | 'recognizing' | 'idle'
  evtManifestChanged: 'evt:manifest:changed', // manifest saved by another window
  evtCompactState: 'evt:compact:state' // { open } - compact window shown/hidden
} as const
