import { app, BrowserWindow, ipcMain, dialog, shell, session, globalShortcut, screen } from 'electron'
import * as path from 'node:path'
import { IPC } from '@shared/channels'
import type { AppSettings, ManifestDoc, HistoryDoc } from '@shared/types'
import { loadSettings, saveSettings, loadManifest, saveManifest, loadHistory, saveHistory } from './store'
import { detectInstalls, orderChannels, channelFromPath } from './installDetect'
import { LogWatcher } from './logWatcher'
import { initUpdater, checkForUpdates, quitAndInstall } from './updater'
import { loadCachedRoster, loadCachedLocations, loadCachedCommodities } from './uex'
import { seedCacheIfNeeded, refreshFromRepo } from './dataSync'
import { scanActiveContracts } from './scanLog'
import { randomUUID } from 'node:crypto'
import { listDisplays } from './capture'
import { engineInfo, capturePreview, runOcr, saveSample } from './ocr'
import { prunePending } from './ocr/samples'
import * as contractData from './contractData'
import * as telemetry from './telemetry'
// live window icon; packaged exe icon comes from build/icon.ico
import appIcon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let compactWindow: BrowserWindow | null = null
let watcher: LogWatcher | null = null
let settings: AppSettings = loadSettings()

function isExternalUrl(url: string): boolean {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && url.startsWith(dev)) return false
  return /^https?:\/\//i.test(url)
}

function applyAlwaysOnTop(value: boolean): void {
  if (!mainWindow) return
  // screen-saver is the highest level
  mainWindow.setAlwaysOnTop(value, 'screen-saver')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 520,
    minHeight: 560,
    show: false,
    frame: false,
    // opaque keeps frameless resize smooth on windows
    backgroundColor: '#000000',
    icon: appIcon,
    alwaysOnTop: settings.alwaysOnTop,
    title: 'SuperCargo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    if (settings.alwaysOnTop) applyAlwaysOnTop(true)
  })

  const sendMaxState = (): void => send(IPC.evtWindowState, { maximized: !!mainWindow?.isMaximized() })
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  // tear down overlay too, else window-all-closed never fires
  mainWindow.on('closed', () => {
    if (compactWindow && !compactWindow.isDestroyed()) compactWindow.destroy()
    compactWindow = null
    mainWindow = null
  })

  // off in dev so vite HMR can run
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, done) => {
      done({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'"
          ]
        }
      })
    })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // catch <a href> nav that would otherwise replace the app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const COMPACT_W = 332
const COMPACT_H = 432

function positionCompact(): void {
  if (!compactWindow) return
  // bounds not workArea so it can sit over the taskbar region
  const { bounds } = screen.getPrimaryDisplay()
  const margin = 10
  compactWindow.setBounds({
    x: bounds.x + bounds.width - COMPACT_W - margin,
    y: bounds.y + margin,
    width: COMPACT_W,
    height: COMPACT_H
  })
}

function createCompactWindow(): void {
  compactWindow = new BrowserWindow({
    width: COMPACT_W,
    height: COMPACT_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    title: 'SuperCargo - Next Stop',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  compactWindow.setAlwaysOnTop(true, 'screen-saver')
  compactWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  compactWindow.webContents.on('will-navigate', (e, url) => {
    if (isExternalUrl(url)) {
      e.preventDefault()
      void shell.openExternal(url)
    }
  })
  compactWindow.on('closed', () => {
    compactWindow = null
    broadcast(IPC.evtCompactState, { open: false })
  })
  // same renderer, routed to the compact card via url hash
  if (process.env['ELECTRON_RENDERER_URL']) {
    compactWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#compact`)
  } else {
    compactWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'compact' })
  }
}

function showCompact(): void {
  if (!compactWindow || compactWindow.isDestroyed()) createCompactWindow()
  positionCompact()
  compactWindow?.showInactive() // don't steal focus
  compactWindow?.setAlwaysOnTop(true, 'screen-saver')
  broadcast(IPC.evtCompactState, { open: true })
}

function hideCompact(): void {
  if (compactWindow && !compactWindow.isDestroyed()) compactWindow.hide()
  broadcast(IPC.evtCompactState, { open: false })
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function broadcast(channel: string, payload: unknown, exceptId?: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    if (exceptId !== undefined && w.webContents.id === exceptId) continue
    w.webContents.send(channel, payload)
  }
}

function pushRosters(): void {
  const ships = loadCachedRoster()
  if (ships) send(IPC.evtShips, ships)
  const locations = loadCachedLocations()
  if (locations) send(IPC.evtLocations, locations)
  const commodities = loadCachedCommodities()
  if (commodities) send(IPC.evtCommodities, commodities)
}

