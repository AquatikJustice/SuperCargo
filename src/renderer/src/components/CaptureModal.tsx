import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type ManualObjectiveInput } from '../state/store'
import { C, F, GLOW, fmt } from '../theme'
import { MAX_BOX_OPTIONS, calculateBoxes, boxCount } from '@shared/box'
import type { OcrObjective } from '@shared/types'
import { Btn } from './ui'
import Typeahead from './Typeahead'
import OcrCalibrator from './OcrCalibrator'

interface ObjRow extends ManualObjectiveInput {
  key: number
  /** Where the row came from, shown as a hint when it was filled by an OCR read. */
  ocrCommodity?: { raw: string; score: number; matched: boolean }
  ocrDestination?: { raw: string; score: number; matched: boolean }
}

let rowKey = 0
const newRow = (): ObjRow => ({ key: rowKey++, commodity: '', scuAmount: 0, destination: '' })

function rowFromOcr(o: OcrObjective): ObjRow {
  return {
    key: rowKey++,
    commodity: o.commodity.match ?? o.commodity.input,
    scuAmount: o.scuAmount,
    destination: o.destination.match ?? o.destination.input,
    ocrCommodity: { raw: o.commodity.input, score: o.commodity.score, matched: !!o.commodity.match },
    ocrDestination: { raw: o.destination.input, score: o.destination.score, matched: !!o.destination.match }
  }
}

const labelStyle: React.CSSProperties = {
  fontFamily: F.display,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: C.dim,
  marginBottom: 7
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 0,
  borderBottom: `1px solid rgba(255,255,255,0.2)`,
  color: C.text,
  fontFamily: F.body,
  fontSize: 14,
  padding: '7px 0',
  outline: 'none'
}

