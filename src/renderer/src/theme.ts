// Terminal palette and fonts, taken from the design mockup
// Bright yellow accent (#ffd21e),
// pure black background, amber/red kept for warnings.

// Text colors are kept on the bright side on purpose: most users are older or
// have low vision, so even the "dim" tiers stay readable on pure black.
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

/** Soft text glow used across the mockup. */
export const GLOW = '0 0 7px rgba(255,210,30,0.45)'
export const GLOW_SOFT = '0 0 5px rgba(255,210,30,0.20)'

/** One color per destination, picked by stop index. */
export const STOP_COLORS = [
  '#9fc6d6',
  '#7fb89e',
  '#c9b07e',
  '#a89bc4',
  '#d69b8a',
  '#8ab0c9',
  '#b3c47e'
] as const

export function stopColor(index: number): string {
  return STOP_COLORS[index % STOP_COLORS.length]
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

// UI zoom (text + layout scale for readability)
export const ZOOM_MIN = 0.9
export const ZOOM_MAX = 1.6
export const ZOOM_STEP = 0.05
export const ZOOM_DEFAULT = 1.1
export const clampZoom = (z: number): number =>
  Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100
