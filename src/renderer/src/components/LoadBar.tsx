import React from 'react'
import { C, F, fmt } from '../theme'

// capacity bar: fill = what's aboard right now, the tick marks the run's peak so you
// can watch the fill climb toward your ceiling as you load.
export default function LoadBar({
  current,
  peak,
  capacity
}: {
  current: number
  peak: number
  capacity: number
}): React.ReactElement {
  const pct = capacity > 0 ? Math.min(100, (current / capacity) * 100) : 0
  const peakPct = capacity > 0 ? Math.min(100, (peak / capacity) * 100) : 0
  const ratio = capacity > 0 ? current / capacity : 0
  const fill = ratio <= 0.5 ? C.green : ratio <= 0.8 ? C.amber : C.red
  const over = capacity > 0 && peak > capacity

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>LOAD</span>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
          {fmt(Math.round(current))} / {fmt(capacity)} SCU
          <span style={{ color: over ? C.red : C.dim }}> · peak {fmt(Math.round(peak))}</span>
        </span>
      </div>
      <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.10)', width: '100%' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, transition: 'width 160ms ease' }} />
        <div
          title={`peak ${fmt(Math.round(peak))} SCU`}
          style={{ position: 'absolute', top: -2, bottom: -2, left: `${peakPct}%`, width: 2, background: over ? C.red : C.text, transform: 'translateX(-1px)' }}
        />
      </div>
    </div>
  )
}
