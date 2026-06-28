import React, { useState } from 'react'
import { useStore } from '../state/store'
import { C, F, GLOW } from '../theme'
import { Btn } from './ui'
import PrivacyPolicy from './PrivacyPolicy'

/** first-launch consent screen */
export default function Onboarding(): React.ReactElement {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)

  // upload defaults off, more sensitive
  const [capture, setCapture] = useState(true)
  const [contribute, setContribute] = useState(settings.contributeTrainingData)
  const [showPolicy, setShowPolicy] = useState(false)
  const [saving, setSaving] = useState(false)

  const finish = async (): Promise<void> => {
    setSaving(true)
    await updateSettings({
      onboarded: true,
      ocrAutoCapture: capture,
      contributeTrainingData: contribute
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.96)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto',
        padding: '48px 24px'
      }}
    >
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div
          style={{
            fontFamily: F.display,
            fontSize: 12,
            letterSpacing: '0.32em',
            color: C.acc,
            textShadow: GLOW,
            marginBottom: 10
          }}
        >
          WELCOME ABOARD
        </div>
        <h1 style={{ margin: '0 0 14px', fontFamily: F.display, fontSize: 38, color: C.text, lineHeight: 1.1 }}>
          SuperCargo
        </h1>
        <p style={{ margin: '0 0 28px', fontFamily: F.body, fontSize: 16, lineHeight: 1.6, color: C.textBody }}>
          SuperCargo watches your Star Citizen game log to pick up the hauling contracts you accept, then builds
          a packing plan and an optimized delivery route for your ship. Before you start, two quick choices. You can change both anytime in Settings.
        </p>

        <ConsentCard
          title="Screen capture (OCR)"
          on={capture}
          onToggle={() => setCapture((v) => !v)}
          recommended
        >
          The game log gives us your commodities, destinations and amounts, but never the max cargo box size,
          which we need to get your box counts right. With this on, SuperCargo briefly screenshots your display
          after you accept a contract to read that number. The image is processed on your PC and not saved or
          sent anywhere (unless you opt in below).
        </ConsentCard>

        <ConsentCard
          title="Help improve recognition (optional)"
          on={contribute}
          onToggle={() => setContribute((v) => !v)}
        >
          Share an anonymous picture of the contract panel plus the text you confirm, to help the app read
          contracts better. Tagged with a random ID only. No account, no personal info. Off by default; you can
          stop anytime.
        </ConsentCard>

        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowPolicy((v) => !v)}
            style={{
              border: 0,
              background: 'transparent',
              color: C.acc,
              cursor: 'pointer',
              fontFamily: F.body,
              fontSize: 14,
              padding: '6px 0',
              textDecoration: 'underline'
            }}
          >
            {showPolicy ? 'Hide privacy policy' : 'Read the full privacy policy'}
          </button>
          {showPolicy && (
            <div
              style={{
                marginTop: 12,
                padding: 18,
                border: `1px solid ${C.line}`,
                background: 'rgba(255,255,255,0.02)',
                maxHeight: 320,
                overflowY: 'auto'
              }}
            >
              <PrivacyPolicy />
            </div>
          )}
        </div>

        <div style={{ marginTop: 30, display: 'flex', justifyContent: 'flex-end' }}>
          <Btn
            onClick={() => void finish()}
            disabled={saving}
            style={{
              border: `1px solid ${C.acc}`,
              background: C.accFillStrong,
              color: C.text,
              textShadow: GLOW,
              fontFamily: F.display,
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '0.18em',
              padding: '13px 30px',
              cursor: saving ? 'default' : 'pointer'
            }}
            hoverStyle={{ background: 'rgba(255,210,30,0.26)' }}
          >
            {saving ? 'SAVING...' : 'GET STARTED'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

function ConsentCard({
  title,
  on,
  onToggle,
  recommended,
  children
}: {
  title: string
  on: boolean
  onToggle: () => void
  recommended?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${on ? C.accBorder : C.line}`,
        background: on ? C.accFill : 'transparent',
        padding: 18,
        marginBottom: 16,
        display: 'flex',
        gap: 18,
        alignItems: 'flex-start'
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontFamily: F.display, fontSize: 17, color: C.text }}>{title}</span>
          {recommended && (
            <span
              style={{
                fontFamily: F.display,
                fontSize: 10,
                letterSpacing: '0.16em',
                color: C.acc,
                border: `1px solid ${C.accBorder}`,
                padding: '2px 7px'
              }}
            >
              RECOMMENDED
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontFamily: F.body, fontSize: 14, lineHeight: 1.6, color: C.dim }}>{children}</p>
      </div>
      <Toggle on={on} onClick={onToggle} />
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): React.ReactElement {
  return (
    <div
      role="switch"
      aria-checked={on}
      onClick={onClick}
      style={{
        flex: 'none',
        width: 48,
        height: 24,
        marginTop: 2,
        cursor: 'pointer',
        background: on ? C.acc : 'rgba(255,255,255,0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        padding: 3
      }}
    >
      <div style={{ width: 18, height: 18, background: '#000' }} />
    </div>
  )
}
