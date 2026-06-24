import React, { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import type { CropRect, OcrResult } from '@shared/types'
import { Btn } from './ui'

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

type Drag =
  | { mode: 'move'; mx: number; my: number; crop: CropRect }
  | { mode: 'resize'; mx: number; my: number; crop: CropRect }
  | null

// crop as fractions so it survives resolution changes
export default function OcrCalibrator(): React.ReactElement {
  const crop = useStore((s) => s.settings.ocrCrop)
  const updateSettings = useStore((s) => s.updateSettings)

  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [test, setTest] = useState<OcrResult | null>(null)
  const [testing, setTesting] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<Drag>(null)

  const capture = async (): Promise<void> => {
    setLoading(true)
    try {
      const url = await window.supercargo.ocrPreview()
      setPreview(url)
    } finally {
      setLoading(false)
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    try {
      setTest(await window.supercargo.ocrRun())
    } finally {
      setTesting(false)
    }
  }

  const onPointerDown = (mode: 'move' | 'resize') => (e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { mode, mx: e.clientX, my: e.clientY, crop }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    const wrap = wrapRef.current
    if (!d || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dx = (e.clientX - d.mx) / rect.width
    const dy = (e.clientY - d.my) / rect.height
    let next: CropRect
    if (d.mode === 'move') {
      next = {
        ...d.crop,
        x: clamp01(Math.min(d.crop.x + dx, 1 - d.crop.w)),
        y: clamp01(Math.min(d.crop.y + dy, 1 - d.crop.h))
      }
    } else {
      next = {
        ...d.crop,
        w: clamp01(Math.max(0.05, Math.min(d.crop.w + dx, 1 - d.crop.x))),
        h: clamp01(Math.max(0.05, Math.min(d.crop.h + dy, 1 - d.crop.y)))
      }
    }
    void updateSettings({ ocrCrop: next })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (dragRef.current) {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      dragRef.current = null
    }
  }

  const pct = (n: number): string => `${Math.round(n * 100)}%`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <CalBtn onClick={() => void capture()}>{loading ? 'CAPTURING...' : preview ? 'RECAPTURE' : 'CAPTURE PREVIEW'}</CalBtn>
        {preview && <CalBtn onClick={() => void runTest()}>{testing ? 'READING...' : 'TEST READ'}</CalBtn>}
        {preview && <CalBtn onClick={() => setPreview(null)}>DONE</CalBtn>}
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>
          crop {pct(crop.x)},{pct(crop.y)} · {pct(crop.w)}×{pct(crop.h)}
        </span>
      </div>

      {!preview ? (
        <div
          style={{
            border: `1px dashed ${C.lineStrong}`,
            padding: '28px 16px',
            textAlign: 'center',
            fontFamily: F.body,
            fontSize: 12,
            color: C.dim,
            lineHeight: 1.6
          }}
        >
          Capture a preview of your game display, then drag the box over the contract panel.
          <br />
          Capture while the mobiGlas contract screen is visible for the easiest alignment.
        </div>
      ) : (
        <div
          ref={wrapRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: 'relative',
            width: '100%',
            userSelect: 'none',
            border: `1px solid ${C.line}`,
            lineHeight: 0,
            // clip the 9999px dimming shadow to the preview
            overflow: 'hidden'
          }}
        >
          <img src={preview} alt="display preview" style={{ width: '100%', display: 'block' }} draggable={false} />
          <div
            onPointerDown={onPointerDown('move')}
            style={{
              position: 'absolute',
              left: pct(crop.x),
              top: pct(crop.y),
              width: pct(crop.w),
              height: pct(crop.h),
              border: `1.5px solid ${C.acc}`,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              cursor: 'move',
              boxSizing: 'border-box'
            }}
          >
            <div
              onPointerDown={onPointerDown('resize')}
              style={{
                position: 'absolute',
                right: -7,
                bottom: -7,
                width: 14,
                height: 14,
                background: C.acc,
                border: `1px solid #000`,
                cursor: 'nwse-resize',
                boxShadow: GLOW
              }}
            />
          </div>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 8, fontFamily: F.body, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
          Drag the box over the contract panel, drag its corner to resize. The crop saves
          automatically. Hit <span style={{ fontFamily: F.mono, color: C.faint }}>DONE</span> to
          collapse the preview, or <span style={{ fontFamily: F.mono, color: C.faint }}>TEST READ</span> to
          check it.
        </div>
      )}

      {test && (
        <div style={{ marginTop: 12, border: `1px solid ${C.lineStrong}`, padding: 12 }}>
          {test.ok ? (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.text }}>
                  TEST READ · {test.objectives.length} objective{test.objectives.length === 1 ? '' : 's'}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>
                  {Math.round(test.confidence)}% · {test.ms} ms
                </span>
              </div>
              {test.objectives.length === 0 ? (
                <div style={{ fontFamily: F.body, fontSize: 12, color: C.amber }}>
                  No objectives parsed. Adjust the crop to frame the objective lines, then test again.
                </div>
              ) : (
                test.objectives.map((o, i) => (
                  <div key={i} style={{ fontFamily: F.mono, fontSize: 12, color: C.body, padding: '2px 0' }}>
                    {o.scuAmount} SCU · {o.commodity.match ?? `?${o.commodity.input}`} ·{' '}
                    {o.destination.match ?? `?${o.destination.input}`}
                  </div>
                ))
              )}
            </>
          ) : (
            <div style={{ fontFamily: F.body, fontSize: 12, color: C.red }}>{test.error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function CalBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid rgba(255,255,255,0.18)`,
        background: 'transparent',
        color: C.body,
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.14em',
        padding: '6px 12px',
        cursor: 'pointer',
        flex: 'none'
      }}
      hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
    >
      {children}
    </Btn>
  )
}
