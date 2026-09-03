import React, { useState } from 'react'
import { useStore } from '../state/store'

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

/** false for a crew member: their app mirrors the leader and changes nothing */
export function useCanEdit(): boolean {
  return useStore((s) => s.crew.role !== 'member')
}

/** anything that would change the run; a crew member simply doesn't get it */
export function WriteOnly({ children }: { children: React.ReactNode }): React.ReactElement | null {
  return useCanEdit() ? <>{children}</> : null
}
