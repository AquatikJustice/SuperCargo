// dim tiers stay bright for low-vision
export const C = {
  black: '#000000',
  acc: '#ffd21e',
  accDeep: '#c79a14',
  text: '#eef6fc',
  textBody: '#dcebf4',
  body: '#dde2e4',
  dim: '#bcc6cb',
  faint: '#a4adb1',
  ghost: '#8d9396',
  green: '#5fd089',
  purple: '#7c74c8',
  amber: '#e6b65e',
  red: '#ec7470',
  line: 'rgba(255,255,255,0.12)',
  lineSoft: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.20)',
  lineFaint: 'rgba(255,255,255,0.09)',
  accFill: 'rgba(255,210,30,0.10)',
  accFillStrong: 'rgba(255,210,30,0.18)',
  accBorder: 'rgba(255,210,30,0.45)'
} as const

export const F = {
  display: "'Rajdhani', system-ui, sans-serif",
  body: "'Saira', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace"
} as const

export const GLOW = '0 0 7px rgba(255,210,30,0.45)'
export const GLOW_SOFT = '0 0 5px rgba(255,210,30,0.20)'

// golden-angle stepping clustered too green; hand-picked hues alternate warm/cool instead
const STOP_HUES: [number, number, number][] = [
  [0, 85, 66],   // red
  [212, 90, 64], // blue
  [32, 95, 58],  // orange
  [265, 80, 72], // violet
  [145, 62, 52], // green
  [325, 90, 70], // pink
  [184, 70, 50]  // cyan
]

export function stopColor(index: number): string {
  const [h, s, l] = STOP_HUES[index % STOP_HUES.length]
  const wrap = Math.floor(index / STOP_HUES.length) % 3
  return `hsl(${h}, ${s}%, ${l - wrap * 10}%)`
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

// distances come in gigameters; show the largest unit that reads >= 1
export function fmtDistance(gm: number): string {
  const m = Math.max(0, gm) * 1e9
  if (m >= 1e9) return `${(m / 1e9).toFixed(1)} Gm`
  if (m >= 1e6) return `${(m / 1e6).toFixed(1)} Mm`
  if (m >= 1e3) return `${(m / 1e3).toFixed(1)} km`
  return `${m.toFixed(1)} m`
}

export const ZOOM_MIN = 0.9
export const ZOOM_MAX = 1.6
export const ZOOM_STEP = 0.05
export const ZOOM_DEFAULT = 1.1
export const clampZoom = (z: number): number =>
  Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100
