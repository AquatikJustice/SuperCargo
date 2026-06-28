// one trip's contracts, MMDDYY-letter

function todayStamp(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const yy = String(now.getFullYear() % 100).padStart(2, '0')
  return mm + dd + yy
}

// 0 -> A, 25 -> Z, 26 -> AA, 52 -> AAA
function letterFor(seq: number): string {
  return String.fromCharCode(65 + (seq % 26)).repeat(Math.floor(seq / 26) + 1)
}

// -1 on foreign/legacy shapes so they don't skew the count
function seqOf(letters: string): number {
  if (!/^([A-Z])\1*$/.test(letters)) return -1
  return (letters.length - 1) * 26 + (letters.charCodeAt(0) - 65)
}

// dedupe a day's letters
export function newRunId(existingIds: string[] = []): string {
  const prefix = `${todayStamp(new Date())}-`
  let max = -1
  for (const id of existingIds) {
    if (id.startsWith(prefix)) max = Math.max(max, seqOf(id.slice(prefix.length)))
  }
  return prefix + letterFor(max + 1)
}

// year-stamp old MMDD ids
const LEGACY_YEAR = '26'
export function migrateRunId(id: string): string {
  return /^\d{4}-[A-Z]+$/.test(id) ? id.slice(0, 4) + LEGACY_YEAR + id.slice(4) : id
}