export default function CaptureModal(): React.ReactElement | null {
  const open = useStore((s) => s.captureOpen)
  const close = useStore((s) => s.closeCapture)
  const addManualContract = useStore((s) => s.addManualContract)
  const addObjectivesToContract = useStore((s) => s.addObjectivesToContract)
  const setContractReward = useStore((s) => s.setContractReward)
  const targetId = useStore((s) => s.captureTargetId)
  const target = useStore((s) => s.contracts.find((c) => c.id === s.captureTargetId) ?? null)
  const locations = useStore((s) => s.locations)
  const commodities = useStore((s) => s.commodities)
  const locationNames = useMemo(() => locations.map((l) => l.name), [locations])
  const commodityNames = useMemo(() => commodities.map((c) => c.name), [commodities])

  // OCR
  const ocrResult = useStore((s) => s.ocrResult)
  const ocrStatus = useStore((s) => s.ocrStatus)
  const ocrEngine = useStore((s) => s.ocrEngine)
  const runOcr = useStore((s) => s.runOcr)
  const clearOcr = useStore((s) => s.clearOcr)
  const saveSamples = useStore((s) => s.settings.ocrSaveSamples)
  // True if the user opted into any training-data collection (local save or
  // anonymous upload). Gates the non-hauling "contribute sample" path.
  const collecting = useStore((s) => s.settings.ocrSaveSamples || s.settings.contributeTrainingData)

  const [tab, setTab] = useState<'manual' | 'ocr'>('manual')
  const [title, setTitle] = useState('')
  const [pickup, setPickup] = useState('')
  const [maxBox, setMaxBox] = useState(16)
  const [reward, setReward] = useState(0)
  const [rows, setRows] = useState<ObjRow[]>([newRow()])
  const [showRaw, setShowRaw] = useState(false)
  // Editable raw transcription for the non-hauling contribute path.
  const [rawEdit, setRawEdit] = useState('')
  const [contributed, setContributed] = useState(false)
  // In-modal crop calibration (so the user doesn't have to go to Settings).
  const [calibrating, setCalibrating] = useState(false)

  // When opened against an existing contract, seed the box size and reward from it,
  // but only once per open. This effect is keyed on `target`, whose object identity
  // changes every time that contract updates in the store (objective events, the
  // pending-OCR hold releasing, a re-route commit). Without this guard it would
  // re-fire on each of those and reset a value the OCR (or the user) just filled in
  // back to the contract's stored reward of 0 (the "reward disappears" bug).
  const seededRef = useRef(false)
  useEffect(() => {
    if (!open) {
      seededRef.current = false
      return
    }
    if (seededRef.current) return
    seededRef.current = true
    if (target) {
      setMaxBox(target.maxBoxSize)
      setReward(target.reward)
    }
  }, [open, target])

  // An OCR pass (button, hotkey, or auto-capture) finished: switch to the OCR
  // tab and prefill the objective rows from the parsed and matched result.
  useEffect(() => {
    if (!ocrResult || !ocrResult.ok) return
    setTab('ocr')
    setContributed(false)
    if (ocrResult.objectives.length > 0) {
      setRows(ocrResult.objectives.map(rowFromOcr))
    } else {
      // No hauling objectives parsed, likely a non-hauling contract (or a parse
      // miss). Seed the editable raw text so the user can contribute it.
      setRawEdit(ocrResult.rawText)
    }
    if (ocrResult.maxBoxSize) setMaxBox(ocrResult.maxBoxSize)
    if (ocrResult.reward) setReward(ocrResult.reward)
  }, [ocrResult])

  if (!open) return null

  const reset = (): void => {
    setTitle('')
    setPickup('')
    setMaxBox(16)
    setReward(0)
    setRows([newRow()])
    setTab('manual')
    setShowRaw(false)
    setRawEdit('')
    setContributed(false)
    setCalibrating(false)
    clearOcr()
  }

  const onClose = (): void => {
    reset()
    close()
  }

  const update = (key: number, patch: Partial<ObjRow>): void =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const validRows = rows.filter((r) => r.commodity.trim() && r.destination.trim() && r.scuAmount > 0)
  const canSubmit = validRows.length > 0

  const submit = (): void => {
    if (!canSubmit) return
    const objectives = validRows.map(({ commodity, scuAmount, destination }) => ({ commodity, scuAmount, destination }))

    // Opt-in: save the confirmed read as a training sample for the future model.
    if (ocrResult?.ok && ocrResult.sampleId && saveSamples) {
      const text = validRows
        .map((r) => `Deliver ${r.scuAmount} SCU of ${r.commodity} to ${r.destination}`)
        .join('\n')
      void window.supercargo.ocrSaveSample({
        sampleId: ocrResult.sampleId,
        text,
        fields: { objectives, maxBoxSize: maxBox, reward }
      })
    }

    if (targetId) {
      addObjectivesToContract(targetId, objectives, maxBox)
      // The log never carries the reward; if we read or typed one, set it so the
      // contract's payout math has the full value.
      if (reward > 0) setContractReward(targetId, reward)
    } else {
      addManualContract({
        title: title.trim(),
        rank: '',
        haulType: '',
        pickup: pickup.trim(),
        reward,
        maxBoxSize: maxBox,
        objectives
      })
    }
    reset()
  }

  // Send the corrected raw text as a training sample without touching the
  // manifest. This is the path for any non-hauling contract (bounty, merc,
  // mining...), all valid SC-UI-font training data. The main process only keeps or
  // uploads it if the user opted in, so this is safe to call either way.
  const contribute = (): void => {
    if (!ocrResult?.ok || !ocrResult.sampleId || !rawEdit.trim()) return
    void window.supercargo.ocrSaveSample({
      sampleId: ocrResult.sampleId,
      text: rawEdit.trim(),
      fields: { kind: 'raw' }
    })
    setContributed(true)
  }

  const recognizing = ocrStatus === 'recognizing' || ocrStatus === 'capturing'
  const hasOcr = !!ocrResult && ocrResult.ok
  // No hauling objectives parsed but we have a read: offer the raw-text
  // contribute path instead of the (empty) objective editor.
  const isContributeMode = tab === 'ocr' && hasOcr && ocrResult!.objectives.length === 0
  // The shared objective editor shows for manual entry and for an OCR result we
  // can review; the OCR tab with no result yet shows the capture pane instead.
  const showEditor = tab === 'manual' || hasOcr

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, zIndex: 50 }}
    >
      <div
        style={{ width: hasOcr || calibrating ? 940 : 600, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: C.black, border: `1px solid rgba(255,255,255,0.22)`, fontFamily: F.body }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.lineStrong}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.acc} strokeWidth="1.6">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
            <div>
              <div style={{ fontFamily: F.display, fontSize: 16, fontWeight: 600, letterSpacing: '0.08em', color: C.text, textShadow: GLOW }}>
                {target ? 'ADD OBJECTIVES' : 'ADD CONTRACT'}
              </div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
                {target
                  ? `${target.ref} · ${target.title || 'contract'} - fill in what the game didn't log`
                  : 'Enter delivery objectives to add to the manifest'}
              </div>
            </div>
          </div>
          <Btn onClick={onClose} style={{ border: 0, background: 'transparent', color: C.dim, cursor: 'pointer', display: 'flex', padding: 4 }} hoverStyle={{ color: C.text }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Btn>
        </div>

        <div style={{ display: 'flex', borderBottom: `1px solid ${C.line}` }}>
          <TabButton active={tab === 'manual'} onClick={() => setTab('manual')}>
            MANUAL ENTRY
          </TabButton>
          <TabButton active={tab === 'ocr'} onClick={() => setTab('ocr')}>
            OCR CAPTURE
          </TabButton>
        </div>

        {calibrating ? (
          <div style={{ padding: '18px 20px' }}>
            <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.14em', color: C.text, marginBottom: 4 }}>
              ADJUST CAPTURE AREA
            </div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 14, lineHeight: 1.5 }}>
              Capture a preview of your game display, then drag the box over the mobiGlas contract panel.
              It saves automatically. Hit DONE when it&apos;s framed, then recapture.
            </div>
            <OcrCalibrator />
          </div>
        ) : tab === 'ocr' && !hasOcr ? (
          <OcrCapturePane
            recognizing={recognizing}
            engineLabel={ocrEngine?.label ?? 'Tesseract'}
            available={ocrEngine?.available ?? true}
            detail={ocrEngine?.detail}
            error={ocrResult && !ocrResult.ok ? ocrResult.error : undefined}
            onCapture={() => void runOcr()}
            onAdjustCrop={() => setCalibrating(true)}
          />
        ) : (
          <div style={{ padding: '18px 20px' }}>
            {tab === 'ocr' && hasOcr && ocrResult && !isContributeMode && (
              <OcrReviewBanner
                imageDataUrl={ocrResult.imageDataUrl}
                confidence={ocrResult.confidence}
                ms={ocrResult.ms}
                count={ocrResult.objectives.length}
                showRaw={showRaw}
                rawText={ocrResult.rawText}
                onToggleRaw={() => setShowRaw((v) => !v)}
                onRecapture={() => void runOcr()}
                onAdjustCrop={() => setCalibrating(true)}
                recognizing={recognizing}
              />
            )}

            {isContributeMode && ocrResult ? (
              <ContributePane
                imageDataUrl={ocrResult.imageDataUrl}
                confidence={ocrResult.confidence}
                ms={ocrResult.ms}
                onRecapture={() => void runOcr()}
                onAdjustCrop={() => setCalibrating(true)}
                recognizing={recognizing}
                value={rawEdit}
                onChange={setRawEdit}
                collecting={collecting}
                contributed={contributed}
              />
            ) : (
              <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px', marginBottom: 18 }}>
              {!target && (
                <>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={labelStyle}>CONTRACT TITLE (OPTIONAL)</div>
                    <input style={inputStyle} placeholder="e.g. Senior | Medium Haul | from Everus Harbor" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div>
                    <div style={labelStyle}>PICKUP LOCATION</div>
                    <Typeahead
                      value={pickup}
                      options={locationNames}
                      onChange={setPickup}
                      onSelect={setPickup}
                      placeholder="e.g. Everus Harbor"
                    />
                  </div>
                </>
              )}
              <div>
                <div style={labelStyle}>MAX BOX SIZE</div>
                <select
                  value={maxBox}
                  onChange={(e) => setMaxBox(Number(e.target.value))}
                  style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' }}
                >
                  {MAX_BOX_OPTIONS.map((s) => (
                    <option key={s} value={s} style={{ background: '#0a0c0d' }}>
                      {s} SCU
                    </option>
                  ))}
                </select>
                {ocrResult?.ok && ocrResult.maxBoxSize ? (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.green, marginTop: 3 }}>
                    ~ read {ocrResult.maxBoxSize} SCU
                  </div>
                ) : tab === 'ocr' && hasOcr ? (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 3 }}>
                    not read - using default
                  </div>
                ) : null}
              </div>
              <div>
                <div style={labelStyle}>REWARD · aUEC</div>
                <input
                  style={{ ...inputStyle, fontFamily: F.mono }}
                  inputMode="numeric"
                  placeholder="full contract reward"
                  value={reward || ''}
                  onChange={(e) =>
                    setReward(Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, '') || '0', 10) || 0))
                  }
                />
                {ocrResult?.ok && ocrResult.reward ? (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.green, marginTop: 3 }}>
                    ~ read {fmt(ocrResult.reward)} aUEC
                  </div>
                ) : tab === 'ocr' && hasOcr ? (
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 3 }}>
                    not read - enter it (top-right of the contract)
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1.2fr 70px 28px', gap: 12, padding: '0 0 8px', borderBottom: `1px solid ${C.lineStrong}` }}>
              {['COMMODITY', 'SCU', 'DESTINATION', 'BOXES', ''].map((h, i) => (
                <span key={h || i} style={{ fontFamily: F.display, fontSize: 10, letterSpacing: '0.18em', color: C.faint, textAlign: i === 1 || i === 3 ? 'right' : 'left' }}>
                  {h}
                </span>
              ))}
            </div>

            {rows.map((r) => {
              const boxes = r.scuAmount > 0 ? boxCount(calculateBoxes(r.scuAmount, maxBox)) : 0
              return (
                <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1.2fr 70px 28px', gap: 12, alignItems: 'start', padding: '10px 0', borderBottom: `1px solid ${C.lineSoft}` }}>
                  <div>
                    <Typeahead
                      value={r.commodity}
                      options={commodityNames}
                      onChange={(v) => update(r.key, { commodity: v })}
                      onSelect={(v) => update(r.key, { commodity: v })}
                      placeholder="Hydrogen Fuel"
                    />
                    {r.ocrCommodity && <OcrHint hint={r.ocrCommodity} />}
                  </div>
                  <input
                    style={{ ...inputStyle, borderBottom: 0, fontFamily: F.mono, textAlign: 'right' }}
                    placeholder="0"
                    inputMode="numeric"
                    value={r.scuAmount || ''}
                    onChange={(e) => update(r.key, { scuAmount: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
                  />
                  <div>
                    <Typeahead
                      value={r.destination}
                      options={locationNames}
                      onChange={(v) => update(r.key, { destination: v })}
                      onSelect={(v) => update(r.key, { destination: v })}
                      placeholder="HUR-L5 High Course Station"
                    />
                    {r.ocrDestination && <OcrHint hint={r.ocrDestination} />}
                  </div>
                  <span style={{ fontFamily: F.mono, fontSize: 13, color: boxes ? C.body : C.faint, textAlign: 'right', paddingTop: 7 }}>{boxes} box</span>
                  <Btn
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                    style={{ border: 0, background: 'transparent', color: C.faint, cursor: 'pointer', display: 'flex', justifyContent: 'center', padding: 2, marginTop: 6 }}
                    hoverStyle={{ color: C.red }}
                    title="Remove objective"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </Btn>
                </div>
              )
            })}

            <Btn
              onClick={() => setRows((rs) => [...rs, newRow()])}
              style={{ marginTop: 14, border: `1px dashed rgba(255,255,255,0.22)`, background: 'transparent', color: '#b6bec0', fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', padding: '9px 14px', cursor: 'pointer', width: '100%' }}
              hoverStyle={{ border: `1px dashed ${C.acc}`, color: C.text, textShadow: GLOW }}
            >
              + ADD ANOTHER OBJECTIVE
            </Btn>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: `1px solid ${C.lineStrong}` }}>
          {calibrating ? (
            <Btn
              onClick={() => setCalibrating(false)}
              style={{
                border: `1px solid ${C.acc}`,
                background: C.accFillStrong,
                color: C.text,
                textShadow: GLOW,
                fontFamily: F.display,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.14em',
                padding: '9px 18px',
                cursor: 'pointer'
              }}
            >
              DONE - BACK TO CAPTURE
            </Btn>
          ) : (
          <>
          <Btn
            onClick={onClose}
            style={{ border: `1px solid rgba(255,255,255,0.18)`, background: 'transparent', color: C.body, fontFamily: F.display, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', padding: '9px 18px', cursor: 'pointer' }}
            hoverStyle={{ border: `1px solid #fff`, color: C.text, textShadow: GLOW }}
          >
            {isContributeMode && contributed ? 'CLOSE' : 'CANCEL'}
          </Btn>
          {isContributeMode ? (
            (() => {
              const disabled = !collecting || !rawEdit.trim() || contributed
              return (
                <Btn
                  onClick={contribute}
                  disabled={disabled}
                  style={{
                    border: `1px solid ${disabled ? 'rgba(255,255,255,0.14)' : C.acc}`,
                    background: disabled ? 'transparent' : C.accFillStrong,
                    color: disabled ? C.faint : C.text,
                    textShadow: disabled ? 'none' : GLOW,
                    fontFamily: F.display,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    padding: '9px 18px',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                  }}
                >
                  {contributed ? 'CONTRIBUTED ✓' : 'CONTRIBUTE SAMPLE'}
                </Btn>
              )
            })()
          ) : (
            <Btn
              onClick={submit}
              disabled={!showEditor || !canSubmit}
              style={{
                border: `1px solid ${!showEditor || !canSubmit ? 'rgba(255,255,255,0.14)' : C.acc}`,
                background: !showEditor || !canSubmit ? 'transparent' : C.accFillStrong,
                color: !showEditor || !canSubmit ? C.faint : C.text,
                textShadow: !showEditor || !canSubmit ? 'none' : GLOW,
                fontFamily: F.display,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.14em',
                padding: '9px 18px',
                cursor: !showEditor || !canSubmit ? 'not-allowed' : 'pointer'
              }}
            >
              ADD TO MANIFEST
            </Btn>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  )
}

function OcrCapturePane({
  recognizing,
  engineLabel,
  available,
  detail,
  error,
  onCapture,
  onAdjustCrop
}: {
  recognizing: boolean
  engineLabel: string
  available: boolean
  detail?: string
  error?: string
  onCapture: () => void
  onAdjustCrop: () => void
}): React.ReactElement {
  return (
    <div style={{ padding: '36px 24px', textAlign: 'center', fontFamily: F.body }}>
      <div style={{ fontFamily: F.body, fontSize: 13, color: C.dim, lineHeight: 1.6, marginBottom: 22 }}>
        Open the contract on your mobiGlas, then capture the screen. SuperCargo reads the
        objectives and matches them to the live UEX commodity &amp; location lists, and you confirm
        before anything is added.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Btn
          onClick={onCapture}
          disabled={recognizing || !available}
          style={{
            border: `1px solid ${recognizing || !available ? 'rgba(255,255,255,0.16)' : C.acc}`,
            background: recognizing || !available ? 'transparent' : C.accFillStrong,
            color: recognizing || !available ? C.faint : C.text,
            textShadow: recognizing || !available ? 'none' : GLOW,
            fontFamily: F.display,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.16em',
            padding: '12px 26px',
            cursor: recognizing || !available ? 'not-allowed' : 'pointer'
          }}
          hoverStyle={recognizing || !available ? {} : { background: C.accFill }}
        >
          {recognizing ? 'RECOGNIZING...' : 'CAPTURE CONTRACT SCREEN'}
        </Btn>
        <Btn
          onClick={onAdjustCrop}
          style={{
            border: `1px solid rgba(255,255,255,0.2)`,
            background: 'transparent',
            color: C.body,
            fontFamily: F.display,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.16em',
            padding: '12px 20px',
            cursor: 'pointer'
          }}
          hoverStyle={{ border: `1px solid ${C.acc}`, color: C.text, textShadow: GLOW }}
        >
          ADJUST CAPTURE AREA
        </Btn>
      </div>
      <div style={{ marginTop: 18, fontFamily: F.mono, fontSize: 11, color: C.faint }}>
        Engine: {engineLabel}
        {detail ? ` · ${detail}` : ''}
      </div>
      {!available && (
        <div style={{ marginTop: 10, fontFamily: F.body, fontSize: 12, color: C.amber }}>
          OCR engine unavailable. Use Manual Entry, or check the OCR section in Settings.
        </div>
      )}
      {error && (
        <div style={{ marginTop: 10, fontFamily: F.body, fontSize: 12, color: C.red }}>{error}</div>
      )}
    </div>
  )
}

function ContributePane({
  imageDataUrl,
  confidence,
  ms,
  onRecapture,
  onAdjustCrop,
  recognizing,
  value,
  onChange,
  collecting,
  contributed
}: {
  imageDataUrl?: string
  confidence: number
  ms: number
  onRecapture: () => void
  onAdjustCrop: () => void
  recognizing: boolean
  value: string
  onChange: (v: string) => void
  collecting: boolean
  contributed: boolean
}): React.ReactElement {
  const conf = Math.round(confidence)
  const confColor = conf >= 80 ? C.green : conf >= 55 ? C.amber : C.red

  if (contributed) {
    return (
      <div
        style={{
          border: `1px solid ${C.green}`,
          padding: '24px 16px',
          textAlign: 'center',
          fontFamily: F.body,
          fontSize: 13,
          color: C.green,
          lineHeight: 1.6
        }}
      >
        ✓ Sample contributed. Thank you. This helps train the OCR for everyone.
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.text }}>
          NO HAULING OBJECTIVES
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: confColor }}>{conf}% confidence</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>{ms} ms</span>
        <span style={{ flex: 1 }} />
        <MiniBtn onClick={onAdjustCrop}>ADJUST CROP</MiniBtn>
        <MiniBtn onClick={onRecapture} disabled={recognizing}>
          {recognizing ? 'RECAPTURING...' : 'RECAPTURE'}
        </MiniBtn>
      </div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, marginBottom: 12, lineHeight: 1.5 }}>
        This doesn&apos;t look like a hauling contract, so nothing will be added to the manifest. You can still
        help train the OCR by checking the capture and correcting the text below.
      </div>

      {/* large capture so the user can verify the crop AND read it */}
      <div style={labelStyle}>CAPTURED PANEL</div>
      {imageDataUrl ? (
        <img
          src={imageDataUrl}
          alt="captured contract panel"
          style={{
            display: 'block',
            width: '100%',
            maxHeight: 420,
            objectFit: 'contain',
            objectPosition: 'top',
            background: '#000',
            border: `1px solid ${C.lineStrong}`,
            marginBottom: 16
          }}
        />
      ) : (
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.amber, marginBottom: 16 }}>
          No preview available - recapture to try again.
        </div>
      )}
      <div style={{ fontFamily: F.body, fontSize: 11, color: C.faint, marginTop: -8, marginBottom: 16, lineHeight: 1.5 }}>
        If the panel isn&apos;t framed right, hit ADJUST CROP above, then RECAPTURE.
      </div>

      <div style={labelStyle}>CONTRACT TEXT (CORRECT TO MATCH THE SCREEN)</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={10}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid rgba(255,255,255,0.2)`,
          color: C.text,
          fontFamily: F.mono,
          fontSize: 13,
          lineHeight: 1.55,
          padding: 12,
          outline: 'none',
          resize: 'vertical'
        }}
        placeholder="(no text recognized - type what the contract panel shows)"
      />
      <div style={{ fontFamily: F.body, fontSize: 11, color: collecting ? C.dim : C.amber, marginTop: 8, lineHeight: 1.5 }}>
        {collecting
          ? 'Fix any misreads so the label matches the panel exactly, then contribute. Only this cropped panel image and your text are saved - nothing else.'
          : 'Turn on "Save training samples" or "Contribute training data" in Settings -> OCR to keep this. Without it, contributing does nothing.'}
      </div>
    </div>
  )
}

function OcrReviewBanner({
  imageDataUrl,
  confidence,
  ms,
  count,
  showRaw,
  rawText,
  onToggleRaw,
  onRecapture,
  onAdjustCrop,
  recognizing
}: {
  imageDataUrl?: string
  confidence: number
  ms: number
  count: number
  showRaw: boolean
  rawText: string
  onToggleRaw: () => void
  onRecapture: () => void
  onAdjustCrop: () => void
  recognizing: boolean
}): React.ReactElement {
  const conf = Math.round(confidence)
  const confColor = conf >= 80 ? C.green : conf >= 55 ? C.amber : C.red
  return (
    <div style={{ border: `1px solid ${C.lineStrong}`, padding: 12, marginBottom: 18, display: 'flex', gap: 14 }}>
      {imageDataUrl && (
        <img
          src={imageDataUrl}
          alt="captured contract panel"
          style={{ width: 200, maxHeight: 240, objectFit: 'contain', objectPosition: 'top', background: '#000', border: `1px solid ${C.line}`, flex: 'none' }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.16em', color: C.text }}>
            READ {count} OBJECTIVE{count === 1 ? '' : 'S'}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: confColor }}>{conf}% confidence</span>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>{ms} ms</span>
        </div>
        <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim, margin: '7px 0 10px', lineHeight: 1.5 }}>
          Review and correct below. Typeahead values were fuzzy-matched to UEX. Then confirm.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <MiniBtn onClick={onRecapture} disabled={recognizing}>
            {recognizing ? 'RECAPTURING...' : 'RECAPTURE'}
          </MiniBtn>
          <MiniBtn onClick={onAdjustCrop}>ADJUST CROP</MiniBtn>
          <MiniBtn onClick={onToggleRaw}>{showRaw ? 'HIDE RAW TEXT' : 'SHOW RAW TEXT'}</MiniBtn>
        </div>
        {showRaw && (
          <pre
            style={{
              marginTop: 10,
              maxHeight: 120,
              overflow: 'auto',
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${C.lineSoft}`,
              padding: 8,
              fontFamily: F.mono,
              fontSize: 11,
              color: C.body,
              whiteSpace: 'pre-wrap'
            }}
          >
            {rawText || '(no text recognized)'}
          </pre>
        )}
      </div>
    </div>
  )
}

