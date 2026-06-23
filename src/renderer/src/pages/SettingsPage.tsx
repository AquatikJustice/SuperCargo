import React, { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, ZOOM_DEFAULT, clampZoom } from '../theme'
import PageHeader, { PAGE_PADDING } from '../components/PageHeader'
import { Btn } from '../components/ui'
import OcrCalibrator from '../components/OcrCalibrator'
import PrivacyPolicy from '../components/PrivacyPolicy'
import type { DisplayInfo, ContractDataStatus } from '@shared/types'
import {
  APP_NAME,
  FANKIT_URL,
  UNOFFICIAL_NOTICE,
  TRADEMARK_NOTICE,
  MADE_BY_COMMUNITY,
  DATA_CREDITS
} from '@shared/legal'

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '210px 1fr',
  gap: 16,
  alignItems: 'center',
  padding: '15px 0',
  borderBottom: `1px solid ${C.lineSoft}`
}

const keyStyle: React.CSSProperties = { fontFamily: F.body, fontSize: 14, color: C.body }

function Section({ title }: { title: string }): React.ReactElement {
  return (
    <div
      style={{
        fontFamily: F.display,
        fontSize: 11,
        letterSpacing: '0.2em',
        color: C.acc,
        paddingBottom: 9,
        borderBottom: `1px solid ${C.lineStrong}`,
        margin: '30px 0 6px'
      }}
    >
      {title}
    </div>
  )
}

