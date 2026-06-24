import React, { useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'

// settings button gets missed
export default function UpdateBanner(): React.ReactElement | null {
  const update = useStore((s) => s.update)
  const [hidden, setHidden] = useState(false)

  if (!update) return null

  if (update.kind === 'downloading') {
    const pct = 'percent' in update ? update.percent : 0
    return (
      <Bar tone="quiet">
        <Dot />
        <span style={textStyle}>Downloading update... {pct}%</span>
      </Bar>
    )
  }

  if (update.kind === 'downloaded' && !hidden) {
    const version = 'version' in update && update.version ? ` v${update.version}` : ''
    return (
      <Bar tone="loud">
        <Dot />
        <span style={textStyle}>A new version{version} is ready to install.</span>
        <Btn
          onClick={() => void window.supercargo.quitAndInstall()}
          style={{
            flex: 'none',
            border: `1px solid ${C.acc}`,
            background: C.accFillStrong,
            color: C.text,
            textShadow: GLOW,
            fontFamily: F.display,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.14em',
            padding: '7px 14px',
            cursor: 'pointer'
          }}
          hoverStyle={{ background: C.acc, color: C.black }}
        >
          RESTART &amp; INSTALL
        </Btn>
        <Btn
          onClick={() => setHidden(true)}
          style={{
            flex: 'none',
            border: 'none',
            background: 'transparent',
            color: C.dim,
            fontFamily: F.display,
            fontSize: 11,
            letterSpacing: '0.12em',
            padding: '7px 8px',
            cursor: 'pointer'
          }}
          hoverStyle={{ color: C.text }}
        >
          LATER
        </Btn>
      </Bar>
    )
  }

  return null
}

const textStyle: React.CSSProperties = { flex: 1, fontFamily: F.body, fontSize: 14, color: C.text }

function Dot(): React.ReactElement {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.acc, boxShadow: GLOW, flex: 'none' }} />
}

function Bar({ tone, children }: { tone: 'loud' | 'quiet'; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: tone === 'loud' ? '10px 16px' : '7px 16px',
        background: tone === 'loud' ? C.accFillStrong : C.accFill,
        borderBottom: `1px solid ${tone === 'loud' ? C.acc : C.accBorder}`
      }}
    >
      {children}
    </div>
  )
}
