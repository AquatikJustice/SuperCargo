import React, { useState } from 'react'
import { useStore } from '../state/store'
import { C, F } from '../theme'

type DivProps = React.HTMLAttributes<HTMLDivElement> & {
  hoverStyle?: React.CSSProperties
}

// hoverStyle wins while hovered
export function HoverDiv({ hoverStyle, style, ...rest }: DivProps): React.ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <div
      {...rest}
      onMouseEnter={(e) => {
        setHover(true)
        rest.onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        setHover(false)
        rest.onMouseLeave?.(e)
      }}
      style={hover && hoverStyle ? { ...style, ...hoverStyle } : style}
    />
  )
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  hoverStyle?: React.CSSProperties
}

// hoverStyle wins while hovered
export function Btn({ hoverStyle, style, ...rest }: BtnProps): React.ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <button
      {...rest}
      onMouseEnter={(e) => {
        setHover(true)
        rest.onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        setHover(false)
        rest.onMouseLeave?.(e)
      }}
      style={hover && hoverStyle ? { ...style, ...hoverStyle } : style}
    />
  )
}

export function useCanEdit(): boolean {
  return useStore((s) => s.crew.role !== 'member')
}

export function WriteOnly({ children }: { children: React.ReactNode }): React.ReactElement | null {
  return useCanEdit() ? <>{children}</> : null
}

export function ScuInput({ onSave, big, disabled }: { onSave: (n: number) => void; big?: boolean; disabled?: boolean }): React.ReactElement {
  const [val, setVal] = useState('')
  const save = (): void => {
    const n = parseInt(val, 10)
    if (!Number.isNaN(n) && n >= 0) onSave(n)
  }
  return (
    <input
      value={val}
      disabled={disabled}
      onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && save()}
      placeholder="?"
      style={{
        width: big ? 54 : 52,
        background: 'transparent',
        border: `1px solid ${C.amber}`,
        color: C.amber,
        fontFamily: F.mono,
        fontSize: big ? 15 : 13,
        textAlign: 'right',
        padding: big ? '3px 5px' : '2px 5px',
        outline: 'none'
      }}
    />
  )
}