function OcrHint({ hint }: { hint: { raw: string; score: number; matched: boolean } }): React.ReactElement {
  const pct = Math.round(hint.score * 100)
  const color = hint.matched ? (pct >= 85 ? C.green : C.amber) : C.red
  return (
    <div style={{ fontFamily: F.mono, fontSize: 10, color, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`read: "${hint.raw}" · ${pct}% match`}>
      {hint.matched ? `~ ${pct}%` : '⚠ unmatched'} · "{hint.raw}"
    </div>
  )
}

function MiniBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid rgba(255,255,255,0.18)`,
        background: 'transparent',
        color: disabled ? C.faint : C.body,
        fontFamily: F.display,
        fontSize: 10,
        letterSpacing: '0.14em',
        padding: '5px 10px',
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
      hoverStyle={disabled ? {} : { border: `1px solid ${C.acc}`, color: C.text }}
    >
      {children}
    </Btn>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <Btn
      onClick={onClick}
      style={{
        border: 0,
        background: 'transparent',
        color: active ? C.text : C.dim,
        textShadow: active ? GLOW : 'none',
        fontFamily: F.display,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.16em',
        padding: '12px 20px',
        cursor: 'pointer',
        borderBottom: `2px solid ${active ? C.acc : 'transparent'}`
      }}
      hoverStyle={active ? {} : { color: C.body }}
    >
      {children}
    </Btn>
  )
}
