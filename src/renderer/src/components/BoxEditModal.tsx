import React, { useState } from 'react'
import type { BoxAllocation } from '@shared/types'
import { BOX_SIZES } from '@shared/box'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'

export default function BoxEditModal({
  commodity,
  scu,
  boxes,
  onSave,
  onClose
}: {
  commodity: string
  /** the breakdown the app assumed, for the "was" hint */
  scu: number
  boxes: BoxAllocation[]
  onSave: (boxes: BoxAllocation[]) => void
  onClose: () => void
}): React.ReactElement {
  const [counts, setCounts] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {}
    for (const b of boxes) m[b.scuSize] = (m[b.scuSize] ?? 0) + b.count
    return m
  })
  const bump = (size: number, by: number): void =>
    setCounts((c) => ({ ...c, [size]: Math.max(0, (c[size] ?? 0) + by) }))
  const setTo = (size: number, n: number): void => setCounts((c) => ({ ...c, [size]: Math.max(0, n) }))

  const total = BOX_SIZES.reduce((a, s) => a + s * (counts[s] ?? 0), 0)
  const count = BOX_SIZES.reduce((a, s) => a + (counts[s] ?? 0), 0)

  const save = (): void => {
    const out = BOX_SIZES.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({ scuSize: s, count: counts[s] }))
    if (out.length) onSave(out)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(360px, 100%)', maxHeight: '100%', overflowY: 'auto', border: `1px solid ${C.acc}`, borderRadius: 8, background: '#0a0d10', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
      >
        <div style={{ padding: '14px 18px 8px', borderBottom: `1px solid ${C.lineSoft}` }}>
          <div style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.18em', color: C.acc }}>ACTUAL BOXES</div>
          <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, color: C.text, textShadow: GLOW }}>{commodity}</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 2 }}>
            Enter what the freight elevator actually gave you.
          </div>
        </div>

        <div style={{ padding: '12px 18px' }}>
          {BOX_SIZES.map((s) => {
            const n = counts[s] ?? 0
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <span style={{ flex: 1, fontFamily: F.mono, fontSize: 14, color: n > 0 ? C.text : C.faint }}>{s} SCU</span>
                <Step onClick={() => bump(s, -1)}>−</Step>
                <input
                  value={n || ''}
                  placeholder="0"
                  inputMode="numeric"
                  onChange={(e) => setTo(s, parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10) || 0)}
                  style={{ width: 44, background: 'transparent', border: 0, borderBottom: `1px solid rgba(255,255,255,0.2)`, color: C.text, fontFamily: F.mono, fontSize: 15, textAlign: 'center', padding: '2px 0', outline: 'none' }}
                />
                <Step onClick={() => bump(s, 1)}>+</Step>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 18px 12px' }}>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{count} box{count === 1 ? '' : 'es'}</span>
          <span style={{ fontFamily: F.mono, fontSize: 14, color: total === scu ? C.green : C.amber }}>
            {total} SCU{total !== scu ? ` · was ${scu}` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '0 18px 16px' }}>
          <Btn
            onClick={onClose}
            style={{ flex: 1, border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 12, letterSpacing: '0.12em', padding: '9px 0', cursor: 'pointer' }}
            hoverStyle={{ color: C.text }}
          >
            CANCEL
          </Btn>
          <Btn
            onClick={save}
            style={{ flex: 2, border: `1px solid ${total > 0 ? C.acc : C.lineStrong}`, background: total > 0 ? C.accFillStrong : 'transparent', color: total > 0 ? C.text : C.faint, textShadow: total > 0 ? GLOW : 'none', fontFamily: F.display, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', padding: '9px 0', cursor: total > 0 ? 'pointer' : 'default' }}
            hoverStyle={total > 0 ? { background: C.acc, color: C.black } : {}}
          >
            SAVE &amp; REPACK
          </Btn>
        </div>
      </div>
    </div>
  )
}

function Step({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.lineStrong}`, background: 'transparent', color: C.dim, fontFamily: F.display, fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
      hoverStyle={{ color: C.text, border: `1px solid ${C.acc}` }}
    >
      {children}
    </Btn>
  )
}
