// local ocr drain/train runner, never deploys. see README.md

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const TRAIN_DIR = path.join(REPO, 'scripts', 'train')

const DATA_ROOT = path.join(REPO, 'training-data')
const SYNTH_DIR = path.join(DATA_ROOT, 'synthetic')
const HARVEST_DIR = path.join(DATA_ROOT, 'harvested')
const BUILD_DIR = path.join(DATA_ROOT, '_build')
const MODELS_DIR = path.join(REPO, 'models')
const STATE_FILE = path.join(HERE, '.state.json')
const LOG_FILE = path.join(HERE, 'train-log.jsonl')
const RUNS_DIR = path.join(HERE, 'runs')

const PYTHON = process.env.PYTHON || 'python'

const args = process.argv.slice(3) // argv[2] is the mode
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8')
}

function countLabels(dir) {
  const f = path.join(dir, 'labels.jsonl')
  if (!fs.existsSync(f)) return 0
  return fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => l.trim()).length
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd: opts.cwd || REPO, shell: false, env: process.env })
    let out = ''
    child.stdout.on('data', (d) => {
      out += d
      process.stdout.write(d)
    })
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited ${code}`))
    )
  })
}

async function drain() {
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error('SUPABASE_SECRET_KEY is not set - cannot drain. See README.md.')
    process.exit(1)
  }
  console.log(`[drain] pulling samples into ${HARVEST_DIR} and clearing the bucket...`)
  await run('node', [path.join(TRAIN_DIR, 'drain_supabase.mjs'), '--out', HARVEST_DIR, '--delete'])
  console.log(`[drain] harvested corpus now holds ${countLabels(HARVEST_DIR)} samples total.`)
}

function mergeInto(srcDir) {
  const labels = path.join(srcDir, 'labels.jsonl')
  if (!fs.existsSync(labels)) return 0
  let n = 0
  const outLabels = fs.createWriteStream(path.join(BUILD_DIR, 'labels.jsonl'), { flags: 'a' })
  for (const line of fs.readFileSync(labels, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    let rec
    try {
      rec = JSON.parse(t)
    } catch {
      continue
    }
    const from = path.join(srcDir, rec.image)
    const to = path.join(BUILD_DIR, rec.image)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    if (!fs.existsSync(to)) {
      try {
        fs.linkSync(from, to) // hard link, no extra disk
      } catch {
        fs.copyFileSync(from, to)
      }
    }
    outLabels.write(line.endsWith('\n') ? line : line + '\n')
    n++
  }
  outLabels.end()
  return n
}

async function ensureSynthetic(count) {
  if (countLabels(SYNTH_DIR) > 0) return
  console.log(`[train] no synthetic corpus yet -> generating ${count} samples into ${SYNTH_DIR}...`)
  await run('node', [path.join(REPO, 'scripts', 'gen-training-data.mjs'), '--count', String(count), '--out', SYNTH_DIR])
}

function parseMetrics(stdout) {
  let bestCer = null
  let accAtBest = null
  const re = /val_acc (\d+\.\d+)\s+val_cer (\d+\.\d+)/g
  let m
  while ((m = re.exec(stdout))) {
    const acc = parseFloat(m[1])
    const cer = parseFloat(m[2])
    if (bestCer === null || cer < bestCer) {
      bestCer = cer
      accAtBest = acc
    }
  }
  return { valCer: bestCer, valAcc: accAtBest }
}

async function train() {
  const minNew = parseInt(flag('min-new', '0'), 10)
  const epochs = flag('epochs', '30')
  const synthCount = parseInt(flag('synth-count', '20000'), 10)

  const state = readState()
  const harvestCount = countLabels(HARVEST_DIR)
  const newSince = harvestCount - (state.lastTrainHarvestCount || 0)
  if (minNew > 0 && newSince < minNew) {
    console.log(`[train] only ${newSince} new harvested samples (< --min-new ${minNew}) -> skipping.`)
    return
  }

  await ensureSynthetic(synthCount)

  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD_DIR, 'images'), { recursive: true })
  const nSynth = mergeInto(SYNTH_DIR)
  const nHarvest = mergeInto(HARVEST_DIR)
  console.log(`[train] merged corpus: ${nSynth} synthetic + ${nHarvest} harvested = ${nSynth + nHarvest} lines`)
  if (nSynth + nHarvest === 0) {
    console.error('[train] nothing to train on - no synthetic or harvested data.')
    process.exit(1)
  }

  const ts = stamp()
  const modelOut = path.join(MODELS_DIR, ts, 'crnn')
  fs.mkdirSync(RUNS_DIR, { recursive: true })

  console.log(`[train] training -> ${modelOut} (epochs=${epochs}, device=auto)...`)
  const out = await run(
    PYTHON,
    ['train.py', '--data', BUILD_DIR, '--out', modelOut, '--epochs', String(epochs)],
    { cwd: TRAIN_DIR }
  )
  fs.writeFileSync(path.join(RUNS_DIR, `${ts}.log`), out, 'utf8')

  console.log('[train] exporting ONNX...')
  await run(PYTHON, ['export_onnx.py', '--model', path.join(modelOut, 'crnn.pt')], { cwd: TRAIN_DIR })

  const metrics = parseMetrics(out)
  const entry = {
    at: new Date().toISOString(),
    model: path.relative(REPO, path.join(modelOut, 'model.onnx')),
    synthetic: nSynth,
    harvested: nHarvest,
    newHarvestedSinceLast: newSince,
    epochs: Number(epochs),
    valAcc: metrics.valAcc,
    valCer: metrics.valCer
  }
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8')
  writeState({
    lastTrainHarvestCount: harvestCount,
    lastTrainAt: entry.at,
    lastModel: entry.model,
    lastValCer: metrics.valCer,
    lastValAcc: metrics.valAcc
  })

  console.log(
    `\n[train] done. model.onnx -> ${entry.model}\n` +
      `        val_acc=${metrics.valAcc ?? '?'}  val_cer=${metrics.valCer ?? '?'}\n` +
      `        (review the numbers in train-log.jsonl; nothing is deployed automatically.)`
  )
}

function status() {
  const state = readState()
  console.log('OCR pipeline status')
  console.log(`  synthetic corpus : ${countLabels(SYNTH_DIR)} samples (${SYNTH_DIR})`)
  console.log(`  harvested corpus : ${countLabels(HARVEST_DIR)} samples (${HARVEST_DIR})`)
  console.log(`  last train       : ${state.lastTrainAt || 'never'}`)
  if (state.lastModel) console.log(`  last model       : ${state.lastModel} (val_cer ${state.lastValCer ?? '?'})`)
  console.log(`  secret key set   : ${process.env.SUPABASE_SECRET_KEY ? 'yes' : 'NO (drain will fail)'}`)
}

const mode = process.argv[2]
const table = { drain, train, status }
if (!table[mode]) {
  console.error('usage: orchestrate.mjs <drain|train|status> [--min-new N] [--epochs E] [--synth-count C]')
  process.exit(1)
}
Promise.resolve(table[mode]()).catch((e) => {
  console.error(e)
  process.exit(1)
})
