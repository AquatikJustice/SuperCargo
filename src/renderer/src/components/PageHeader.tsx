import React from 'react'
import { C, F, GLOW } from '../theme'

export default function PageHeader({
  title,
  subtitle,
  right
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 22,
        gap: 16
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: F.display,
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: '0.06em',
            color: C.text,
            textShadow: GLOW,
            lineHeight: 1
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              marginTop: 7,
              fontFamily: F.body,
              fontSize: 13,
              color: C.dim,
              letterSpacing: '0.02em'
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

export const PAGE_PADDING = '26px 30px 50px'
