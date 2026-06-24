import React, { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import type { HistoryEntry, HistoryStatus } from '@shared/types'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'

const COLS = '116px minmax(0,1.7fr) minmax(0,1fr) 56px 70px 64px 104px 132px'

const STATUS_COLOR: Record<HistoryStatus, string> = {
  completed: C.green,
  abandoned: C.amber,
  failed: C.red
}

type Filter = 'all' | 'completed' | 'abandoned'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function HistoryPage(): React.ReactElement {
  const history = useStore((s) => s.history)
  const clearHistory = useStore((s) => s.clearHistory)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirmClear, setConfirmClear] = useState(false)

  const sorted = useMemo(
    () => [...history].sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1)),
    [history]
  )
  const shown = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((h) => h.status === filter)),
    [sorted, filter]
  )

  // shown is newest-first; map insertion order keeps runs sorted
  const groups = useMemo<RunGroupData[]>(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const e of shown) {
      const key = e.runId || '-'
      const arr = map.get(key)
      if (arr) arr.push(e)
      else map.set(key, [e])
    }
    return [...map.entries()].map(([runId, entries]) => {
      const done = entries.filter((e) => e.status === 'completed')
      return {
        runId,
        entries,
        completedCount: done.length,
        abandonedCount: entries.filter((e) => e.status === 'abandoned').length,
        failedCount: entries.filter((e) => e.status === 'failed').length,
        scu: done.reduce((a, e) => a + e.totalScu, 0),
        earnings: done.reduce((a, e) => a + (e.payout || 0), 0),
        latest: entries.reduce((m, e) => (e.endedAt > m ? e.endedAt : m), entries[0].endedAt)
      }
    })
  }, [shown])

  const completed = history.filter((h) => h.status === 'completed')
  const abandoned = history.filter((h) => h.status === 'abandoned')
  const scuHauled = completed.reduce((a, h) => a + h.totalScu, 0)
  const boxesHauled = completed.reduce((a, h) => a + h.totalBoxes, 0)
  const earnings = completed.reduce((a, h) => a + (h.payout || 0), 0)

  if (history.length === 0) {
    return (
      <div style={{ padding: PAGE_PADDING }}>
        <PageHeader title="HISTORY" subtitle="Completed & abandoned contracts · earnings" />
        <EmptyState />
      </div>
    )
  }

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="HISTORY"
        subtitle={`${completed.length} completed · ${abandoned.length} abandoned`}
        right={
          <Btn
            onClick={() => setConfirmClear(true)}
            style={{
              border: `1px solid rgba(255,255,255,0.18)`,
              background: 'transparent',
              color: C.dim,
              fontFamily: F.display,
              fontSize: 11,
              letterSpacing: '0.14em',
              padding: '7px 14px',
              cursor: 'pointer'
            }}
            hoverStyle={{ border: `1px solid ${C.red}`, color: C.red }}
          >
            CLEAR HISTORY
          </Btn>
        }
      />

      {confirmClear && (
        <ConfirmModal
          title="Clear history?"
          body="This permanently removes every finished contract and its earnings. It can't be undone."
          confirmLabel="CLEAR HISTORY"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            clearHistory()
            setConfirmClear(false)
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          borderTop: `1px solid ${C.lineStrong}`,
          borderBottom: `1px solid ${C.lineStrong}`,
          marginBottom: 22
        }}
      >
        <Stat label="SCU HAULED" value={fmt(scuHauled)} first />
        <Stat label="BOXES" value={fmt(boxesHauled)} />
        <Stat label="CONTRACTS" value={String(completed.length)} />
        <div style={{ flex: 1 }} />
        <div style={{ padding: '16px 0 16px 34px', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'right' }}>
          <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>EARNINGS</div>
          <div style={{ fontFamily: F.mono, fontSize: 30, fontWeight: 600, color: C.acc, textShadow: GLOW, lineHeight: 1.15 }}>
            {fmt(earnings)} <span style={{ fontSize: 15, color: C.dim }}>aUEC</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, marginBottom: 14, border: `1px solid ${C.line}`, width: 'fit-content' }}>
        {(['all', 'completed', 'abandoned'] as Filter[]).map((f) => (
          <FilterTab key={f} active={filter === f} onClick={() => setFilter(f)}>
            {f.toUpperCase()}
          </FilterTab>
        ))}
      </div>

      {groups.map((g, i) => (
        <RunGroup key={g.runId} group={g} defaultOpen={i === 0} />
      ))}
      {shown.length === 0 && (
        <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '22px 4px' }}>
          No {filter} contracts.
        </div>
      )}
    </div>
  )
}

