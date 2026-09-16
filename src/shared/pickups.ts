import type { DeliveryObjective } from './types'

// game only shows a total; last unknown stop is subtraction
export function pickupAmounts(o: DeliveryObjective): (number | null)[] {
  const n = o.pickups?.length ?? 0
  if (n === 0) return []
  if (n === 1) return [o.scuAmount]
  const out = Array.from({ length: n }, (_, i) => o.pickupScu?.[i] ?? null)
  if (out.filter((v) => v === null).length === 1) {
    const rest = o.scuAmount - out.reduce<number>((a, v) => a + (v ?? 0), 0)
    if (rest >= 0) out[out.indexOf(null)] = rest
  }
  return out
}

export function uncountedScu(o: DeliveryObjective): number {
  const amounts = pickupAmounts(o)
  if (!amounts.length || !amounts.some((v) => v === null)) return 0
  return Math.max(0, o.scuAmount - amounts.reduce<number>((a, v) => a + (v ?? 0), 0))
}

export function hasUncounted(o: DeliveryObjective): boolean {
  return pickupAmounts(o).some((v) => v === null)
}
