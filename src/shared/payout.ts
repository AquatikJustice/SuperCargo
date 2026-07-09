// factor table from SCMDB.net, treat as community reference not gospel

/** completion ratio (0..1) -> reward multiplier */
export function payoutFactor(ratio: number): number {
  if (ratio >= 1) return 1
  if (ratio > 0.75) return 0.76
  if (ratio > 0.5) return 0.45
  if (ratio > 0.25) return 0.15
  return 0
}

// payouts snap to multiples of 250; nearest-250 matched live samples 2026-06-21
const PAYOUT_STEP = 250

export function snapPayout(n: number): number {
  return Math.round(n / PAYOUT_STEP) * PAYOUT_STEP
}

export function partialPayout(reward: number, deliveredScu: number, totalScu: number): number {
  if (totalScu <= 0) return snapPayout(reward) // no objectives, treat as full
  return snapPayout(reward * payoutFactor(deliveredScu / totalScu))
}

/** your slice of an evenly-split shared reward */
export function sharedCut(reward: number, split: number): number {
  return snapPayout(reward / Math.max(1, split))
}

/** earnings estimate: your cut scaled by completion; the log's actual wins over this */
export function estimatePayout(reward: number, completionPct: number, split = 1): number {
  return snapPayout((reward / Math.max(1, split)) * payoutFactor(completionPct))
}

/** scu needed to hit the 25% line, rounded up */
export function repLineScu(totalScu: number): number {
  return Math.ceil(totalScu * 0.25)
}
