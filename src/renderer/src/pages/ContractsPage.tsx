import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { deriveContracts } from '../state/manifest'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn, HoverDiv } from '../components/ui'

const COLS = '1fr 160px 130px 110px 96px 28px'

const statusColor: Record<string, string> = {
  active: C.green,
  completed: C.acc,
  abandoned: C.amber,
  failed: C.red
}

export default function ContractsPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const abandonContract = useStore((s) => s.abandonContract)
  const openCapture = useStore((s) => s.openCapture)
  const setObjectiveScu = useStore((s) => s.setObjectiveScu)
  // Hide contracts waiting on their first OCR capture, so a contract shows up
  // here only once that capture finishes (same as the manifest).
  const derived = useMemo(() => deriveContracts(contracts.filter((c) => !c.pendingOcr)), [contracts])
  const [expanded, setExpanded] = useState<string | null>(derived[0]?.id ?? null)

  return (
    <div style={{ padding: PAGE_PADDING }}>
      <PageHeader
        title="CONTRACTS"
        subtitle={`${derived.length} tracked · click a contract to expand objectives`}
        right={
          <Btn
            onClick={() => openCapture()}
            style={{
              border: `1px solid rgba(255,255,255,0.18)`,
              background: 'transparent',
              color: C.body,
              fontFamily: F.display,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.14em',
              padding: '8px 14px',
              cursor: 'pointer'
            }}
            hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
          >
            + ADD CONTRACT
          </Btn>
        }
      />

      {derived.length === 0 ? (
        <div style={{ fontFamily: F.body, fontSize: 14, color: C.dim, padding: '40px 0' }}>
          No contracts yet. Accept one in-game or add it manually.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 18, padding: '0 0 10px', borderBottom: `1px solid ${C.lineStrong}` }}>
            {['CONTRACT', 'PICKUP', 'REWARD', 'OBJECTIVES', 'STATUS', ''].map((h, i) => (
              <span
                key={h || i}
                style={{
                  fontFamily: F.display,
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  color: C.dim,
                  textAlign: i >= 2 && i <= 4 ? 'right' : 'left'
                }}
              >
                {h}
              </span>
            ))}
          </div>

          {derived.map((c) => {
            const isOpen = expanded === c.id
            return (
              <div key={c.id} style={{ borderBottom: `1px solid ${C.lineFaint}` }}>
                <HoverDiv
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  style={{ display: 'grid', gridTemplateColumns: COLS, gap: 18, alignItems: 'center', padding: '16px 0', cursor: 'pointer' }}
                  hoverStyle={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 13, color: C.acc, flex: 'none' }}>{c.ref}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: F.display,
                            fontSize: 17,
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                            color: C.text,
                            textShadow: GLOW,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {c.title}
                        </span>
                        {c.blueprint && <BlueprintBadge />}
                      </div>
                      <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginTop: 1 }}>
                        {[c.rank, `${c.objCount} objectives`, `${c.totSCU} SCU`, c.reputation ? `${c.reputation} Rep` : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                  <span style={{ fontFamily: F.body, fontSize: 13, color: C.body }}>{c.pickup || '-'}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 14, color: C.text, textShadow: GLOW, textAlign: 'right' }}>
                    {c.reward ? fmt(c.reward) : '-'}
                    {c.reward ? <span style={{ fontSize: 11, color: C.dim }}> aUEC</span> : null}
                  </span>
                  <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body, textAlign: 'right' }}>{c.objCount}</span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor[c.status] ?? C.dim }} />
                    <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: statusColor[c.status] ?? C.dim }}>
                      {c.status.toUpperCase()}
                    </span>
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'flex-end', color: C.dim }}>
                    <Chevron open={isOpen} />
                  </span>
                </HoverDiv>

                {isOpen && (
                  <div style={{ padding: '4px 0 22px 27px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 220px 70px', gap: 18, padding: '0 0 8px', borderBottom: `1px solid ${C.lineSoft}`, marginBottom: 4 }}>
                      {['SCU', 'COMMODITY · DESTINATION', 'BOX BREAKDOWN', 'COUNT'].map((h, i) => (
                        <span key={h} style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.18em', color: C.faint, textAlign: i === 0 || i === 3 ? 'right' : 'left' }}>
                          {h}
                        </span>
                      ))}
                    </div>
                    {c.objectives.length === 0 && (
                      <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '12px 0' }}>
                        No objective details captured yet (Star Citizen only logs them for the first contract
                        accepted; add them manually, or capture the contract screen with OCR).
                      </div>
                    )}
                    {c.objectives.map((o) => (
                      <div key={o.objectiveId} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 220px 70px', gap: 18, alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                        <EditableScu value={o.scu} onCommit={(n) => setObjectiveScu(c.id, o.objectiveId, n)} />
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                          <span style={{ fontFamily: F.body, fontSize: 14, color: C.textBody }}>{o.commodity}</span>
                          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{o.destination}</span>
                        </div>
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: '#b6bec0' }}>{o.boxStr || '-'}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.dim, textAlign: 'right' }}>{o.boxCount} box</span>
                      </div>
                    ))}

                    {/* blueprints (from StarStrings contract data, named contracts only) */}
                    {c.blueprints.length > 0 && (
                      <div style={{ marginTop: 16, border: `1px solid ${C.accBorder}`, background: C.accFill, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.acc} strokeWidth="2">
                            <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.acc }}>
                            POSSIBLE BLUEPRINTS
                          </span>
                          <span style={{ fontFamily: F.body, fontSize: 11, color: C.dim }}>· via StarStrings</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 10px' }}>
                          {c.blueprints.map((bp, i) => (
                            <span key={i} style={{ fontFamily: F.body, fontSize: 13, color: C.textBody }}>
                              • {bp}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <ActionBtn label="ADD OBJECTIVES" color={C.acc} onClick={() => openCapture(c.id)} />
                      <ActionBtn label="ABANDON" color={C.red} onClick={() => abandonContract(c.id)} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

function ActionBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: `1px solid rgba(255,255,255,0.16)`,
        background: 'transparent',
        color: C.dim,
        fontFamily: F.display,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '7px 13px',
        cursor: 'pointer'
      }}
      hoverStyle={{ border: `1px solid ${color}`, color }}
    >
      {label}
    </Btn>
  )
}