interface RunGroupData {
  runId: string
  entries: HistoryEntry[]
  completedCount: number
  abandonedCount: number
  failedCount: number
  scu: number
  earnings: number
  latest: string
}

function RunGroup({ group, defaultOpen }: { group: RunGroupData; defaultOpen: boolean }): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const { runId, entries, completedCount, abandonedCount, failedCount, earnings, latest } = group

  return (
    <div style={{ marginBottom: 10, border: `1px solid ${C.line}` }}>
      <Btn
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          width: '100%',
          textAlign: 'left',
          border: 0,
          borderLeft: `3px solid ${C.acc}`,
          background: open ? C.accFill : 'transparent',
          padding: '12px 14px',
          cursor: 'pointer'
        }}
        hoverStyle={{ background: C.accFill }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.acc}
          strokeWidth="2.4"
          style={{ flex: 'none', transform: open ? 'rotate(90deg)' : 'none' }}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.dim, flex: 'none' }}>
          RUN
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 15, color: C.text, textShadow: GLOW, flex: 'none' }}>{runId}</span>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, flex: 'none' }}>{fmtDate(latest)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.08em', color: C.body, flex: 'none' }}>
          {completedCount} done
          {abandonedCount > 0 && <span style={{ color: C.amber }}> · {abandonedCount} aband.</span>}
          {failedCount > 0 && <span style={{ color: C.red }}> · {failedCount} failed</span>}
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 15, color: C.acc, textShadow: GLOW, flex: 'none', minWidth: 132, textAlign: 'right' }}>
          {fmt(earnings)} <span style={{ fontSize: 11, color: C.dim }}>aUEC</span>
        </span>
      </Btn>

      {open && (
        <div style={{ padding: '4px 14px 10px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 12,
              padding: '8px 4px 9px',
              borderBottom: `1px solid ${C.lineStrong}`
            }}
          >
            {['DATE', 'CONTRACT', 'PICKUP', 'STOPS', 'SCU', 'BOXES', 'STATUS', 'PAYOUT'].map((h, i) => (
              <span
                key={h}
                style={{
                  fontFamily: F.display,
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  color: C.faint,
                  textAlign: i >= 3 && i <= 5 ? 'right' : i === 7 ? 'right' : 'left'
                }}
              >
                {h}
              </span>
            ))}
          </div>
          {entries.map((h) => (
            <HistoryRow key={h.id} entry={h} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }): React.ReactElement {
  const color = STATUS_COLOR[entry.status]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 12,
        alignItems: 'center',
        padding: '12px 4px',
        borderBottom: `1px solid ${C.lineSoft}`
      }}
    >
      <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{fmtDate(entry.endedAt)}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: F.body, fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.title || `${entry.rank} ${entry.haulType}`.trim() || 'Contract'}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>{entry.ref}</div>
      </div>
      <span style={{ fontFamily: F.body, fontSize: 13, color: C.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.pickup || '-'}
      </span>
      <span
        style={{ fontFamily: F.mono, fontSize: 13, color: C.body, textAlign: 'right' }}
        title={entry.destinations.join('\n')}
      >
        {entry.destinations.length}
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body, textAlign: 'right' }}>{fmt(entry.totalScu)}</span>
      <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body, textAlign: 'right' }}>{fmt(entry.totalBoxes)}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: 'none' }} />
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.1em', color }}>
          {entry.status.toUpperCase()}
        </span>
        {entry.status === 'completed' && (entry.completionPct ?? 1) < 1 && (
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.amber }} title="Partial turn-in">
            {Math.round((entry.completionPct ?? 1) * 100)}%
          </span>
        )}
      </span>
      <RewardCell entry={entry} />
    </div>
  )
}

