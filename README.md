# SuperCargo

A desktop app for Star Citizen haulers who run several cargo contracts at once.
It brings all your contracts together into one manifest, with box-size math, an
optimized route, a 3D loading guide, and per-run earnings, in a mobiGlas-style
interface.

![The cargo manifest, grouped by destination](assets/screens/manifest.png)

## Download

Grab the latest build from the [Releases page](https://github.com/AquatikJustice/SuperCargo/releases).

- **Windows installer** (`SuperCargo-Setup-*.exe`) installs and auto-updates.
- **Windows portable** (`SuperCargo-Portable-*.exe`) is a single exe with no install.
- **Windows zip** (`SuperCargo-*-win.zip`) is the unpacked folder, drop it wherever.
- **Linux** (`SuperCargo-*.AppImage`) make it executable and run it (see Linux notes below).

The builds are not code-signed, so Windows SmartScreen may warn you on first run. Click
"More info", then "Run anyway".

### Linux notes

The Linux AppImage is **new and untested**, so treat it as experimental for now.

1. Make it executable: `chmod +x SuperCargo-*.AppImage` (or right-click, Properties, Allow executing).
2. Run it by double-clicking, or from a terminal: `./SuperCargo-*.AppImage`.
3. If it will not start, install FUSE: `sudo apt install libfuse2` on Debian/Ubuntu, or your
   distro's equivalent.

If you hit problems, please open an issue with your distro and what happened.

## Features

- **Automatic contract tracking.** Your hauling contracts show up in SuperCargo the moment you
  accept them in game, objectives and all, with nothing to type in by hand.
- **One manifest.** Every active contract's cargo in one place, grouped by destination or by
  contract, with per-stop SCU and box totals and a hold-capacity bar so you know if it all fits.
- **Loading Mode.** Tells you what to load at each pickup, where to put it on your ship, and what
  to drop along the way, so a multi-pickup run turns into a simple checklist.
- **Route optimization.** Orders your stops to keep travel down, and you can drag to reorder
  whenever you want.
- **3D cargo grid.** See your packed hold in 3D, plus a per-stop walkthrough of what to pull at
  each freight elevator, in the order you should load it.
- **OCR capture.** Read a contract straight off your mobiGlas screen to fill in its objectives,
  box size, and reward, then confirm before it lands on the manifest.
- **Edit anything.** Change any part of a contract after you add it: pickup, reward, rank, box
  size, and every objective.
- **Turn-in tracking.** Mark each stop as fully, partly, or not delivered, and get an accurate
  payout that handles partial hauls.
- **Runs and history.** Every trip is saved as a run, so you can look back at past hauls and what
  you earned.
- **Compact overlay.** A small always-on-top "next stop" card you can pin over the game.
- **Bundled game data.** Ship, location, and commodity info is built in and kept current, so
  there is no API key or account to set up.
- **StarStrings compatible.** If you run StarStrings, blueprint chances and reputation rewards
  show up too.

## Screenshots

Every accepted contract, with inline editing for anything the log did not give you:

![Contracts page](assets/screens/contracts.png)

The 3D cargo grid, color-coded by destination:

![3D cargo grid](assets/screens/cargo-grid.png)

Reading a contract screen with OCR:

![OCR capture](assets/screens/ocr-capture.png)

Or just add one by hand:

![Manual contract entry](assets/screens/manual-entry.png)

## Requirements

- Windows or Linux
- Star Citizen installed

## Credits

Community data sources: [UEXcorp](https://uexcorp.space) (ships, commodities, locations,
distances), [sc-cargo.space](https://sc-cargo.space) and [Ratjack](https://ratjack.net/Star-Citizen/Cargo-Grids/)
(cargo-grid layouts), and [scunpacked](https://github.com/StarCitizenWiki/scunpacked-data)
(datamined reference). Thank you.

> ### Star Citizen - Made by the Community
>
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
