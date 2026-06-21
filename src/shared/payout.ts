// Hauling-contract partial payout. A contract has an in-game SUBMIT that turns in
// whatever cargo you've delivered and pays a FRACTION of the full reward based on
// how much you turned in (delivered SCU / total required SCU). Crossing the 25%
// line also unlocks most of the contract's reputation, which is why running a
// contract to ~25% and submitting ("partial run") is popular.
//
// Factor table, SOURCE: SCMDB.net. Provenance is UNVERIFIED (could be datamined
// game files, community knowledge, or trial-and-error testing, unknown), so
// treat these as community reference values, not gospel:
//
//   completion        reward x
//   0-25%             0
//   26-50%            0.15
//   51-75%            0.45
//   76-99%            0.76
//   100%              1
//
// The "26 / 51 / 76" lower bounds are just the next whole percent above each
// boundary (the table is shown in integer percent). We compute on the real ratio,
// so the true thresholds are 0.25 / 0.50 / 0.75 / 1.0, e.g. exactly 25% pays 0,
// anything above 25% up to 50% pays 0.15, and so on.

/** Completion ratio (0..1) -> reward multiplier. */
export function payoutFactor(ratio: number): number {
  if (ratio >= 1) return 1
  if (ratio > 0.75) return 0.76
  if (ratio > 0.5) return 0.45
  if (ratio > 0.25) return 0.15
  return 0
}

// SC snaps contract payouts to whole multiples of 250 aUEC. Verified live
// 2026-06-21: a 53,000-reward contract delivered to 96.9% paid 40,250, exactly
// 53000 x 0.76 = 40,280 snapped to the nearest 250. Both observed partial payouts
// (40,250 and 43,250) and full rewards are x250 multiples. (Round-vs-floor is
// indistinguishable from current data; nearest-250 matches both samples.)
const PAYOUT_STEP = 250

/** Snap an aUEC payout to the nearest 250, the way the game settles contract pay. */
export function snapPayout(n: number): number {
  return Math.round(n / PAYOUT_STEP) * PAYOUT_STEP
}

/** Final payout = full reward x factor(delivered / total), snapped to 250 aUEC.
 *  This is the game's *estimate*; for archived contracts prefer the real payout
 *  logged in Game.log (`Awarded N aUEC`) when available. */
export function partialPayout(reward: number, deliveredScu: number, totalScu: number): number {
  if (totalScu <= 0) return snapPayout(reward) // no objectives, treat as full
  return snapPayout(reward * payoutFactor(deliveredScu / totalScu))
}

/** SCU you must turn in to reach the 25% reputation line. Always rounds UP, so
 *  hitting this number guarantees you're at/over 25%. */
export function repLineScu(totalScu: number): number {
  return Math.ceil(totalScu * 0.25)
}