let ocrBusy = false

// hide overlay so it stays out of the screenshot
async function withCompactHidden<T>(fn: () => Promise<T>): Promise<T> {
  const wasVisible =
    !!compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()
  if (!wasVisible) return fn()
  compactWindow!.hide()
  await new Promise((r) => setTimeout(r, 150)) // let compositor drop the frame first
  try {
    return await fn()
  } finally {
    if (compactWindow && !compactWindow.isDestroyed()) {
      compactWindow.showInactive() // restore without stealing focus
      compactWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}

// targetMissionId threaded back so renderer merges instead of dup'ing
async function runOcrAndPush(targetMissionId?: string): Promise<void> {
  if (ocrBusy) return
  ocrBusy = true
  send(IPC.evtOcrStatus, 'recognizing')
  try {
    const result = await withCompactHidden(() => runOcr(settings))
    send(IPC.evtOcrResult, { ...result, targetMissionId })
  } catch (e) {
    send(IPC.evtOcrResult, {
      ok: false,
      engine: settings.ocrEngine || 'tesseract',
      ms: 0,
      confidence: 0,
      rawText: '',
      objectives: [],
      error: e instanceof Error ? e.message : String(e),
      targetMissionId
    })
  } finally {
    ocrBusy = false
    send(IPC.evtOcrStatus, 'idle')
  }
}

// delay lets the contract panel render before capture
function scheduleAutoCapture(targetMissionId?: string): void {
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, settings.ocrCaptureDelay) * 1000
  setTimeout(() => void runOcrAndPush(targetMissionId), delayMs)
}

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const hotkey = settings.ocrHotkey
  if (!hotkey) return
  try {
    const ok = globalShortcut.register(hotkey, () => void runOcrAndPush())
    if (!ok) console.warn('[ocr] failed to register hotkey:', hotkey)
  } catch (e) {
    console.warn('[ocr] invalid hotkey:', hotkey, e)
  }
}

function startWatcher(): void {
  if (watcher) {
    watcher.stop()
    watcher = null
  }
  const logPath = settings.gameLogPath
  if (!logPath) {
    send(IPC.evtWatcherStatus, {
      connected: false,
      path: null,
      pollIntervalMs: 200,
      channel: settings.gameChannel,
      error: 'No Game.log path configured'
    })
    return
  }

  const channel = channelFromPath(logPath)
  watcher = new LogWatcher(logPath, channel)
  watcher.on('status', (s) => send(IPC.evtWatcherStatus, s))
  watcher.on('accepted', (e, isHauling) => {
    if (isHauling) send(IPC.evtContractAccepted, contractData.enrichAccepted(e))

    // hauling captures fire from the renderer instead, which dedups relog re-emits.
    // non-hauling only matters as training data, so auto-pop those here.
    if (!isHauling && (settings.ocrSaveSamples || settings.contributeTrainingData)) {
      scheduleAutoCapture(undefined)
    }
  })
  watcher.on('objective', (e) => send(IPC.evtObjective, e))
  watcher.on('ended', (e) => send(IPC.evtContractEnded, e))
  watcher.start()
}

