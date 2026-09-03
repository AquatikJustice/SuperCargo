// crew mode transport: the leader upserts one row, members subscribe to it and render read-only

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type { CrewSnapshot } from '@shared/types'
import { SUPABASE_URL, SUPABASE_KEY } from './telemetry'

const TABLE = 'crew_sessions'
// no vowels, no 0/O/1/I: it gets read out over voice
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'
const CODE_LEN = 6

let client: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let code = ''
let rev = 0
let onSnapshot: ((s: CrewSnapshot) => void) | null = null
let onStatus: ((up: boolean, error?: string) => void) | null = null

function db(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  return client
}

function newCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

export function crewCode(): string {
  return code
}

/** a free code, or null if we couldn't reach the server at all */
export async function startCrew(): Promise<string | null> {
  await leaveCrew()
  for (let tries = 0; tries < 5; tries++) {
    const candidate = newCode()
    const { error } = await db().from(TABLE).insert({ code: candidate, rev: 0, payload: null })
    if (!error) {
      code = candidate
      rev = 0
      return code
    }
    // 23505 = someone already holds that code, roll again
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
  handlers: { snapshot: (s: CrewSnapshot) => void; status: (up: boolean, error?: string) => void }
): Promise<{ ok: boolean; error?: string }> {
  await leaveCrew()
  code = joining.trim().toUpperCase()
  onSnapshot = handlers.snapshot
  onStatus = handlers.status

  const { data, error } = await db().from(TABLE).select('payload').eq('code', code).maybeSingle()
  if (error) {
    code = ''
    return { ok: false, error: error.message }
  }
  if (!data) {
    code = ''
    return { ok: false, error: "That crew code doesn't exist" }
  }

  channel = db()
    .channel(`crew:${code}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `code=eq.${code}` }, (msg) => {
      const next = (msg.new as { payload: CrewSnapshot | null }).payload
      // out-of-order delivery would rewind the crew's view
      if (next && next.rev > rev) {
        rev = next.rev
        onSnapshot?.(next)
      }
    })
    .subscribe((s) => onStatus?.(s === 'SUBSCRIBED', s === 'SUBSCRIBED' ? undefined : String(s)))

  // whatever the leader had before we walked in
  const seed = data.payload as CrewSnapshot | null
  if (seed) {
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
}

/** leader closing up: drop the row so the code stops resolving */
export async function endCrew(): Promise<void> {
  if (code) await db().from(TABLE).delete().eq('code', code)
  await leaveCrew()
}