function RewardCell({ entry }: { entry: HistoryEntry }): React.ReactElement {
  const updateHistoryReward = useStore((s) => s.updateHistoryReward)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          updateHistoryReward(entry.id, parseInt(draft || '0', 10) || 0)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{
          width: '100%',
          background: 'transparent',
          border: `1px solid ${C.acc}`,
          color: C.text,
          fontFamily: F.mono,
          fontSize: 13,
          textAlign: 'right',
          padding: '4px 6px',
          outline: 'none'
        }}
      />
    )
  }
  const partial = (entry.completionPct ?? 1) < 1
  return (
    <Btn
      onClick={() => {
        setDraft(entry.reward ? String(entry.reward) : '')
        setEditing(true)
      }}
      title="Click to set the full contract reward"
      style={{
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: F.mono,
        fontSize: 13,
        textAlign: 'right',
        width: '100%',
        padding: '4px 6px',
        justifyContent: 'flex-end'
      }}
      hoverStyle={{ color: C.acc }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.25 }}>
        <span style={{ color: entry.payout ? C.text : C.faint }}>
          {entry.payout ? `${fmt(entry.payout)} aUEC` : entry.reward ? '0 aUEC' : 'set -'}
        </span>
        {partial && entry.reward > 0 && (
          <span style={{ fontSize: 10, color: C.faint }}>of {fmt(entry.reward)}</span>
        )}
      </span>
    </Btn>
  )
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  body: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement {
  return (
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(440px, 90vw)', background: '#05080a', border: `1px solid ${C.red}`, boxShadow: '0 18px 50px rgba(0,0,0,0.7)', padding: '22px 24px' }}
      >
        <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 600, letterSpacing: '0.06em', color: C.text, textShadow: GLOW, marginBottom: 10 }}>
          {title}
        </div>
        <p style={{ fontFamily: F.body, fontSize: 13, lineHeight: 1.6, color: C.dim, margin: '0 0 20px' }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Btn
            onClick={onCancel}
            style={{ border: `1px solid rgba(255,255,255,0.2)`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', padding: '8px 16px', cursor: 'pointer' }}
            hoverStyle={{ color: C.text, borderColor: C.body }}
          >
            CANCEL
          </Btn>
          <Btn
            onClick={onConfirm}
            style={{ border: `1px solid ${C.red}`, background: 'transparent', color: C.red, fontFamily: F.display, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', padding: '8px 16px', cursor: 'pointer' }}
            hoverStyle={{ background: C.red, color: '#000' }}
          >
            {confirmLabel}
          </Btn>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, first }: { label: string; value: string; first?: boolean }): React.ReactElement {
  return (
    <div style={{ flex: '0 0 auto', padding: first ? '16px 34px 16px 0' : '16px 34px', borderRight: `1px solid ${C.lineFaint}` }}>
      <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>{label}</div>
      <div style={{ fontFamily: F.mono, fontSize: 30, fontWeight: 600, color: C.text, textShadow: GLOW, lineHeight: 1.15 }}>
        {value}
      </div>
    </div>
  )
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: 0,
        background: active ? C.accFill : 'transparent',
        color: active ? C.text : C.dim,
        textShadow: active ? GLOW : 'none',
        fontFamily: F.display,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '8px 16px',
        cursor: 'pointer',
        borderBottom: `2px solid ${active ? C.acc : 'transparent'}`
      }}
      hoverStyle={active ? {} : { color: C.body }}
    >
      {children}
    </Btn>
  )
}

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        border: `1px dashed ${C.lineStrong}`,
        padding: '40px 20px',
        textAlign: 'center',
        fontFamily: F.body,
        fontSize: 13,
        color: C.dim,
        lineHeight: 1.7
      }}
    >
      No finished contracts yet.
      <br />
      Completed contracts (and any you abandon) land here automatically with their SCU, boxes, and stops. Add a payout to each to track earnings.
    </div>
  )
}
