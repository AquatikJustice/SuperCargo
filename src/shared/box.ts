// Box size calculator (spec section 7).
// Fills greedily from the largest allowed box down. Ported from the design
// mockup's boxesFor() so the app and the mockup give the same result.

import type { BoxAllocation } from './types'

/** Available SCU box sizes, largest first. */
export const BOX_SIZES = [32, 24, 16, 8, 4, 2, 1] as const

export const MAX_BOX_OPTIONS = [1, 2, 4, 8, 16, 24, 32] as const

/**
 * Split `totalScu` into the fewest boxes no larger than `maxBoxSize`,
 * filling greedily from the largest allowed size down.
 *
 * Examples (from spec 7.2):
 *   calculateBoxes(140, 16) -> [{16,8},{8,1},{4,1}]   (140 SCU, 10 boxes)
 *   calculateBoxes(46, 16)  -> [{16,2},{8,1},{4,1},{2,1}] (46 SCU, 5 boxes)
 */
export function calculateBoxes(totalScu: number, maxBoxSize: number): BoxAllocation[] {
  const sizes = BOX_SIZES.filter((s) => s <= maxBoxSize)
  const boxes: BoxAllocation[] = []
  let remaining = Math.max(0, Math.floor(totalScu))

  for (const size of sizes) {
    if (remaining <= 0) break
    const count = Math.floor(remaining / size)
    if (count > 0) {
      boxes.push({ scuSize: size, count })
      remaining -= count * size
    }
  }
  return boxes
}

/** Total number of boxes in an allocation. */
export function boxCount(boxes: BoxAllocation[]): number {
  return boxes.reduce((a, b) => a + b.count, 0)
}

/** Total SCU represented by an allocation. */
export function boxScu(boxes: BoxAllocation[]): number {
  return boxes.reduce((a, b) => a + b.count * b.scuSize, 0)
}

/** Human-readable breakdown, e.g. "8x16 + 1x8 + 1x4". */
export function boxBreakdown(boxes: BoxAllocation[]): string {
  return boxes.map((b) => `${b.count}×${b.scuSize}`).join(' + ')
}

/** Flat list of individual box sizes, e.g. [16,16,8,4] - used by the cargo grid. */
export function boxList(boxes: BoxAllocation[]): number[] {
  const out: number[] = []
  for (const b of boxes) for (let i = 0; i < b.count; i++) out.push(b.scuSize)
  return out
}
