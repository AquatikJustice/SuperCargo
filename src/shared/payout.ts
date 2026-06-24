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

/** snap payout to nearest 250 */
export function snapPayout(n: number): number {
  return Math.round(n / PAYOUT_STEP) * PAYOUT_STEP
}

/** estimated payout, snapped */
export function partialPayout(reward: number, deliveredScu: number, totalScu: number): number {
  if (totalScu <= 0) return snapPayout(reward) // no objectives, treat as full
  return snapPayout(reward * payoutFactor(deliveredScu / totalScu))
}

/** scu needed to hit the 25% line, rounded up */
export function repLineScu(totalScu: number): number {
  return Math.ceil(totalScu * 0.25)
}
