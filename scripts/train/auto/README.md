# OCR pipeline automation (local, scheduled)

Automates the **download + train** half of the custom-OCR loop on your own
machine. It drains the uploaded samples daily and retrains periodically. It does
**not** deploy or ship anything - a trained `model.onnx` just lands in
`models/<timestamp>/crnn/` for you to look at.

> **Nothing is scheduled yet.** These scripts exist and work, but no task is
> registered until *you* run `register-tasks.ps1`. Run it when the pipeline has
> real data to chew on (i.e. once it's out to your org mates and samples are
> flowing).

## What runs

| Mode  | Command | What it does |
|-------|---------|--------------|
| drain | `node scripts/train/auto/orchestrate.mjs drain` | `drain_supabase.mjs --delete` into `training-data/harvested/`, clearing the bucket. |
| train | `node scripts/train/auto/orchestrate.mjs train [--min-new N] [--epochs E] [--synth-count C]` | Merge `synthetic/` + `harvested/` -> `_build/`, run `train.py`, `export_onnx.py`, log val metrics. |
| status| `node scripts/train/auto/orchestrate.mjs status` | Show corpus sizes, last train, whether the secret key is set. |

- `--min-new N` - skip training unless >=N new harvested samples have arrived since
  the last run (the weekly task uses `--min-new 200` so it doesn't burn a run on
  nothing).
- First train auto-generates `--synth-count` synthetic samples (default 20000) if
  `training-data/synthetic/` is empty.
- Runs append to `train-log.jsonl`; full trainer output per run goes to `runs/<ts>.log`.

## One-time setup

1. **Secret key** (for drain) - set it as a *user* environment variable so the
   scheduled task inherits it. **Never commit it.**
   ```powershell
   setx SUPABASE_SECRET_KEY "sb_secret_xxxxx"
   ```
   (Open a new terminal afterward so it's in the environment.)
2. **Python env** (for train) - from `scripts/train/`:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\activate
   pip install -r requirements.txt   # install torch for your GPU first
   ```
   `train.cmd` auto-activates `scripts/train/.venv` if it exists.

## Dry-run by hand first

```powershell
node scripts\train\auto\orchestrate.mjs status
node scripts\train\auto\orchestrate.mjs drain        # needs the key + real samples
node scripts\train\auto\orchestrate.mjs train --epochs 2   # quick smoke test
```

## Turn the schedule on (when ready)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\train\auto\register-tasks.ps1
```
Registers **SuperCargo OCR Drain** (daily 04:00) and **SuperCargo OCR Train**
(Sunday 05:00, only if >=200 new samples). They run as you, while you're logged on
(fine for an always-on PC). Edit the times / threshold at the top of that script.

Turn it back off any time:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\train\auto\unregister-tasks.ps1
```

## Deliberately out of scope

Getting a trained model to end users (bundling it into a release so the GitHub
auto-update ships it) is **not** part of this. This stays a local harvest-and-train
loop; the model output is yours to review.
