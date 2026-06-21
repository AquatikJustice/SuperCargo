# SuperCargo

A local desktop app for Star Citizen haulers who stack multiple contracts per run.
It watches the game log, reads your contract screens, and builds one consolidated
manifest (box-size math, route optimization, a 3D loading guide, and per-run
earnings) in a holographic-terminal UI.

> ### Star Citizen - Made by the Community
> SuperCargo is an **unofficial** Star Citizen community tool. It is **not** endorsed by,
> sponsored by, or affiliated with Cloud Imperium Games or Roberts Space Industries.
>
> Star Citizen®, Squadron 42®, Roberts Space Industries®, and Cloud Imperium® are registered
> trademarks of Cloud Imperium Rights LLC. All game content and related marks are the property
> of Cloud Imperium Rights LLC and Cloud Imperium Rights Ltd. See the
> [Star Citizen Fankit](https://robertsspaceindustries.com/en/fankit) and the Fankit & Fandom
> FAQ for community-use guidelines.
>
> The **"Made by the Community"** badge is an official Fankit asset, included under those
> guidelines in [`assets/MBTC-logos/`](assets/MBTC-logos/) (the app loads it from
> `src/renderer/public/made-by-community.png`). The Settings -> ABOUT panel always shows the
> text attribution above.

## Features

- **Game-log watcher** - tails `Game.log`, detecting hauling contract accept / objective /
  completion / abandon events live, with auto-detection of your Star Citizen install + channel.
- **Manifest** - every active contract's cargo merged into one view, grouped by **destination**
  or by **contract**, with per-stop SCU / box totals and a color-coded hold-capacity bar.
- **Route optimization** - a capacitated pickup-and-delivery solver orders your stops to
  minimize travel (real UEXcorp terminal distances when a token is set), and you can still
  drag to override.
- **3D cargo grid + loading guide** - a packed view of your hold and a per-destination,
  per-contract "what to pull from the freight elevator" walkthrough in load order.
- **OCR capture** - read the mobiGlas contract screen to fill in objectives, max box size,
  and reward; fuzzy-matched against the live UEX commodity / location lists for review.
- **Contracts + turn-in** - edit objectives, and on submit record a **full / partial / none**
  turn-in per stop. Partial payouts use the real game model (validated against `Game.log`:
  bracketed factor on delivered / required SCU, snapped to 250 aUEC) plus the 25% reputation line.
- **Runs & history** - work is grouped into **runs** (one trip = one run, rolls over when the
  manifest empties); History shows each run's contracts and earnings.
- **Compact overlay** - a small always-on-top "next stop" card you can pin over the game.
- **UEXcorp sync** - ships, freight locations (internal elevators + external loading docks),
  and commodities pulled live from the UEXcorp API and cached locally; a bundled snapshot is
  the offline fallback.
- **StarStrings (optional)** - when present, surfaces blueprint chances and reputation from
  the community contract-data layer.
- **Accessibility** - large, high-contrast text with an adjustable UI zoom.

## Requirements

- Windows
- Star Citizen installed (the app reads `Game.log`)
- A free [UEXcorp](https://uexcorp.space/api/apps) app token (optional, but enables live
  ship / location / commodity data and real route distances)

## Develop

```bash
npm install
npm run dev          # launch the app with HMR
npm run typecheck    # type-check main + renderer
```

The watcher reads the `Game.log` path from Settings. On first launch SuperCargo scans local
fixed drives for Star Citizen installs; you can also browse to a `Game.log` manually
(e.g. `B:\StarCitizen\LIVE\Game.log`).

## Build & release - **no GitHub Actions**

Releases are built and published **locally** so they consume **zero GitHub Actions minutes**.

```bash
npm run dist         # build the NSIS installer into release/ (no upload)
```

To publish a release to GitHub directly from your machine:

1. Create a personal access token with `repo` scope and export it, then:
   ```powershell
   $env:GH_TOKEN = "ghp_..."
   npm run publish    # builds + uploads installer + latest.yml as a DRAFT release
   ```
2. Publish the draft release on GitHub. Installed apps then auto-update from `latest.yml`.

> No `.github/workflows` are included on purpose.

## Project layout

```
src/
  shared/      types, box + payout math, route solver, contract parsing, ship roster, IPC channels
  main/        Electron main: window, log watcher + parser, OCR, install detect, store, updater, IPC
  preload/     contextBridge API (window.supercargo)
  renderer/    React UI (theme, zustand store, pages, components)
assets/        brand assets - SuperCargo logo source + the Fankit "Made by the Community" badge
```

## Credits

Community data sources: [UEXcorp](https://uexcorp.space) (ships, commodities, locations,
distances), [sc-cargo.space](https://sc-cargo.space) & [Ratjack](https://ratjack.net/Star-Citizen/Cargo-Grids/)
(cargo-grid layouts), and [scunpacked](https://github.com/StarCitizenWiki/scunpacked-data)
(datamined reference). Thank you.
