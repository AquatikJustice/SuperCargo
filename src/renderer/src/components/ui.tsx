import React, { useState } from 'react'

type DivProps = React.HTMLAttributes<HTMLDivElement> & {
  hoverStyle?: React.CSSProperties
}

/** A div that merges `hoverStyle` over `style` while hovered. */
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

/** A button that merges `hoverStyle` over `style` while hovered. */
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
