// one row per crew, leader writes, members watch

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import type { CrewSnapshot, CrewMember, CrewRole } from '@shared/types'
import { SUPABASE_URL, SUPABASE_KEY } from './telemetry'

const TABLE = 'crew_sessions'
// no lookalikes, for anyone retyping it
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'
const CODE_LEN = 8

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let code = ''
let rev = 0
let onSnapshot: ((s: CrewSnapshot) => void) | null = null
let onStatus: ((up: boolean, error?: string) => void) | null = null
let onMembers: ((m: CrewMember[]) => void) | null = null

function db(): SupabaseClient {
  // electron's node 20 has no global WebSocket
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket }
    })
  }
  return client
}

function newCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

// who's actually connected
function watchPresence(ch: RealtimeChannel): void {
  ch.on('presence', { event: 'sync' }, () => {
    const seen = ch.presenceState<{ name: string; role: CrewRole }>()
    const out: CrewMember[] = []
    for (const [id, entries] of Object.entries(seen)) {
      const e = entries[0]
      if (e) out.push({ id, name: e.name, role: e.role })
    }
    out.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'leader' ? -1 : 1))
    onMembers?.(out)
  })
}

async function announce(ch: RealtimeChannel, name: string, role: CrewRole): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    ch.subscribe((state) => {
      onStatus?.(state === 'SUBSCRIBED', state === 'SUBSCRIBED' ? undefined : String(state))
      if (state === 'SUBSCRIBED') void ch.track({ name: name || (role === 'leader' ? 'Leader' : 'Crew'), role })
      if (!settled && (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT')) {
        settled = true
        resolve()
      }
    })
  })
}

/** null = server unreachable */
export async function startCrew(
  name: string,
  handlers: { members: (m: CrewMember[]) => void; status: (up: boolean, error?: string) => void }
): Promise<string | null> {
  await leaveCrew()
  onMembers = handlers.members
  onStatus = handlers.status
  for (let tries = 0; tries < 5; tries++) {
    const candidate = newCode()
    const { error } = await db().from(TABLE).insert({ code: candidate, rev: 0, payload: null })
    if (!error) {
      code = candidate
      rev = 0
      channel = db().channel(`crew:${code}`, { config: { presence: { key: '' } } })
      watchPresence(channel)
      await announce(channel, name, 'leader')
      return code
    }
    // 23505 = code taken, reroll
    if (error.code !== '23505') return null
  }
  return null
}

export async function publish(snapshot: Omit<CrewSnapshot, 'rev'>): Promise<boolean> {
  if (!code) return false
  rev += 1
  const { error } = await db()
    .from(TABLE)
    .update({ rev, payload: { ...snapshot, rev }, updated_at: new Date().toISOString() })
    .eq('code', code)
  onStatus?.(!error, error?.message)
  return !error
}

export async function joinCrew(
  joining: string,
  name: string,
  handlers: {
    snapshot: (s: CrewSnapshot) => void
    status: (up: boolean, error?: string) => void
    members: (m: CrewMember[]) => void
  }
): Promise<{ ok: boolean; error?: string }> {
  await leaveCrew()
  code = joining.trim().toUpperCase()
  onSnapshot = handlers.snapshot
  onStatus = handlers.status
  onMembers = handlers.members

  // subscribe first or updates slip through the gap
  channel = db()
    .channel(`crew:${code}`, { config: { presence: { key: '' } } })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `code=eq.${code}` }, (msg) => {
      const next = (msg.new as { payload: CrewSnapshot | null }).payload
      // stale push, ignore
      if (next && next.rev > rev) {
        rev = next.rev
        onSnapshot?.(next)
      }
    })
  watchPresence(channel)
  await announce(channel, name, 'member')

  // catch up; rev check dedupes
  const { data, error } = await db().from(TABLE).select('payload').eq('code', code).maybeSingle()
  if (error || !data) {
    await leaveCrew()
    return { ok: false, error: error?.message ?? "That crew code doesn't exist" }
  }
  const seed = data.payload as CrewSnapshot | null
  if (seed && seed.rev > rev) {
    rev = seed.rev
    onSnapshot?.(seed)
  }
  return { ok: true }
}

export async function leaveCrew(): Promise<void> {
  if (channel) {
    await db().removeChannel(channel)
    channel = null
  }
  code = ''
  rev = 0
  onSnapshot = null
  onStatus = null
  onMembers = null
}

// kills the code for everyone
export async function endCrew(): Promise<void> {
  if (code) await db().from(TABLE).delete().eq('code', code)
  await leaveCrew()
}
