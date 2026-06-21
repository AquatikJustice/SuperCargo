// Physical dimensions of Star Citizen cargo boxes, in grid cells (1 cell =
// 1.25m = one 1 SCU cube). Confirmed against the in-game containers:
//   - Boxes never exceed 2 wide or 2 tall; they only grow LONGER as SCU rises.
//   - A box must lie flat. It can rotate 90 degrees in the horizontal plane (swap w/l)
//     but can never be tipped onto its end (h is fixed).
// w*l*h always equals the box's SCU.

export interface BoxDims {
  /** width in cells (across), before any horizontal rotation. */
  w: number
  /** length in cells (depth), before any horizontal rotation. */
  l: number
  /** height in cells, fixed; a box can never be stood on its end. */
  h: number
}

/** SCU size -> physical footprint+height in cells. */
export const BOX_DIMS: Record<number, BoxDims> = {
  1: { w: 1, l: 1, h: 1 },
  2: { w: 1, l: 2, h: 1 },
  4: { w: 2, l: 2, h: 1 },
  8: { w: 2, l: 2, h: 2 },
  16: { w: 2, l: 4, h: 2 },
  24: { w: 2, l: 6, h: 2 },
  32: { w: 2, l: 8, h: 2 }
}

/** Footprint area (w*l) of a box on the floor. */
export function boxFootprint(scu: number): number {
  const d = BOX_DIMS[scu]
  return d ? d.w * d.l : 0
}

/** Height in cells of a box (1 for <=4 SCU, 2 for >=8 SCU). */
export function boxHeight(scu: number): number {
  return BOX_DIMS[scu]?.h ?? 1
}
