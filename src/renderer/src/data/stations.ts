const CODE_RE = /^([A-Z]{2,4}-[A-Z0-9]{1,4})\b\s*(.*)$/
const LAGRANGE_RE = /-(L[1-5])$/i

const BODY: Record<string, string> = {
  HUR: 'Hurston',
  CRU: 'Crusader',
  ARC: 'ArcCorp',
  MIC: 'microTech',
  PYR: 'Pyro'
}

export interface SplitDestination {
  code: string
  name: string
  region: string
}

function regionFromCode(code: string): string {
  if (!code) return ''
  const body = BODY[code.slice(0, 3).toUpperCase()] ?? ''
  const lag = LAGRANGE_RE.exec(code)
  if (body && lag) return `${body} · ${lag[1].toUpperCase()} Lagrange Point`
  return body
}

export function splitDestination(raw: string): SplitDestination {
  const trimmed = raw.trim()
  const m = CODE_RE.exec(trimmed)
  const code = m ? m[1] : ''
  const name = m ? m[2] || trimmed : trimmed
  return { code, name, region: regionFromCode(code) }
}
