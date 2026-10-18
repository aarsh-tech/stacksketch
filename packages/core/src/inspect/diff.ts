import type { Rect } from './stacking'

/**
 * Where a page screenshot drifts from the design: compare two RGBA images of
 * the same size pixel by pixel, then group the differences into boxes worth
 * looking at. Pixels that are transparent in either image (outside the
 * design, once it's nudged) aren't compared.
 */

export interface PixelDiff {
  width: number
  height: number
  /** pixels compared: both images have something there */
  compared: number
  /** pixels that differ by more than the threshold */
  changed: number
  /** changed / compared, 0 to 1 */
  ratio: number
  /** one byte per pixel: 1 differs, 0 matches or wasn't compared */
  mask: Uint8Array
  /** boxes around the clusters of differences, biggest first */
  regions: Rect[]
}

export interface DiffOptions {
  /** how far a channel may be off (0 to 255) before the pixel counts as different; default 40, which ignores anti-aliasing */
  threshold?: number
  /** the size of the cells differences are grouped in, in pixels; default 8 */
  tile?: number
  /** at most this many regions; default 40 */
  maxRegions?: number
}

export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number, options: DiffOptions = {}): PixelDiff {
  const threshold = options.threshold ?? 40
  const tile = Math.max(1, Math.round(options.tile ?? 8))
  const maxRegions = options.maxRegions ?? 40
  const mask = new Uint8Array(width * height)
  const cols = Math.ceil(width / tile)
  const rows = Math.ceil(height / tile)
  const perTile = new Uint16Array(cols * rows)
  let compared = 0
  let changed = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const i = p * 4
      if (a[i + 3] === 0 || b[i + 3] === 0) continue
      compared++
      const off = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]))
      if (off <= threshold) continue
      mask[p] = 1
      changed++
      perTile[Math.floor(y / tile) * cols + Math.floor(x / tile)]++
    }
  }

  // a cell counts when it has at least two different pixels, so a lone stray pixel doesn't make a region
  const hit = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && perTile[r * cols + c] >= 2
  const seen = new Uint8Array(cols * rows)
  const regions: Rect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (seen[r * cols + c] || !hit(c, r)) continue
      let minC = c
      let maxC = c
      let minR = r
      let maxR = r
      const stack = [[c, r]]
      seen[r * cols + c] = 1
      while (stack.length) {
        const [cc, rr] = stack.pop()!
        minC = Math.min(minC, cc)
        maxC = Math.max(maxC, cc)
        minR = Math.min(minR, rr)
        maxR = Math.max(maxR, rr)
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nc = cc + dc
            const nr = rr + dr
            if (hit(nc, nr) && !seen[nr * cols + nc]) {
              seen[nr * cols + nc] = 1
              stack.push([nc, nr])
            }
          }
      }
      const x = minC * tile
      const y = minR * tile
      regions.push({ x, y, width: Math.min(width, (maxC + 1) * tile) - x, height: Math.min(height, (maxR + 1) * tile) - y })
    }
  }
  regions.sort((p, q) => q.width * q.height - p.width * p.height)

  return { width, height, compared, changed, ratio: compared ? changed / compared : 0, mask, regions: regions.slice(0, maxRegions) }
}
