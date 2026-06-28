import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { deriveContracts } from '../state/manifest'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn, HoverDiv } from '../components/ui'
import TurnInModal from '../components/TurnInModal'

const COLS = '1fr 160px 130px 110px 96px 28px'
// long names ellipsize, not widen
const OBJ_COLS = '20px 58px minmax(0,1fr) minmax(0,1.4fr) 200px 64px 84px'

const statusColor: Record<string, string> = {
  active: C.green,
  completed: C.acc,
  abandoned: C.amber,
  failed: C.red
}

export default function ContractsPage(): React.ReactElement {
  const contracts = useStore((s) => s.contracts)
  const abandonContract = useStore((s) => s.abandonContract)
  const completeContract = useStore((s) => s.completeContract)
  const turnInDestination = useStore((s) => s.turnInDestination)
  const unmarkTurnIn = useStore((s) => s.unmarkTurnIn)
  const openCapture = useStore((s) => s.openCapture)
  const setObjectiveScu = useStore((s) => s.setObjectiveScu)
  const editContract = useStore((s) => s.editContract)
  const editObjective = useStore((s) => s.editObjective)
  // hide until ocr capture resolves
  const derived = useMemo(() => deriveContracts(contracts.filter((c) => !c.pendingOcr)), [contracts])
  const [expanded, setExpanded] = useState<string | null>(derived[0]?.id ?? null)
  const [editTurnIn, setEditTurnIn] = useState<TurnInTarget | null>(null)

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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px 22px', marginBottom: 20 }}>
                      <DetailField label="PICKUP">
                        <EditableText value={c.pickup} onCommit={(v) => editContract(c.id, { pickup: v })} placeholder="set pickup" />
                      </DetailField>
                      <DetailField label="REWARD">
                        <EditableNum value={c.reward} suffix=" aUEC" onCommit={(n) => editContract(c.id, { reward: n })} />
                      </DetailField>
                      <DetailField label="RANK">
                        <EditableText value={c.rank} onCommit={(v) => editContract(c.id, { rank: v })} placeholder="set rank" />
                      </DetailField>
                      <DetailField label="MAX BOX">
                        <EditableNum value={c.maxBox} suffix=" SCU" onCommit={(n) => editContract(c.id, { maxBoxSize: n })} />
                      </DetailField>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: OBJ_COLS, gap: 18, padding: '0 0 8px', borderBottom: `1px solid ${C.lineSoft}`, marginBottom: 4 }}>
                      {[
                        { h: '', align: 'left' },
                        { h: 'SCU', align: 'right' },
                        { h: 'COMMODITY', align: 'left' },
                        { h: 'DESTINATION', align: 'left' },
                        { h: 'BOX BREAKDOWN', align: 'left' },
                        { h: 'COUNT', align: 'right' },
                        { h: '', align: 'left' }
                      ].map((c, i) => (
                        <span key={i} style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.18em', color: C.faint, textAlign: c.align as 'left' | 'right' }}>
                          {c.h}
                        </span>
                      ))}
                    </div>
                    {c.objectives.length === 0 && (
                      <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, padding: '12px 0' }}>
                        No objective details captured yet. Add them manually, or capture the contract
                        screen with OCR.
                      </div>
                    )}
                    {c.objectives.map((o) => {
                      const ti = o.turnedInScu
                      const isTurnedIn = ti !== undefined
                      // color tracks turn-in fullness
                      const tiColor = ti === undefined ? C.textBody : ti >= o.scu ? C.green : ti <= 0 ? C.red : C.amber
                      return (
                        <div key={o.objectiveId} style={{ display: 'grid', gridTemplateColumns: OBJ_COLS, gap: 18, alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                          <span style={{ fontFamily: F.display, fontSize: 15, color: tiColor, textShadow: isTurnedIn ? GLOW : 'none' }}>
                            {isTurnedIn ? '✓' : ''}
                          </span>
                          <EditableScu value={o.scu} onCommit={(n) => setObjectiveScu(c.id, o.objectiveId, n)} />
                          <EditableText
                            value={o.commodity}
                            onCommit={(v) => editObjective(c.id, o.objectiveId, { commodity: v })}
                            placeholder="commodity"
                            textStyle={{ fontSize: 14, color: isTurnedIn ? tiColor : C.textBody }}
                          />
                          <EditableText
                            value={o.destination}
                            onCommit={(v) => editObjective(c.id, o.objectiveId, { destination: v })}
                            placeholder="destination"
                            textStyle={{ fontSize: 13, color: isTurnedIn ? tiColor : C.dim }}
                          />
                          <span style={{ fontFamily: F.mono, fontSize: 12, color: isTurnedIn ? tiColor : '#b6bec0' }}>{o.boxStr || '-'}</span>
                          <span style={{ fontFamily: F.mono, fontSize: 12, color: isTurnedIn ? tiColor : C.dim, textAlign: 'right' }}>{o.boxCount} box</span>
                          <Btn
                            onClick={() => setEditTurnIn({ contractId: c.id, objectiveId: o.objectiveId, commodity: o.commodity, destination: o.destination, scu: o.scu, boxStr: o.boxStr, ref: c.ref, turnedInScu: ti })}
                            title={isTurnedIn ? `Turned in: ${ti >= o.scu ? 'full' : ti <= 0 ? 'none' : `${ti} SCU`}. Click to change.` : 'Record what you handed over'}
                            style={{ border: `1px solid ${tiColor}`, background: 'transparent', color: tiColor, fontFamily: F.display, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', padding: '5px 0', cursor: 'pointer', textAlign: 'center' }}
                            hoverStyle={{ background: 'rgba(255,255,255,0.06)', textShadow: GLOW }}
                          >
                            {isTurnedIn ? '✓ EDIT' : 'TURN IN'}
                          </Btn>
                        </div>
                      )
                    })}

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

                    <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
                      <ActionBtn label="ADD OBJECTIVES" color={C.acc} onClick={() => openCapture(c.id)} />
                      {c.objectives.length > 0 && c.objectives.every((o) => o.turnedInScu !== undefined) ? (
                        <>
                          <ActionBtn
                            label="↩ UNDO COMPLETE"
                            color={C.amber}
                            onClick={() => unmarkTurnIn(c.objectives.map((o) => o.objectiveId))}
                          />
                          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
                            marked done · the game finishing the contract is what files it to History
                          </span>
                        </>
                      ) : (
                        <ActionBtn label="COMPLETE" color={C.green} onClick={() => completeContract(c.id)} />
                      )}
                      <ActionBtn label="ABANDON" color={C.red} onClick={() => abandonContract(c.id)} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {editTurnIn && (
        <TurnInModal
          eyebrow="EDIT TURN-IN"
          heading={editTurnIn.commodity}
          sub={`→ ${editTurnIn.destination}`}
          items={[
            {
              objectiveId: editTurnIn.objectiveId,
              contractId: editTurnIn.contractId,
              breakdown: editTurnIn.boxStr || '-',
              commodity: editTurnIn.commodity,
              ref: editTurnIn.ref,
              totalScu: editTurnIn.scu,
              turnedInScu: editTurnIn.turnedInScu
            }
          ]}
          onSave={(entries) => {
            turnInDestination(entries)
            setEditTurnIn(null)
          }}
          onUnmark={(ids) => {
            unmarkTurnIn(ids)
            setEditTurnIn(null)
          }}
          onClose={() => setEditTurnIn(null)}
        />
      )}
    </div>
  )
}

type TurnInTarget = {
  contractId: string
  objectiveId: string
  commodity: string
  destination: string
  scu: number
  boxStr: string
  ref: string
  turnedInScu?: number
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
        cursor: 'text',
        borderBottom: `1px dashed rgba(255,255,255,0.22)`
      }}
    >
      {value}
    </span>
  )
}

const editInputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: F.body,
  fontSize: 14,
  background: 'transparent',
  color: C.text,
  border: `1px solid ${C.accBorder}`,
  padding: '3px 6px',
  outline: 'none'
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontFamily: F.display, fontSize: 9.5, letterSpacing: '0.16em', color: C.faint }}>{label}</span>
      {children}
    </div>
  )
}

function EditableText({
  value,
  onCommit,
  placeholder,
  textStyle
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  textStyle?: React.CSSProperties
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() !== value.trim()) onCommit(draft)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        style={{ ...editInputStyle, ...textStyle }}
      />
    )
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Click to edit"
      style={{
        fontFamily: F.body,
        fontSize: 14,
        color: C.text,
        cursor: 'text',
        borderBottom: `1px dashed rgba(255,255,255,0.22)`,
        paddingBottom: 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...textStyle
      }}
    >
      {value || <span style={{ color: C.faint }}>{placeholder ?? 'set -'}</span>}
    </span>
  )
}

function EditableNum({
  value,
  onCommit,
  suffix
}: {
  value: number
  onCommit: (n: number) => void
  suffix?: string
}): React.ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    setEditing(false)
    const n = parseInt(draft, 10)
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(n)
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
        style={{ ...editInputStyle, fontFamily: F.mono }}
      />
    )
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Click to edit"
      style={{ fontFamily: F.mono, fontSize: 14, color: C.text, cursor: 'text', borderBottom: `1px dashed rgba(255,255,255,0.22)`, paddingBottom: 1 }}
    >
      {value ? fmt(value) : <span style={{ color: C.faint }}>set -</span>}
      {value && suffix ? <span style={{ color: C.dim, fontSize: 11 }}>{suffix}</span> : null}
    </span>
  )
}

function BlueprintBadge(): React.ReactElement {
  return (
    <span
      title="Has a chance to award a blueprint"
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
