// Auto-update via electron-updater + GitHub Releases (spec section 11).
// Update checks run against latest.yml in the release assets. We publish the
// installer locally (see electron-builder.yml) so no GitHub Actions minutes
// are used.
//
// electron-updater's `autoUpdater` is a lazy getter that builds a platform
// updater on first access (which needs Electron's `app`). So we only touch it
// from initUpdater(), called inside app.whenReady().

import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import type { UpdateState } from '@shared/types'

let listenersAttached = false

function updater(): AppUpdater {
  return electronUpdater.autoUpdater
}

function send(win: BrowserWindow | null, state: UpdateState): void {
  if (win && !win.isDestroyed()) win.webContents.send('evt:update', state)
}

export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (listenersAttached) return
  listenersAttached = true

  const au = updater()
  au.autoDownload = true
  au.autoInstallOnAppQuit = true

  au.on('checking-for-update', () => send(getWindow(), { kind: 'checking' }))
  au.on('update-available', (info) =>
    send(getWindow(), { kind: 'available', version: info.version })
  )
  au.on('update-not-available', (info) =>
    send(getWindow(), { kind: 'none', version: info.version })
  )
  au.on('download-progress', (p) =>
    send(getWindow(), { kind: 'downloading', percent: Math.round(p.percent) })
  )
  au.on('update-downloaded', (info) =>
    send(getWindow(), { kind: 'downloaded', version: info.version })
  )
  au.on('error', (err) =>
    send(getWindow(), { kind: 'error', message: err == null ? 'unknown' : String(err.message || err) })
  )
}

export async function checkForUpdates(): Promise<void> {
  try {
    await updater().checkForUpdates()
  } catch (e) {
    console.error('[updater] check failed:', e)
  }
}

export function quitAndInstall(): void {
  updater().quitAndInstall()
}