export default function SettingsPage(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const watcher = useStore((s) => s.watcher)
  const appVersion = useStore((s) => s.appVersion)
  const update = useStore((s) => s.update)
  const checkForUpdates = useStore((s) => s.checkForUpdates)
  const ships = useStore((s) => s.ships)
  const locations = useStore((s) => s.locations)
  const commodities = useStore((s) => s.commodities)
  const scanSession = useStore((s) => s.scanSession)
  const ocrEngine = useStore((s) => s.ocrEngine)
  const refreshOcrEngine = useStore((s) => s.refreshOcrEngine)

  const [detecting, setDetecting] = useState(false)
  const [installs, setInstalls] = useState<Record<string, string>>({})
  const [ordered, setOrdered] = useState<string[]>([])
  const [scanMsg, setScanMsg] = useState('')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [hotkey, setHotkey] = useState(settings.ocrHotkey)
  const [contractData, setContractData] = useState<ContractDataStatus | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [telemetry, setTelemetry] = useState<{ uploaded: number; queued: number } | null>(null)

  useEffect(() => {
    setHotkey(settings.ocrHotkey)
  }, [settings.ocrHotkey])

  useEffect(() => {
    void window.supercargo.ocrListDisplays().then(setDisplays)
    void refreshOcrEngine()
    void window.supercargo.getContractDataStatus().then(setContractData)
    void window.supercargo.getTelemetryStatus().then(setTelemetry)
    const t = setInterval(() => void window.supercargo.getTelemetryStatus().then(setTelemetry), 15000)
    return () => clearInterval(t)
  }, [refreshOcrEngine])

  const rescanContracts = async (): Promise<void> => {
    setRescanning(true)
    try {
      setContractData(await window.supercargo.rescanContractData())
    } finally {
      setRescanning(false)
    }
  }

  useEffect(() => {
    void (async () => {
      const res = await window.supercargo.detectInstalls()
      setInstalls(res.installs)
      setOrdered(res.ordered)
    })()
  }, [])

  const redetect = async (): Promise<void> => {
    setDetecting(true)
    const res = await window.supercargo.detectInstalls()
    setInstalls(res.installs)
    setOrdered(res.ordered)
    setDetecting(false)
  }

  const browse = async (): Promise<void> => {
    const path = await window.supercargo.pickLogFile()
    if (path) await updateSettings({ gameLogPath: path })
  }

  const selectChannel = async (channel: string): Promise<void> => {
    const path = installs[channel]
    if (path) await updateSettings({ gameChannel: channel, gameLogPath: path })
    else await updateSettings({ gameChannel: channel })
  }

  return (
    <div style={{ padding: PAGE_PADDING, maxWidth: 820 }}>
      <PageHeader title="SETTINGS" subtitle="Game integration · ship · display · updates" />

      <Section title="GAME" />
      <div style={rowStyle}>
        <span style={keyStyle}>Game log path</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 12,
              color: settings.gameLogPath ? C.textBody : C.faint,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1
            }}
            title={settings.gameLogPath}
          >
            {settings.gameLogPath || 'Not set - browse or auto-detect'}
          </span>
          {watcher.connected ? (
            <Pill color={C.green} text="CONNECTED" />
          ) : settings.gameLogPath ? (
            <Pill color={C.amber} text="WAITING" />
          ) : (
            <Pill color={C.red} text="NO PATH" />
          )}
          <SmallBtn onClick={browse}>BROWSE...</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Detected installs</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {ordered.length === 0 ? (
            <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>None found on local drives</span>
          ) : (
            ordered.map((ch) => {
              const active = settings.gameChannel === ch && settings.gameLogPath === installs[ch]
              return (
                <Btn
                  key={ch}
                  onClick={() => void selectChannel(ch)}
                  style={{
                    border: `1px solid ${active ? C.acc : 'rgba(255,255,255,0.16)'}`,
                    background: active ? C.accFill : 'transparent',
                    color: active ? C.text : C.body,
                    textShadow: active ? GLOW : 'none',
                    fontFamily: F.display,
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    padding: '6px 12px',
                    cursor: 'pointer'
                  }}
                  hoverStyle={active ? {} : { border: `1px solid ${C.acc}` }}
                >
                  {ch}
                </Btn>
              )
            })
          )}
          <SmallBtn onClick={() => void redetect()}>{detecting ? 'SCANNING...' : 'RE-SCAN'}</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Watcher</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: watcher.connected ? C.green : C.amber }}>
            {watcher.connected ? 'CONNECTED' : watcher.error || 'IDLE'}
          </span>
          <SmallBtn onClick={() => void window.supercargo.restartWatcher()}>RESTART</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Scan current session</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            Pull in active contracts already accepted before SuperCargo was opened
          </span>
          <SmallBtn
            onClick={() => {
              setScanMsg('')
              void scanSession().then((n) =>
                setScanMsg(n > 0 ? `Imported ${n} contract${n === 1 ? '' : 's'}` : 'No active contracts found')
              )
            }}
          >
            SCAN
          </SmallBtn>
          {scanMsg && (
            <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: C.green }}>{scanMsg}</span>
          )}
        </div>
      </div>

      <Section title="DATA" />
      <div style={{ ...rowStyle, borderBottom: `1px solid ${C.lineSoft}`, alignItems: 'start' }}>
        <span style={{ ...keyStyle, paddingTop: 2 }}>Game data</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
            {ships.length} ships · {locations.length} locations · {commodities.length} commodities
          </span>
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            Bundled with the app and kept current automatically. No account or token needed.
          </span>
        </div>
      </div>

      <Section title="DISPLAY" />
      <div style={rowStyle}>
        <span style={keyStyle}>Text size</span>
        <ZoomControl
          zoom={settings.uiZoom ?? 1.1}
          onChange={(z) => void updateSettings({ uiZoom: z })}
        />
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Always on top</span>
        <Toggle on={settings.alwaysOnTop} onClick={() => void updateSettings({ alwaysOnTop: !settings.alwaysOnTop })} />
      </div>

      <Section title="OCR CAPTURE" />
      <div style={rowStyle}>
        <span style={keyStyle}>Engine</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {[
            { id: 'tesseract', label: 'TESSERACT' }
            // Custom (ONNX) is hidden until a trained model ships.
          ].map((e) => {
            const active = (settings.ocrEngine || 'tesseract') === e.id
            return (
              <Btn
                key={e.id}
                onClick={() => void updateSettings({ ocrEngine: e.id }).then(() => refreshOcrEngine())}
                style={{
                  border: `1px solid ${active ? C.acc : 'rgba(255,255,255,0.16)'}`,
                  background: active ? C.accFill : 'transparent',
                  color: active ? C.text : C.body,
                  textShadow: active ? GLOW : 'none',
                  fontFamily: F.display,
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  padding: '6px 12px',
                  cursor: 'pointer'
                }}
                hoverStyle={active ? {} : { border: `1px solid ${C.acc}` }}
              >
                {e.label}
              </Btn>
            )
          })}
          {ocrEngine ? (
            ocrEngine.available ? (
              <Pill color={ocrEngine.assetsReady ? C.green : C.amber} text={ocrEngine.assetsReady ? 'READY' : 'NEEDS DATA'} />
            ) : (
              <Pill color={C.red} text="UNAVAILABLE" />
            )
          ) : null}
          {ocrEngine?.detail && (
            <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>{ocrEngine.detail}</span>
          )}
          <SmallBtn onClick={() => void refreshOcrEngine()}>REFRESH</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Capture display</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {displays.length === 0 ? (
            <span style={{ fontFamily: F.body, fontSize: 13, color: C.dim }}>Detecting...</span>
          ) : (
            displays.map((d) => {
              const active = settings.ocrDisplayId === d.id || (!settings.ocrDisplayId && d.primary)
              return (
                <Btn
                  key={d.id}
                  onClick={() => void updateSettings({ ocrDisplayId: d.id })}
                  style={{
                    border: `1px solid ${active ? C.acc : 'rgba(255,255,255,0.16)'}`,
                    background: active ? C.accFill : 'transparent',
                    color: active ? C.text : C.body,
                    textShadow: active ? GLOW : 'none',
                    fontFamily: F.display,
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    padding: '6px 12px',
                    cursor: 'pointer'
                  }}
                  hoverStyle={active ? {} : { border: `1px solid ${C.acc}` }}
                >
                  {d.label}
                  {d.primary ? ' ·★' : ''}
                </Btn>
              )
            })
          )}
        </div>
      </div>
      <div style={{ ...rowStyle, gridTemplateColumns: '210px 1fr', alignItems: 'start' }}>
        <span style={{ ...keyStyle, paddingTop: 4 }}>Crop region</span>
        <OcrCalibrator />
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Capture hotkey</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={hotkey}
            placeholder="e.g. CommandOrControl+Shift+C"
            onChange={(e) => setHotkey(e.target.value)}
            onBlur={() => {
              if (hotkey.trim() !== settings.ocrHotkey) void updateSettings({ ocrHotkey: hotkey.trim() })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: `1px solid rgba(255,255,255,0.16)`,
              color: C.text,
              fontFamily: F.mono,
              fontSize: 12,
              padding: '8px 12px',
              outline: 'none'
            }}
          />
          <span style={{ fontFamily: F.body, fontSize: 11, color: C.faint, flex: 'none' }}>global · blank to disable</span>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Auto-capture on accept</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Toggle on={settings.ocrAutoCapture} onClick={() => void updateSettings({ ocrAutoCapture: !settings.ocrAutoCapture })} />
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            Read the contract screen automatically after the log reports an accept
          </span>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Capture delay</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={settings.ocrCaptureDelay}
            onChange={(e) => void updateSettings({ ocrCaptureDelay: Number(e.target.value) })}
            style={{ width: 200, accentColor: C.acc }}
          />
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>{settings.ocrCaptureDelay.toFixed(1)} s</span>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Save training samples</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Toggle on={settings.ocrSaveSamples} onClick={() => void updateSettings({ ocrSaveSamples: !settings.ocrSaveSamples })} />
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            Keep each confirmed capture (image + your corrections) to train a custom model later
          </span>
        </div>
      </div>

      <Section title="CONTRIBUTE TRAINING DATA" />
      <div style={rowStyle}>
        <span style={keyStyle}>Share captures</span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <Toggle
            on={settings.contributeTrainingData}
            onClick={() =>
              void updateSettings({ contributeTrainingData: !settings.contributeTrainingData }).then(() =>
                window.supercargo.getTelemetryStatus().then(setTelemetry)
              )
            }
          />
          <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim, lineHeight: 1.6, maxWidth: 540 }}>
            Anonymously upload the <strong style={{ color: C.body }}>grayscale contract-panel crop</strong> and your
            confirmed text to help train the shared OCR model. Opt-in, with no account or identity. Only the cropped panel
            (which you see in the capture window) is sent, and only when you confirm a read. It uploads in the background and
            retries if you&apos;re offline.
          </span>
        </div>
      </div>
      {settings.contributeTrainingData && (
        <div style={rowStyle}>
          <span style={keyStyle}>Contributed</span>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
            {telemetry ? `${telemetry.uploaded} uploaded` : '-'}
            {telemetry && telemetry.queued > 0 && <span style={{ color: C.amber }}> · {telemetry.queued} queued</span>}
          </span>
        </div>
      )}

      <Section title="CONTRACT DATA · STARSTRINGS" />
      <div style={rowStyle}>
        <span style={keyStyle}>Status</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {contractData?.active ? (
            <>
              <Pill color={C.green} text="DETECTED" />
              <span style={{ fontFamily: F.mono, fontSize: 13, color: C.body }}>
                {contractData.titles} contracts · {contractData.blueprintContracts} with blueprints
              </span>
            </>
          ) : (
            <>
              <Pill color={C.dim} text="NOT DETECTED" />
              <span style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
                Optional. Install StarStrings to surface blueprint chances &amp; reputation.
              </span>
            </>
          )}
          <SmallBtn onClick={() => void rescanContracts()}>{rescanning ? 'SCANNING...' : 'RESCAN'}</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>contracts.ini override</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={settings.contractsDataPath}
            placeholder="Auto-located next to Game.log - set only to override"
            onChange={(e) => void updateSettings({ contractsDataPath: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            onBlur={() => void rescanContracts()}
            style={{
              flex: 1,
              background: 'transparent',
              border: `1px solid rgba(255,255,255,0.16)`,
              color: C.text,
              fontFamily: F.mono,
              fontSize: 12,
              padding: '8px 12px',
              outline: 'none'
            }}
          />
        </div>
      </div>

      <Section title="UPDATES" />
      <div style={rowStyle}>
        <span style={keyStyle}>Version</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: F.mono, fontSize: 13, color: C.text, textShadow: GLOW }}>v{appVersion || '-'}</span>
          <UpdateStatus />
          <SmallBtn onClick={() => void checkForUpdates()}>CHECK NOW</SmallBtn>
        </div>
      </div>
      <div style={rowStyle}>
        <span style={keyStyle}>Auto-check on launch</span>
        <Toggle on={settings.autoCheckUpdates} onClick={() => void updateSettings({ autoCheckUpdates: !settings.autoCheckUpdates })} />
      </div>
      {update?.kind === 'downloaded' && (
        <div style={{ ...rowStyle, borderBottom: 'none' }}>
          <span style={keyStyle}>Update ready</span>
          <SmallBtn onClick={() => void window.supercargo.quitAndInstall()}>RESTART &amp; INSTALL</SmallBtn>
        </div>
      )}

      <Section title="ABOUT" />
      <AboutBlock />
    </div>
  )
}

