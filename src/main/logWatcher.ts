// tails Game.log, resets on rotation

import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { parseLine, type MarkerEntry } from './logParser'
import type {
  ContractAcceptedEvent,
  ObjectiveEvent,
  ContractEndedEvent,
  WatcherStatus
} from '@shared/types'

export const POLL_INTERVAL_MS = 200

export interface LogWatcherEvents {
  status: (s: WatcherStatus) => void
  accepted: (e: ContractAcceptedEvent, isHauling: boolean) => void
  objective: (e: ObjectiveEvent) => void
  ended: (e: ContractEndedEvent) => void
}

export class LogWatcher extends EventEmitter {
  private path: string
  private channel: string | null
  private timer: NodeJS.Timeout | null = null
  private fd: number | null = null
  private position = 0
  private lastSize = 0
  private lastIno: number | null = null
  private firstOpen = true
  private buffer = ''
  private markers = new Map<string, MarkerEntry>()
  private connected = false

  constructor(path: string, channel: string | null) {
    super()
    this.path = path
    this.channel = channel
  }

  start(): void {
    this.stop()
    this.tick()
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.closeFd()
    this.connected = false
  }

  status(): WatcherStatus {
    return {
      connected: this.connected,
      path: this.path || null,
      pollIntervalMs: POLL_INTERVAL_MS,
      channel: this.channel
    }
  }

  private closeFd(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd)
      } catch {
        /* ignore */
      }
      this.fd = null
    }
  }

  private emitStatus(error?: string): void {
    const s = this.status()
    if (error) s.error = error
    this.emit('status', s)
  }

  private setConnected(connected: boolean, error?: string): void {
    if (connected !== this.connected) {
      this.connected = connected
      this.emitStatus(error)
    } else if (error) {
      this.emitStatus(error)
    }
  }

  private tick(): void {
    let st: fs.Stats
    try {
      st = fs.statSync(this.path)
    } catch {
      if (this.fd !== null) {
        this.closeFd()
        this.markers.clear()
      }
      this.setConnected(false, 'Game.log not found')
      return
    }

    const rotated =
      this.fd === null ||
      (this.lastIno !== null && st.ino !== 0 && st.ino !== this.lastIno) ||
      st.size < this.lastSize

    if (rotated) {
      if (this.fd !== null) {
        // rotated mid-session, reset parser state
        this.closeFd()
        this.markers.clear()
      }
      try {
        this.fd = fs.openSync(this.path, 'r')
      } catch (e) {
        this.setConnected(false, `cannot open Game.log: ${(e as Error).message}`)
        return
      }
      this.lastIno = st.ino || null
      this.buffer = ''
      if (this.firstOpen) {
        // skip existing content
        this.position = st.size
        this.lastSize = st.size
        this.firstOpen = false
      } else {
        this.position = 0
        this.lastSize = 0
      }
    }

    if (st.size > this.position) {
      const length = st.size - this.position
      const chunk = Buffer.alloc(length)
      try {
        const read = fs.readSync(this.fd!, chunk, 0, length, this.position)
        this.position += read
        this.buffer += chunk.subarray(0, read).toString('utf8')
        this.drainBuffer()
      } catch (e) {
        this.setConnected(false, `read failed: ${(e as Error).message}`)
        return
      }
    }

    this.lastSize = st.size
    this.setConnected(true)
  }

  private drainBuffer(): void {
    const nl = this.buffer.lastIndexOf('\n')
    if (nl < 0) return
    const block = this.buffer.slice(0, nl + 1)
    this.buffer = this.buffer.slice(nl + 1)
    for (const raw of block.split(/\r?\n/)) {
      if (!raw) continue
      this.processLine(raw)
    }
  }

  private processLine(line: string): void {
    const parsed = parseLine(line, this.markers)
    if (!parsed) return
    switch (parsed.kind) {
      case 'accepted':
        this.emit('accepted', parsed.event, parsed.isHauling)
        break
      case 'objective':
        this.emit('objective', parsed.event)
        break
      case 'ended':
        this.emit('ended', parsed.event)
        break
    }
  }
}

export interface LogWatcher {
  on<K extends keyof LogWatcherEvents>(event: K, listener: LogWatcherEvents[K]): this
  emit<K extends keyof LogWatcherEvents>(
    event: K,
    ...args: Parameters<LogWatcherEvents[K]>
  ): boolean
}
