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
// App icon (cargo-stack logo) for the window and Windows taskbar button. In a
// packaged build the .exe/installer icon comes from build/icon.ico; this sets
// the live window icon (and the dev taskbar icon).
import appIcon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let compactWindow: BrowserWindow | null = null
let watcher: LogWatcher | null = null
let settings: AppSettings = loadSettings()

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/** Pin the window above other apps and games. */
function applyAlwaysOnTop(value: boolean): void {
  if (!mainWindow) return
  // 'screen-saver' is the highest level, keeps the hologram above normal
  // windows (a fullscreen-exclusive game still covers any overlay; borderless
  // windowed is required for it to show over SC).
  mainWindow.setAlwaysOnTop(value, 'screen-saver')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    // Transparent so the inset around the rounded tablet bezel shows only the
    // accent glow (against the desktop), not an opaque black band that gets
    // clipped at the window edge. The app content itself paints solid black.
    transparent: true,
    backgroundColor: '#00000000',
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

  // Keep the renderer's maximize/restore button icon in sync with real state.
  const sendMaxState = (): void => send(IPC.evtWindowState, { maximized: !!mainWindow?.isMaximized() })
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  // The compact overlay is a child window, tear it down with the main window so
  // closing the app actually quits (window-all-closed won't fire otherwise).
  mainWindow.on('closed', () => {
    if (compactWindow && !compactWindow.isDestroyed()) compactWindow.destroy()
    compactWindow = null
    mainWindow = null
  })

  // Enforce a strict CSP for the packaged app (file:// content only). In dev we
  // leave it off so Vite's HMR client / React Fast Refresh preamble can run.
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

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// Compact overlay window: a small always-on-top card pinned to the top-right of
// the screen, over where SC shows tracked-contract info. Separate window so it
// floats over the game; it shares the manifest with the main window via the
// evt:manifest:changed broadcast.
// ---------------------------------------------------------------------------

const COMPACT_W = 332
const COMPACT_H = 432

function positionCompact(): void {
  if (!compactWindow) return
  // Full display bounds (not workArea): the game's tracker sits at the true
  // top-right corner of the screen, over the taskbar region when fullscreen.
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
  compactWindow.on('closed', () => {
    compactWindow = null
    broadcast(IPC.evtCompactState, { open: false })
  })
  // Same renderer, routed to the compact card via the URL hash.
  if (process.env['ELECTRON_RENDERER_URL']) {
    compactWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#compact`)
  } else {
    compactWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'compact' })
  }
}

function showCompact(): void {
  if (!compactWindow || compactWindow.isDestroyed()) createCompactWindow()
  positionCompact()
  compactWindow?.showInactive() // don't steal focus from the game
  compactWindow?.setAlwaysOnTop(true, 'screen-saver')
  broadcast(IPC.evtCompactState, { open: true })
}

function hideCompact(): void {
  if (compactWindow && !compactWindow.isDestroyed()) compactWindow.hide()
  broadcast(IPC.evtCompactState, { open: false })
}

// ---------------------------------------------------------------------------
// Log watcher lifecycle
// ---------------------------------------------------------------------------

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/** Send to every live window, optionally skipping the webContents that triggered it. */
function broadcast(channel: string, payload: unknown, exceptId?: number): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue
    if (exceptId !== undefined && w.webContents.id === exceptId) continue
    w.webContents.send(channel, payload)
  }
}

/** Push the latest cached ship + location + commodity rosters to the renderer. */
function pushRosters(): void {
  const ships = loadCachedRoster()
  if (ships) send(IPC.evtShips, ships)
  const locations = loadCachedLocations()
  if (locations) send(IPC.evtLocations, locations)
  const commodities = loadCachedCommodities()
  if (commodities) send(IPC.evtCommodities, commodities)
}

// ---------------------------------------------------------------------------
// OCR triggers (global hotkey + auto-capture after a contract accept)
// ---------------------------------------------------------------------------

let ocrBusy = false

/** Run `fn` with the always-on-top compact overlay hidden for a moment, so it
 *  never lands in the screenshot and blocks the contract panel. We hide the
 *  window directly (not via hideCompact) so the user's open-state and the
 *  renderer's evtCompactState stay untouched, this is only visual. A short
 *  delay lets the compositor drop the frame before the capture reads the screen. */