function AboutBlock(): React.ReactElement {
  // The "Made by the Community" badge is a Fankit asset. Show it if the PNG
  // exists at renderer/public/made-by-community.png, otherwise hide the image
  // and keep the text credit, which is always required.
  const [logoOk, setLogoOk] = useState(true)
  const [showPolicy, setShowPolicy] = useState(false)
  return (
    <div style={{ padding: '15px 0 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        {logoOk && (
          <img
            src="./made-by-community.png"
            alt={MADE_BY_COMMUNITY}
            onError={() => setLogoOk(false)}
            style={{ height: 44, width: 'auto', opacity: 0.95 }}
          />
        )}
        <div>
          <div style={{ fontFamily: F.display, fontSize: 13, letterSpacing: '0.12em', color: C.acc, textShadow: GLOW }}>
            {MADE_BY_COMMUNITY.toUpperCase()}
          </div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: C.dim }}>
            {APP_NAME} ·{' '}
            <a href={FANKIT_URL} style={{ color: C.body, textDecoration: 'underline' }}>
              Star Citizen Fankit
            </a>
          </div>
        </div>
      </div>
      <p style={{ fontFamily: F.body, fontSize: 12, lineHeight: 1.6, color: C.dim, margin: '0 0 8px', maxWidth: 720 }}>
        {UNOFFICIAL_NOTICE}
      </p>
      <p style={{ fontFamily: F.body, fontSize: 12, lineHeight: 1.6, color: C.faint, margin: '0 0 12px', maxWidth: 720 }}>
        {TRADEMARK_NOTICE}
      </p>
      <div style={{ fontFamily: F.body, fontSize: 12, lineHeight: 1.7, color: C.faint, maxWidth: 720 }}>
        Community data sources:{' '}
        {DATA_CREDITS.map((c, i) => (
          <React.Fragment key={c.name}>
            {i > 0 && ' · '}
            <a href={c.url} style={{ color: C.body, textDecoration: 'underline' }} title={c.use}>
              {c.name}
            </a>
          </React.Fragment>
        ))}
      </div>

      <div style={{ marginTop: 18, borderTop: `1px solid ${C.lineSoft}`, paddingTop: 14 }}>
        <button
          onClick={() => setShowPolicy((v) => !v)}
          style={{
            border: 0,
            background: 'transparent',
            color: C.acc,
            cursor: 'pointer',
            fontFamily: F.display,
            fontSize: 12,
            letterSpacing: '0.14em',
            padding: 0
          }}
        >
          {showPolicy ? '▾ PRIVACY POLICY' : '▸ PRIVACY POLICY'}
        </button>
        {showPolicy && (
          <div style={{ marginTop: 14, maxWidth: 720 }}>
            <PrivacyPolicy />
          </div>
        )}
      </div>
    </div>
  )
}

