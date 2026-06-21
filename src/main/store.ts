// Small JSON storage for settings, manifest, and history, kept under userData.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import type { AppSettings, ManifestDoc, HistoryDoc } from '@shared/types'
import { DEFAULT_SHIP } from '@shared/ships'
import { newRunId } from '@shared/run'

const SETTINGS_FILE = 'settings.json'
const MANIFEST_FILE = 'manifest.json'
const HISTORY_FILE = 'history.json'

export const DEFAULT_SETTINGS: AppSettings = {
  gameLogPath: '',
  gameChannel: 'LIVE',
  activeShip: DEFAULT_SHIP,
  installedModules: {},
  uexApiKey: '',
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
  onboarded: false
}

function userDataPath(file: string): string {
  return path.join(app.getPath('userData'), file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(userDataPath(file), 'utf8')
    return { ...fallback, ...(JSON.parse(raw) as object) } as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(userDataPath(file), JSON.stringify(value, null, 2), 'utf8')
  } catch (e) {
    console.error(`[store] failed to write ${file}:`, e)
  }
}

export function loadSettings(): AppSettings {
  return readJson<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS)
}

export function saveSettings(settings: AppSettings): void {
  writeJson(SETTINGS_FILE, settings)
}

export function loadHistory(): HistoryDoc {
  return readJson<HistoryDoc>(HISTORY_FILE, { entries: [] })
}

export function saveHistory(doc: HistoryDoc): void {
  writeJson(HISTORY_FILE, doc)
}

export function loadManifest(): ManifestDoc {
  return readJson<ManifestDoc>(MANIFEST_FILE, {
    runId: newRunId(),
    contracts: [],
    order: []
  })
}

export function saveManifest(doc: ManifestDoc): void {
  writeJson(MANIFEST_FILE, doc)
}
