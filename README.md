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

## Credits

Community data sources: [UEXcorp](https://uexcorp.space) (ships, commodities, locations,
distances), [sc-cargo.space](https://sc-cargo.space) & [Ratjack](https://ratjack.net/Star-Citizen/Cargo-Grids/)
(cargo-grid layouts), and [scunpacked](https://github.com/StarCitizenWiki/scunpacked-data)
(datamined reference). Thank you.
