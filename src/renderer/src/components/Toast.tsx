import React, { useEffect } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'

export default function Toast(): React.ReactElement | null {
  const notice = useStore((s) => s.notice)
  const dismiss = useStore((s) => s.dismissNotice)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismiss, 6000)
    return () => clearTimeout(t)
  }, [notice, dismiss])

  if (!notice) return null

  return (
    <div
      onClick={dismiss}
      title="Dismiss"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 76,
        transform: 'translateX(-50%)',
        maxWidth: '82%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 16px',
        background: C.accFillStrong,
        border: `1px solid ${C.acc}`,
        borderRadius: 8,
        cursor: 'pointer',
        zIndex: 100
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.acc, boxShadow: GLOW, flex: 'none' }} />
      <span style={{ fontFamily: F.body, fontSize: 14, color: C.text, textShadow: GLOW }}>{notice}</span>
    </div>
  )
}