function autoDetectLogPath(): void {
  if (settings.gameLogPath) return
  const installs = detectInstalls()
  const channels = orderChannels(Object.keys(installs))
  if (channels.length === 0) return
  const preferred =
    channels.find((c) => c === settings.gameChannel) ?? channels[0]
  settings = { ...settings, gameLogPath: installs[preferred], gameChannel: preferred }
  saveSettings(settings)
}

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settings)

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    const prev = settings
    settings = { ...settings, ...patch }
    saveSettings(settings)

    if (patch.alwaysOnTop !== undefined && mainWindow) {
      applyAlwaysOnTop(!!patch.alwaysOnTop)
    }
    if (
      patch.gameLogPath !== undefined &&
      patch.gameLogPath !== prev.gameLogPath
    ) {
      startWatcher()
    }
    if (patch.ocrHotkey !== undefined && patch.ocrHotkey !== prev.ocrHotkey) {
      registerHotkey()
    }
    if (
      (patch.gameLogPath !== undefined && patch.gameLogPath !== prev.gameLogPath) ||
      (patch.contractsDataPath !== undefined && patch.contractsDataPath !== prev.contractsDataPath)
    ) {
      contractData.rebuild(settings)
    }
    return settings
  })

  ipcMain.handle(IPC.detectInstalls, () => {
    const installs = detectInstalls()
    return { installs, ordered: orderChannels(Object.keys(installs)) }
  })

  ipcMain.handle(IPC.pickLogFile, async () => {
    if (!mainWindow) return null
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Game.log',
      properties: ['openFile'],
      filters: [{ name: 'Game log', extensions: ['log'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    return picked.filePaths[0]
  })

  ipcMain.handle(IPC.manifestLoad, () => loadManifest())
  ipcMain.handle(IPC.manifestSave, (e, doc: ManifestDoc) => {
    saveManifest(doc)
    // sync the other window without looping the save back
    broadcast(IPC.evtManifestChanged, doc, e.sender.id)
    return true
  })

  ipcMain.handle(IPC.compactShow, () => showCompact())
  ipcMain.handle(IPC.compactHide, () => hideCompact())

  ipcMain.handle(IPC.historyLoad, () => loadHistory())
  ipcMain.handle(IPC.historySave, (_e, doc: HistoryDoc) => {
    saveHistory(doc)
    return true
  })

  ipcMain.handle(IPC.uexGetShips, () => loadCachedRoster())
  ipcMain.handle(IPC.uexGetLocations, () => loadCachedLocations())
  ipcMain.handle(IPC.uexGetCommodities, () => loadCachedCommodities())

  ipcMain.handle(IPC.scanSession, () => {
    if (!settings.gameLogPath) return []
    return scanActiveContracts(settings.gameLogPath).map((c) => ({
      ...c,
      accepted: contractData.enrichAccepted(c.accepted)
    }))
  })

  ipcMain.handle(IPC.contractDataStatus, () => contractData.status())
  ipcMain.handle(IPC.contractDataRescan, () => contractData.rebuild(settings))

  ipcMain.handle(IPC.telemetryStatus, () => telemetry.status())

  ipcMain.handle(IPC.watcherStatus, () =>
    watcher ? watcher.status() : {
      connected: false,
      path: settings.gameLogPath || null,
      pollIntervalMs: 200,
      channel: settings.gameChannel,
      error: settings.gameLogPath ? undefined : 'No Game.log path configured'
    }
  )
  ipcMain.handle(IPC.watcherRestart, () => {
    startWatcher()
    return true
  })

  ipcMain.handle(IPC.windowControl, (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'maximize')
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    else if (action === 'close') mainWindow.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, () => !!mainWindow?.isMaximized())

  ipcMain.handle(IPC.setAlwaysOnTop, (_e, value: boolean) => {
    settings = { ...settings, alwaysOnTop: value }
    saveSettings(settings)
    applyAlwaysOnTop(value)
    return value
  })

  ipcMain.handle(IPC.ocrListDisplays, () => listDisplays())
  ipcMain.handle(IPC.ocrEngineInfo, () => engineInfo(settings))
  ipcMain.handle(IPC.ocrPreview, () => capturePreview(settings))
  ipcMain.handle(IPC.ocrRun, () => runOcr(settings))
  // renderer requests this only for genuinely-new hauling contracts
  ipcMain.on(IPC.ocrRequestCapture, (_e, missionId: unknown) => {
    scheduleAutoCapture(typeof missionId === 'string' ? missionId : undefined)
  })
  ipcMain.handle(
    IPC.ocrSaveSample,
    (_e, payload: { sampleId: string; text: string; fields?: Record<string, unknown> }) =>
      saveSample(settings, payload.sampleId, { text: payload.text, fields: payload.fields })
  )

  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  ipcMain.handle(IPC.updaterCheck, async () => {
    await checkForUpdates()
    return true
  })
  ipcMain.handle(IPC.updaterQuitAndInstall, () => {
    quitAndInstall()
    return true
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    autoDetectLogPath()
    createWindow()
    startWatcher()
    registerHotkey()
    prunePending() // drop stale crops from prior sessions

    // stable id to group this client's opt-in uploads
    if (!settings.telemetryClientId) {
      settings = { ...settings, telemetryClientId: randomUUID() }
      saveSettings(settings)
    }
    telemetry.init()
    try {
      const data = contractData.rebuild(settings)
      if (data.active) console.log(`[contractData] ${data.titles} contracts, ${data.blueprintContracts} with blueprints`)
    } catch (e) {
      console.warn('[contractData] index build failed:', e)
    }

    // seed bundled data first, then refresh changed lists in the background
    seedCacheIfNeeded()
    pushRosters()
    void refreshFromRepo().then((changed) => {
      if (changed) pushRosters()
    })

    initUpdater(() => mainWindow)
    if (app.isPackaged) {
      // recheck hourly so long sessions notice releases
      const RECHECK_MS = 1000 * 60 * 60
      if (settings.autoCheckUpdates) setTimeout(() => void checkForUpdates(), 4000)
      setInterval(() => {
        if (settings.autoCheckUpdates) void checkForUpdates()
      }, RECHECK_MS)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    watcher?.stop()
    if (process.platform !== 'darwin') app.quit()
  })
}
