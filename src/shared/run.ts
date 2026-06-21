// A "run" groups the hauls you accept, load, and deliver together. Its id labels
// the current manifest and is stamped onto every finished contract in History,
// so a run's cargo and earnings can be reviewed as one unit.
//
// A new run starts automatically when the manifest is empty and a fresh contract
// comes in (one trip = one run), or manually via "Start new run".

function todayMmdd(now: Date): string {
  return String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
}

// Run letters count up A, B, ... Z, then double to AA, BB, ... ZZ, then AAA, and
// so on. 0 -> A, 25 -> Z, 26 -> AA, 51 -> ZZ, 52 -> AAA.
function letterFor(seq: number): string {
  return String.fromCharCode(65 + (seq % 26)).repeat(Math.floor(seq / 26) + 1)
}

// Reverse of letterFor for ids we generated (one repeated letter). Returns -1 for
// any other shape, so a foreign or legacy id can't throw off the count.
function seqOf(letters: string): number {
  if (!/^([A-Z])\1*$/.test(letters)) return -1
  return (letters.length - 1) * 26 + (letters.charCodeAt(0) - 65)
}

/** Next run id for today, e.g. "0619-A": MMDD plus a letter that counts up from
 *  the runs already used today (A, B, ..., Z, AA, BB, ...). Date-based with no
 *  system prefix, because a single run can span Stanton / Pyro / Nyx, so naming
 *  it after one system (the old "STN-") would mislead. Pass the run ids already
 *  in play (current run + History) so the letter never repeats within a day. */
export function newRunId(existingIds: string[] = []): string {
  const prefix = `${todayMmdd(new Date())}-`
  let max = -1
  for (const id of existingIds) {
    if (id.startsWith(prefix)) max = Math.max(max, seqOf(id.slice(prefix.length)))
  }
  return prefix + letterFor(max + 1)
}
