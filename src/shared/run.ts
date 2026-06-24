// run id groups one trip's contracts

function todayMmdd(now: Date): string {
  return String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
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

// e.g. "0619-A"
// pass existing ids so letters don't repeat within a day
export function newRunId(existingIds: string[] = []): string {
  const prefix = `${todayMmdd(new Date())}-`
  let max = -1
  for (const id of existingIds) {
    if (id.startsWith(prefix)) max = Math.max(max, seqOf(id.slice(prefix.length)))
  }
  return prefix + letterFor(max + 1)
}
