import React, { useState } from 'react'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'

export interface TurnInItem {
  objectiveId: string
  contractId: string
  breakdown: string
  commodity: string
  ref: string
  totalScu: number
  /** undefined = not turned in */
  turnedInScu?: number
}

export interface TurnInEntry {
  contractId: string
  objectiveId: string
  deliveredScu: number
}

type Mode = 'full' | 'part' | 'none'

export default function TurnInModal({
  eyebrow = 'TURN IN',
  heading,
  sub,
  items,
  onSave,
  onUnmark,
  onSkip,
  onClose
}: {
  eyebrow?: string
  heading: string
  sub?: string
  items: TurnInItem[]
  onSave: (entries: TurnInEntry[]) => void
  onUnmark: (objectiveIds: string[]) => void
  /** loading mode: skip without recording */
  onSkip?: () => void
  onClose: () => void
}): React.ReactElement {
  const seed = (i: TurnInItem): { mode: Mode; amount: number } => {
    const r = i.turnedInScu
    if (r === undefined) return { mode: 'full', amount: i.totalScu }
    return { mode: r >= i.totalScu ? 'full' : r <= 0 ? 'none' : 'part', amount: r }
  }
  const [rows, setRows] = useState<Record<string, { mode: Mode; amount: number }>>(() =>
    Object.fromEntries(items.map((i) => [i.objectiveId, seed(i)]))
  )
  const setMode = (i: TurnInItem, mode: Mode): void =>
    setRows((r) => {
      const cur = r[i.objectiveId]?.amount ?? i.totalScu
      const amount =
        mode === 'full' ? i.totalScu : mode === 'none' ? 0 : cur > 0 && cur < i.totalScu ? cur : Math.max(1, Math.round(i.totalScu / 2))
      return { ...r, [i.objectiveId]: { mode, amount } }
    })
  const setAmount = (i: TurnInItem, amount: number): void =>
    setRows((r) => ({ ...r, [i.objectiveId]: { mode: 'part', amount: Math.max(0, Math.min(i.totalScu, amount)) } }))

  const turnedInIds = items.filter((i) => i.turnedInScu !== undefined).map((i) => i.objectiveId)

  const save = (): void =>
    onSave(
      items.map((i) => {
        const st = rows[i.objectiveId] ?? seed(i)
        const deliveredScu =
          st.mode === 'full' ? i.totalScu : st.mode === 'none' ? 0 : Math.max(0, Math.min(i.totalScu, Math.round(st.amount || 0)))
        return { contractId: i.contractId, objectiveId: i.objectiveId, deliveredScu }
      })
    )

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', maxHeight: '100%', overflowY: 'auto', border: `1px solid ${C.green}`, borderRadius: 8, background: '#0a0d10', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
      >
        <div style={{ padding: '14px 18px 8px', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.green }}>{eyebrow}</div>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>{heading}</div>
          {sub && <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 18px' }}>
          {items.map((i) => {
            const row = rows[i.objectiveId] ?? { mode: 'full' as Mode, amount: i.totalScu }
            return (
              <div key={i.objectiveId}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text }}>{i.breakdown}</span>
                  <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>{i.commodity}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ghost }}>[{i.ref}]</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <Seg label="FULL" color={C.green} active={row.mode === 'full'} onClick={() => setMode(i, 'full')} />
                  <Seg label="PARTIAL" color={C.amber} active={row.mode === 'part'} onClick={() => setMode(i, 'part')} />
                  <Seg label="NONE" color={C.red} active={row.mode === 'none'} onClick={() => setMode(i, 'none')} />
                  {row.mode === 'part' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                      <input
                        value={row.amount || ''}
                        onChange={(e) => setAmount(i, parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10) || 0)}
                        inputMode="numeric"
                        style={{ width: 56, background: 'transparent', border: 0, borderBottom: `1px solid rgba(255,255,255,0.25)`, color: C.text, fontFamily: F.mono, fontSize: 14, textAlign: 'right', padding: '2px 0', outline: 'none' }}
                      />
                      <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>/ {i.totalScu} SCU</span>
                    </span>
                  ) : (
                    <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>
                      {row.mode === 'full' ? i.totalScu : 0} / {i.totalScu} SCU
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 18px 16px', borderTop: `1px solid ${C.lineSoft}` }}>
          {turnedInIds.length > 0 && (
            <Btn
              onClick={() => onUnmark(turnedInIds)}
              title="Clear this turn-in; the cargo reads as still aboard"
              style={{ border: `1px solid ${C.red}`, background: 'transparent', color: C.red, fontFamily: F.display, fontSize: 12, letterSpacing: '0.1em', padding: '9px 14px', cursor: 'pointer' }}
              hoverStyle={{ background: 'rgba(229,90,90,0.12)' }}
            >
              ↩ UNMARK
            </Btn>
          )}
          <Btn
            onClick={onClose}
            style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 12, letterSpacing: '0.1em', padding: '9px 14px', cursor: 'pointer' }}
            hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
          >
            CANCEL
          </Btn>
          {onSkip && (
            <Btn
              onClick={onSkip}
              title="Move on without marking this delivery"
              style={{ border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 12, letterSpacing: '0.1em', padding: '9px 14px', cursor: 'pointer' }}
              hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
            >
              SKIP ›
            </Btn>
          )}
          <Btn
            onClick={save}
            style={{ flex: 1, border: `1px solid ${C.green}`, background: 'rgba(95,208,137,0.16)', color: C.text, textShadow: GLOW, fontFamily: F.display, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', padding: 11, cursor: 'pointer' }}
            hoverStyle={{ background: 'rgba(95,208,137,0.26)' }}
          >
            {turnedInIds.length > 0 ? 'UPDATE' : 'TURN IN'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

function Seg({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{ border: `1px solid ${active ? color : C.lineSoft}`, background: active ? 'rgba(255,255,255,0.05)' : 'transparent', color: active ? color : C.dim, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', padding: '5px 9px', cursor: 'pointer' }}
      hoverStyle={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </Btn>
  )
}
