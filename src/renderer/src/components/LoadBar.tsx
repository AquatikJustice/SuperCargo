import React from 'react'
import { C, F, fmt } from '../theme'

// fill = what's aboard now, tick = the run's peak, hatched end = Stor-All reserve
export default function LoadBar({
  current,
  peak,
  capacity,
  reserved = 0
}: {
  current: number
  peak: number
  capacity: number
  reserved?: number
}): React.ReactElement {
  const usable = Math.max(0, capacity - reserved)
  const pct = capacity > 0 ? Math.min(100, (current / capacity) * 100) : 0
  const peakPct = capacity > 0 ? Math.min(100, (peak / capacity) * 100) : 0
  const resPct = capacity > 0 ? Math.min(100, (reserved / capacity) * 100) : 0
  const ratio = usable > 0 ? current / usable : 0
  const fill = ratio <= 0.5 ? C.green : ratio <= 0.8 ? C.amber : C.red
  const over = capacity > 0 && peak > usable

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.2em', color: C.dim }}>LOAD</span>
        <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
          {fmt(Math.round(current))} / {fmt(usable)} SCU
          <span style={{ color: over ? C.red : C.dim }}> · peak {fmt(Math.round(peak))}</span>
          {reserved > 0 && <span style={{ color: '#e07f28' }}> · {fmt(reserved)} reserved</span>}
        </span>
      </div>
      <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.10)', width: '100%' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: fill, transition: 'width 160ms ease' }} />
        {reserved > 0 && (
          <div
            title={`${fmt(reserved)} SCU reserved by Stor-All crates`}
            style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${resPct}%`, background: 'repeating-linear-gradient(45deg, rgba(224,127,40,0.6) 0 3px, rgba(224,127,40,0.18) 3px 6px)' }}
          />
        )}
        <div
          title={`peak ${fmt(Math.round(peak))} SCU`}
          style={{ position: 'absolute', top: -2, bottom: -2, left: `${peakPct}%`, width: 2, background: over ? C.red : C.text, transform: 'translateX(-1px)' }}
        />
      </div>
    </div>
  )
}
