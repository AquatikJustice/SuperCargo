import type { BoxAllocation } from './types'

// largest first, greedy fill depends on it
export const BOX_SIZES = [32, 24, 16, 8, 4, 2, 1] as const

export const MAX_BOX_OPTIONS = [...BOX_SIZES].reverse()

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

export function boxCount(boxes: BoxAllocation[]): number {
  return boxes.reduce((a, b) => a + b.count, 0)
}

export function boxScu(boxes: BoxAllocation[]): number {
  return boxes.reduce((a, b) => a + b.count * b.scuSize, 0)
}

export function boxBreakdown(boxes: BoxAllocation[]): string {
  return boxes.map((b) => `${b.count}×${b.scuSize}`).join(' + ')
}

// "2×32 + 1×24 + 1×2" from a flat list of box sizes, largest first
export function listBreakdown(sizes: number[]): string {
  const counts = new Map<number, number>()
  for (const s of sizes) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([s, c]) => `${c}×${s}`)
    .join(' + ')
}

export function boxList(boxes: BoxAllocation[]): number[] {
  const out: number[] = []
  for (const b of boxes) for (let i = 0; i < b.count; i++) out.push(b.scuSize)
  return out
}