/** Click-to-edit SCU for one objective. Saves on Enter/blur (re-boxing happens
 *  in the store), Escape cancels. Lets you fix an OCR misread against the in-game
 *  contract screen, which this page mirrors. */
function EditableScu({ value, onCommit }: { value: number; onCommit: (n: number) => void }): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    setEditing(false)
    const n = parseInt(draft, 10)
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n)
    else setDraft(String(value))
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
          }
        }}
        style={{
          width: '100%',
          fontFamily: F.mono,
          fontSize: 15,
          textAlign: 'right',
          background: 'transparent',
          color: C.text,
          border: `1px solid ${C.accBorder}`,
          padding: '2px 4px'
        }}
      />
    )
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Click to edit SCU"
      style={{
        fontFamily: F.mono,
        fontSize: 15,
        color: C.text,
        textShadow: GLOW,
        textAlign: 'right',
        cursor: 'pointer'
      }}
    >
      {value}
    </span>
  )
}

/** Badge (from StarStrings) showing this contract can award a blueprint. */
function BlueprintBadge(): React.ReactElement {
  return (
    <span
      title="Has a chance to award a blueprint (detected from the StarStrings [BP] marker)"
      style={{
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: `1px solid ${C.accBorder}`,
        background: C.accFill,
        color: C.acc,
        fontFamily: F.display,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.14em',
        padding: '2px 7px'
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      BP
    </span>
  )
}

function Chevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      {open ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  )
}
