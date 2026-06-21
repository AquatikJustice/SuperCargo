import React from 'react'
import { C, F } from '../theme'

/** Panel shown on pages that are not built yet ("coming in a later phase"). */
export default function Placeholder({ phase, lines }: { phase: string; lines: string[] }): React.ReactElement {
  return (
    <div style={{ padding: '70px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
      <div
        style={{
          fontFamily: F.display,
          fontSize: 11,
          letterSpacing: '0.24em',
          color: C.acc,
          border: `1px solid ${C.accBorder}`,
          padding: '6px 14px'
        }}
      >
        {phase.toUpperCase()}
      </div>
      <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, maxWidth: 560, lineHeight: 1.7 }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  )
}
