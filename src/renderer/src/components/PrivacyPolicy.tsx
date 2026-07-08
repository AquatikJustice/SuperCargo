import React from 'react'
import { C, F } from '../theme'

// shown in onboarding and settings
export const PRIVACY_UPDATED = '2026-07-05'

interface Section {
  heading: string
  body: string[]
}

const SECTIONS: Section[] = [
  {
    heading: 'The short version',
    body: [
      'SuperCargo runs entirely on your PC. It reads your Star Citizen game log and (if you turn it on) takes screenshots of your screen to read your hauling contracts and build your manifest.',
      'The only thing sent by default is a small anonymous usage snapshot (how many people use the app and which features get used); you can turn it off in Settings. Everything else, like the OCR training uploads, is strictly opt-in.'
    ]
  },
  {
    heading: 'What it reads on your PC',
    body: [
      'Game log: SuperCargo watches your Star Citizen Game.log to notice when you accept or finish a contract. It is read locally and never leaves your machine.',
      'UEX API key: if you add one, it is stored locally and sent only to UEXcorp to sync ship, commodity and location data.'
    ]
  },
  {
    heading: 'Screen capture (OCR)',
    body: [
      'To read details the game log does not include (mainly the max cargo box size), SuperCargo can take a screenshot of your display and read the contract panel from it. This is OFF by default; you choose whether to enable it.',
      'The screenshot is processed on your computer to extract text. The image itself is not saved or sent anywhere, unless you opt in to the training program below.',
      'A capture grabs your whole display for a moment, so anything on screen at that instant is in the image while it is processed. You can disable capture, change its hotkey, or narrow the capture region at any time in Settings.'
    ]
  },
  {
    heading: 'Helping improve recognition (optional, off by default)',
    body: [
      'Only if you turn this on, SuperCargo uploads a cropped, grayscale image of the contract panel together with the text you confirmed, to help train a better recognition model.',
      'Uploads are tagged with a random ID generated on your device. They are not tied to your name, account, or computer, and no other personal information is attached.',
      'You can turn this off at any time in Settings; turning it off stops all future uploads. Please avoid capturing anything you do not want shared while this is enabled.'
    ]
  },
  {
    heading: 'Anonymous usage stats (on by default)',
    body: [
      'On launch SuperCargo sends a small anonymous snapshot so we can see roughly how many people use it and which features are worth our time: a random device ID, the app version and platform, which OCR engine you use and how accurately it reads your contracts (how many of the fields it reads you have to correct), your screen resolution (so we can spot resolutions the OCR reads poorly), the ships you have hauled with, and a few toggle settings (like the cargo-spacing option).',
      'It is tied only to the random ID, not to your name, account, or computer. It never includes your contracts, screenshots, game log, or any personal information. It is sent at most about once a day.',
      'You can turn it off any time under Settings > Usage Stats; turning it off stops all future snapshots.'
    ]
  },
  {
    heading: 'Where your data lives',
    body: [
      "Your settings, manifest, history, and any saved OCR samples are stored in SuperCargo's folder in your operating system's local application-data directory. Removing the app and that folder removes them."
    ]
  },
  {
    heading: 'What it does NOT do',
    body: [
      'No user accounts or sign-in. No advertising, no third-party analytics or ad trackers. Your data is never sold. The only network traffic is: the anonymous usage snapshot (off if you disable it), UEXcorp syncing (if you add a key), update checks, and opt-in training uploads.'
    ]
  },
  {
    heading: 'Not affiliated with CIG',
    body: [
      'SuperCargo is an unofficial, fan-made tool. It is not affiliated with, endorsed by, or sponsored by Cloud Imperium Games. Star Citizen and related marks are trademarks of their respective owners.'
    ]
  },
  {
    heading: 'Changes',
    body: [
      `This policy may change as features evolve; the date above reflects the current version (last updated ${PRIVACY_UPDATED}).`
    ]
  }
]

export default function PrivacyPolicy(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {SECTIONS.map((s) => (
        <section key={s.heading}>
          <h3
            style={{
              margin: '0 0 8px',
              fontFamily: F.display,
              fontSize: 16,
              letterSpacing: '0.08em',
              color: C.acc,
              textTransform: 'uppercase'
            }}
          >
            {s.heading}
          </h3>
          {s.body.map((p, i) => (
            <p
              key={i}
              style={{
                margin: '0 0 8px',
                fontFamily: F.body,
                fontSize: 15,
                lineHeight: 1.6,
                color: C.textBody
              }}
            >
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  )
}
