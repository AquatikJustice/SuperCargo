import React, { useEffect, useMemo, useRef, useState } from 'react'
import { C, F } from '../theme'

export interface TypeaheadProps {
  value: string
  options: string[]
  /** fires only when freeText */
  onChange?: (v: string) => void
  onSelect?: (v: string) => void
  placeholder?: string
  /** allow off-list values */
  freeText?: boolean
  maxResults?: number
  mono?: boolean
  autoFocus?: boolean
  clearOnFocus?: boolean
  search?: boolean
  warn?: (opt: string) => boolean
  warnTitle?: string
}

export default function Typeahead({
  value,
  options,
  onChange,
  onSelect,
  placeholder,
  freeText = true,
  maxResults = 8,
  mono = false,
  autoFocus = false,
  clearOnFocus = false,
  search = false,
  warn,
  warnTitle
}: TypeaheadProps): React.ReactElement {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // idle field tracks value
  useEffect(() => {
    if (clearOnFocus || focused) return
    setQuery(value)
  }, [value, focused, clearOnFocus])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, maxResults)
    const starts: string[] = []
    const contains: string[] = []
    for (const o of options) {
      const lo = o.toLowerCase()
      if (lo.startsWith(q)) starts.push(o)
      else if (lo.includes(q)) contains.push(o)
      if (starts.length >= maxResults) break
    }
    return [...starts, ...contains].slice(0, maxResults)
  }, [query, options, maxResults])

  const commit = (v: string): void => {
    setQuery(v)
    setOpen(false)
    onSelect?.(v)
    if (freeText) onChange?.(v)
  }

  const onInput = (v: string): void => {
    setQuery(v)
    setOpen(true)
    setHighlight(0)
    if (freeText) onChange?.(v)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault()
        commit(filtered[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      if (!freeText) setQuery(value)
    }
  }

  const onBlur = (): void => {
    blurTimer.current = setTimeout(() => {
      setFocused(false)
      setOpen(false)
      if (!freeText && query !== value) setQuery(value) // revert off-list value
    }, 120)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'transparent',
    border: 0,
    borderBottom: `1px solid rgba(255,255,255,0.2)`,
    color: C.text,
    fontFamily: mono ? F.mono : F.body,
    fontSize: 14,
    padding: search ? '7px 0 7px 24px' : '7px 0',
    outline: 'none'
  }

  return (
    <div style={{ position: 'relative' }}>
      {search && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.dim}
          strokeWidth="2"
          style={{ position: 'absolute', left: 2, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      )}
      <input
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onInput(e.target.value)}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current)
          setFocused(true)
          if (clearOnFocus) {
            setQuery('')
            setHighlight(0)
          }
          setOpen(true)
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        style={inputStyle}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 60,
            background: '#05080a',
            border: `1px solid ${C.accBorder}`,
            maxHeight: 230,
            overflowY: 'auto'
          }}
        >
          {filtered.map((opt, i) => (
            <div
              key={opt}
              // mousedown fires before blur
              onMouseDown={(e) => {
                e.preventDefault()
                commit(opt)
              }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'grid',
                gridTemplateColumns: warn ? '16px 1fr' : '1fr',
                alignItems: 'center',
                gap: 8,
                padding: '8px 11px',
                fontFamily: mono ? F.mono : F.body,
                fontSize: 13,
                color: i === highlight ? C.text : C.body,
                background: i === highlight ? C.accFill : 'transparent',
                cursor: 'pointer'
              }}
            >
              {warn && (
                <span title={warn(opt) ? warnTitle : undefined} style={{ color: '#e8b13a', fontSize: 12, textAlign: 'center', lineHeight: 1 }}>
                  {warn(opt) ? '⚠' : ''}
                </span>
              )}
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