async function withCompactHidden<T>(fn: () => Promise<T>): Promise<T> {
  const wasVisible =
    !!compactWindow && !compactWindow.isDestroyed() && compactWindow.isVisible()
  if (!wasVisible) return fn()
  compactWindow!.hide()
  await new Promise((r) => setTimeout(r, 150))
  try {
    return await fn()
  } finally {
    if (compactWindow && !compactWindow.isDestroyed()) {
      compactWindow.showInactive() // restore without stealing focus from the game
      compactWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}

/** Run a full OCR pass and push the result to the renderer's confirm modal.
 *  `targetMissionId` (set for auto-capture after a log accept) is threaded back so
 *  the renderer merges the read into that contract instead of adding a duplicate. */
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

/** Fire an auto-capture after the configured delay so the mobiGlas contract
 *  panel has rendered on-screen before we read it. */
function scheduleAutoCapture(targetMissionId?: string): void {
  if (!settings.ocrAutoCapture) return
  const delayMs = Math.max(0, settings.ocrCaptureDelay) * 1000
  setTimeout(() => void runOcrAndPush(targetMissionId), delayMs)
}

/** (Re)bind the global capture hotkey from settings. */
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
    // Only hauling contracts feed the manifest (box math / destinations are
    // hauling concepts). Non-hauling accepts are ignored here.
    if (isHauling) send(IPC.evtContractAccepted, contractData.enrichAccepted(e))

    // Auto-capture the contract screen a moment after acceptance so the mobiGlas
    // panel is on-screen. Opt-in (off by default).
    //
    // HAULING captures are driven by the RENDERER (ocr:requestCapture), not here:
    // the renderer owns the contract list, so it only requests a capture for a
    // genuinely-new contract and skips relog re-emits / contracts we already
    // have. That avoids the capture spam on every relog.
    //
    // Non-hauling accepts never reach the manifest; their only use is OCR
    // training data, so we still auto-pop those from here when the user is
    // actively collecting samples.
    if (!isHauling && (settings.ocrSaveSamples || settings.contributeTrainingData)) {
      scheduleAutoCapture(undefined)
    }
  })
  watcher.on('objective', (e) => send(IPC.evtObjective, e))
  watcher.on('ended', (e) => send(IPC.evtContractEnded, e))
  watcher.start()
}

/** If no log path is configured, try to auto-detect one on startup. */
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

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settings)

  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AppSettings>) => {
    const prev = settings
    settings = { ...settings, ...patch }
    saveSettings(settings)

    if (patch.alwaysOnTop !== undefined && mainWindow) {
      applyAlwaysOnTop(!!patch.alwaysOnTop)
    }
    // Restart the watcher if the log source changed.
    if (
      patch.gameLogPath !== undefined &&
      patch.gameLogPath !== prev.gameLogPath
    ) {
      startWatcher()
    }
    // Re-bind the capture hotkey if it changed.
    if (patch.ocrHotkey !== undefined && patch.ocrHotkey !== prev.ocrHotkey) {
      registerHotkey()
    }
    // Re-index StarStrings contract data if the log location or override changed.
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
    // Keep the other window (main <-> compact) in sync without a save loop.
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

  // --- OCR (Phase 2) ---
  ipcMain.handle(IPC.ocrListDisplays, () => listDisplays())
  ipcMain.handle(IPC.ocrEngineInfo, () => engineInfo(settings))
  ipcMain.handle(IPC.ocrPreview, () => capturePreview(settings))
  ipcMain.handle(IPC.ocrRun, () => runOcr(settings))
  // Renderer-driven auto-capture for a just-accepted, genuinely-new hauling
  // contract (it already filtered out relog re-emits / known contracts).
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

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

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
    prunePending() // clear stale unconfirmed crops from prior sessions

    // Anonymous, stable id for grouping this client's opt-in uploads.
    if (!settings.telemetryClientId) {
      settings = { ...settings, telemetryClientId: randomUUID() }
      saveSettings(settings)
    }
    telemetry.init() // load + flush the upload queue (no-op unless samples are queued)
    try {
      const data = contractData.rebuild(settings) // optional StarStrings layer
      if (data.active) console.log(`[contractData] ${data.titles} contracts, ${data.blueprintContracts} with blueprints`)
    } catch (e) {
      console.warn('[contractData] index build failed:', e)
    }

    // Ships, freight locations and commodities ship bundled with the app. Seed the
    // cache so matching works at once, then pull any list whose hash changed from
    // the repo in the background. No account or token involved.
    seedCacheIfNeeded()
    pushRosters()
    void refreshFromRepo().then((changed) => {
      if (changed) pushRosters()
    })

    initUpdater(() => mainWindow)
    if (app.isPackaged) {
      // Check shortly after launch (once the window's update listener is up), then
      // re-check quietly every hour so a long-running session still notices a
      // release instead of only catching it on the next launch. autoDownload pulls
      // it in the background and it installs on the next normal quit
      // (autoInstallOnAppQuit), so nothing ever restarts while someone is using it.
      // Each check honours the live autoCheckUpdates toggle, so turning it off in
      // Settings stops further checks without a restart.
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
