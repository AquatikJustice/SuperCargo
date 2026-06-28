# SuperCargo FAQ

## Getting started

**What is SuperCargo?**
A free desktop app for Star Citizen haulers. It takes a pile of hauling contracts and
turns them into one plan: a combined manifest, box-size math, an ordered route, a 3D
loading guide, and your earnings per run.

**Is it really free?**
Yes. Free and open source, no cost, no ads, no account needed.

**How do I get it?**
Grab the latest build from the [Releases page](https://github.com/AquatikJustice/SuperCargo/releases).
There's a Windows installer, a portable exe, and a zip, plus an experimental Linux AppImage.

**Windows / SmartScreen says it's unsafe. Is something wrong?**
No. The builds aren't code-signed (certificates are pricey for a free tool), so Windows
shows its generic "unknown app" warning. Click "More info", then "Run anyway". After that
the installer keeps itself updated.

**Does it run on Mac?**
Not yet. Windows is the main platform, with Linux as experimental.

## Safety and privacy

**Will this get me banned? Does it touch the game?**
No. SuperCargo never modifies, injects into, or automates Star Citizen. It only reads the
game's own log file to follow your contracts, the same read-only approach many community
tools use. It is not a cheat or a hack.

**How does it know about my contracts then?**
It watches the game log for hauling contract accepts, objectives, completions, and abandons
as they happen. Read-only, and it ignores everything else.

**What's the screen-capture / OCR feature?**
OCR stands for Optical Character Recognition, which reads text out of an image. The log
doesn't include max box size or reward, so SuperCargo can optionally read the mobiGlas
contract screen to fill those in for you to confirm. It's opt-in and only runs when you
ask it to.

**Does it send my data anywhere?**
By default, no. Nothing leaves your machine. There's a single opt-in setting to share
anonymized capture samples that help train the reader. It's off unless you switch it on,
and you can switch it back off anytime.

**Where's my data kept?**
Locally on your PC. Your manifest, run history, and settings stay on your machine.

## Using it

**It says "cargo grid not optimized for this ship." What's that?**
Each ship's real cargo bays are hand-mapped so the 3D loading guide is accurate. Ships not
mapped yet show that warning and fall back to a basic layout. More are being added. If yours
is wrong or missing, let us know (see below).

**A cargo grid or ship stat looks wrong.**
Report it. Those fixes sync out to everyone automatically on the next data update, no
reinstall needed.

**What's StarStrings, and do I need it?**
Optional. If you run StarStrings, SuperCargo can also show blueprint chances and reputation.
Everything else works fine without it.

**How do updates work?**
The app updates itself, and its ship, location, and commodity data refreshes on its own.
You don't reinstall for data fixes.

## Getting help

**Where do I report bugs, request features, or flag bad data?**
Open an [issue on GitHub](https://github.com/AquatikJustice/SuperCargo/issues), or join the
community Discord and post in the matching channel. One item per report, and search first
so we skip duplicates.
