// auto-detect SC installs, windows only

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import type { DetectedInstalls } from '@shared/types'

const SCAN_MAX_DEPTH = 4

const SKIP_DIRS = new Set(
  [
    'Windows',
    'Windows.old',
    'WinSxS',
    '$Recycle.Bin',
    '$WinREAgent',
    '$SysReset',
    '$GetCurrent',
    'System Volume Information',
    'Config.Msi',
    'Recovery',
    'Boot',
    'ProgramData',
    'AppData',
    'PerfLogs',
    'OneDriveTemp',
    'node_modules',
    '.git',
    '.svn',
    '.hg'
  ].map((s) => s.toLowerCase())
)

const SC_ROOT_NAMES = new Set(['starcitizen', 'star citizen'])
const KNOWN_CHANNELS = new Set(['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW'])
const CHANNEL_ORDER = ['LIVE', 'PTU', 'EPTU', 'HOTFIX', 'TECH-PREVIEW']

function isChannelDir(p: string): boolean {
  const name = path.basename(p).toUpperCase()
  if (KNOWN_CHANNELS.has(name)) return true
  try {
    return fs.existsSync(path.join(p, 'build_manifest.id'))
  } catch {
    return false
  }
}

function looksLikeScRoot(p: string): boolean {
  try {
    for (const child of fs.readdirSync(p, { withFileTypes: true })) {
      if (child.isDirectory() && isChannelDir(path.join(p, child.name))) return true
    }
  } catch {
    /* ignore */
  }
  return false
}

function findScRoots(driveRoot: string): string[] {
  const roots: string[] = []
  const queue: Array<[string, number]> = [[driveRoot, 0]]
  while (queue.length) {
    const [current, depth] = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const nameLower = entry.name.toLowerCase()
      if (SKIP_DIRS.has(nameLower)) continue
      const full = path.join(current, entry.name)
      if (SC_ROOT_NAMES.has(nameLower) && looksLikeScRoot(full)) {
        roots.push(full)
        continue // don't descend into install
      }
      if (depth + 1 < SCAN_MAX_DEPTH) queue.push([full, depth + 1])
    }
  }
  return roots
}

function fixedDrives(): string[] {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object -ExpandProperty DeviceID"',
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    )
    const drives = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z]:$/.test(s))
      .map((s) => s.toUpperCase() + '\\')
    if (drives.length) return drives
  } catch {
    /* fall through to brute-force */
  }
  // fallback: probe a..z
  const drives: string[] = []
  for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const root = String.fromCharCode(c) + ':\\'
    try {
      if (fs.existsSync(root)) drives.push(root)
    } catch {
      /* ignore */
    }
  }
  return drives
}

/** channel -> Game.log path */
export function detectInstalls(): DetectedInstalls {
  if (process.platform !== 'win32') return {}
  const found: DetectedInstalls = {}
  for (const drive of fixedDrives()) {
    for (const scRoot of findScRoots(drive)) {
      let children: fs.Dirent[]
      try {
        children = fs.readdirSync(scRoot, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of children) {
        if (!child.isDirectory()) continue
        const channelDir = path.join(scRoot, child.name)
        if (!isChannelDir(channelDir)) continue
        const channel = child.name.toUpperCase()
        if (found[channel]) continue // first hit wins
        found[channel] = path.join(channelDir, 'Game.log')
      }
    }
  }
  return found
}

/** known channels first, rest alphabetical */
export function orderChannels(channels: string[]): string[] {
  const known = CHANNEL_ORDER.filter((c) => channels.includes(c))
  const rest = channels.filter((c) => !CHANNEL_ORDER.includes(c)).sort()
  return [...known, ...rest]
}

export function channelFromPath(logPath: string): string {
  const parent = path.basename(path.dirname(logPath))
  return parent ? parent.toUpperCase() : 'UNKNOWN'
}