function UpdateStatus(): React.ReactElement | null {
  const update = useStore((s) => s.update)
  if (!update) return null
  const map: Record<string, { text: string; color: string }> = {
    checking: { text: 'CHECKING...', color: C.dim },
    available: { text: `UPDATE AVAILABLE${'version' in update ? ` v${update.version}` : ''}`, color: C.acc },
    none: { text: 'UP TO DATE', color: C.green },
    downloading: { text: `DOWNLOADING ${'percent' in update ? update.percent : 0}%`, color: C.acc },
    downloaded: { text: 'DOWNLOADED', color: C.green },
    error: { text: 'UPDATE ERROR', color: C.red }
  }
  const m = map[update.kind]
  if (!m) return null
  return <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color: m.color }}>{m.text}</span>
}

function Pill({ color, text }: { color: string; text: string }): React.ReactElement {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 'none' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      <span style={{ fontFamily: F.display, fontSize: 11, letterSpacing: '0.14em', color }}>{text}</span>
    </span>
  )
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
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

function ZoomControl({ zoom, onChange }: { zoom: number; onChange: (z: number) => void }): React.ReactElement {
  const pct = Math.round(zoom * 100)
  const btn: React.CSSProperties = {
    width: 38,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid rgba(255,255,255,0.2)`,
    background: 'transparent',
    color: C.text,
    fontFamily: F.display,
    fontWeight: 600,
    cursor: 'pointer',
    lineHeight: 1
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Btn
          onClick={() => onChange(clampZoom(zoom - ZOOM_STEP))}
          disabled={zoom <= ZOOM_MIN}
          style={{ ...btn, fontSize: 15, opacity: zoom <= ZOOM_MIN ? 0.4 : 1 }}
          hoverStyle={zoom <= ZOOM_MIN ? {} : { border: `1px solid ${C.acc}`, textShadow: GLOW }}
          title="Smaller text"
        >
          A-
        </Btn>
        <div
          style={{
            minWidth: 64,
            textAlign: 'center',
            fontFamily: F.mono,
            fontSize: 14,
            color: C.text,
            padding: '0 4px'
          }}
        >
          {pct}%
        </div>
        <Btn
          onClick={() => onChange(clampZoom(zoom + ZOOM_STEP))}
          disabled={zoom >= ZOOM_MAX}
          style={{ ...btn, fontSize: 19, opacity: zoom >= ZOOM_MAX ? 0.4 : 1 }}
          hoverStyle={zoom >= ZOOM_MAX ? {} : { border: `1px solid ${C.acc}`, textShadow: GLOW }}
          title="Larger text"
        >
          A+
        </Btn>
      </div>
      {pct !== Math.round(ZOOM_DEFAULT * 100) && (
        <Btn
          onClick={() => onChange(ZOOM_DEFAULT)}
          style={{
            border: 0,
            background: 'transparent',
            color: C.dim,
            fontFamily: F.display,
            fontSize: 11,
            letterSpacing: '0.14em',
            cursor: 'pointer',
            padding: '4px 2px'
          }}
          hoverStyle={{ color: C.text }}
        >
          RESET
        </Btn>
      )}
      <span style={{ fontFamily: F.body, fontSize: 12, color: C.faint }}>
        Scales the whole app. Shortcut: Ctrl +/- (Ctrl 0 resets).
      </span>
    </div>
  )
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }): React.ReactElement {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{ cursor: disabled ? 'default' : 'pointer', display: 'flex', opacity: disabled ? 0.5 : 1 }}
    >
      <div
        style={{
          width: 40,
          height: 18,
          background: on ? C.acc : 'rgba(255,255,255,0.14)',
          display: 'flex',
          alignItems: 'center',
          padding: 2,
          justifyContent: on ? 'flex-end' : 'flex-start'
        }}
      >
        <div style={{ width: 14, height: 14, background: '#000' }} />
      </div>
    </div>
  )
}
