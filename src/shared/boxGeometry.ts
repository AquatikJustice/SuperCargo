// box dims in grid cells, 1 cell = 1 scu cube

export interface BoxDims {
  w: number
  l: number
  // fixed, never rotates onto its end
  h: number
}

export const BOX_DIMS: Record<number, BoxDims> = {
  1: { w: 1, l: 1, h: 1 },
  2: { w: 1, l: 2, h: 1 },
  4: { w: 2, l: 2, h: 1 },
  8: { w: 2, l: 2, h: 2 },
  16: { w: 2, l: 4, h: 2 },
  24: { w: 2, l: 6, h: 2 },
  32: { w: 2, l: 8, h: 2 }
}

export function boxFootprint(scu: number): number {
  const d = BOX_DIMS[scu]
  return d ? d.w * d.l : 0
}

export function boxHeight(scu: number): number {
  return BOX_DIMS[scu]?.h ?? 1
}
