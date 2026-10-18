import { describe, expect, it } from 'vitest'

import { checkType, compareStacking, diffPixels, gapBetween, insetWithin, qaReport, stackingReasons, stackingTree } from './index'
import type { ScannedElement, StyleSnapshot } from './index'

const base: StyleSnapshot = { position: 'static', zIndex: 'auto', opacity: '1', transform: 'none', filter: 'none' }
const rect = { x: 0, y: 0, width: 100, height: 100 }
const el = (label: string, parent: number, style: Partial<StyleSnapshot> = {}): ScannedElement => ({ label, parent, style: { ...base, ...style }, rect })

describe('stacking reasons', () => {
  it('says why an element starts a stacking context', () => {
    expect(stackingReasons(base)).toEqual([])
    expect(stackingReasons({ ...base, position: 'relative' })).toEqual([])
    expect(stackingReasons({ ...base, position: 'relative', zIndex: '10' })).toEqual(['it has position: relative and z-index: 10'])
    expect(stackingReasons({ ...base, position: 'sticky' })).toEqual(['it has position: sticky, which always starts one'])
    expect(stackingReasons({ ...base, zIndex: '2', parentDisplay: 'flex' })).toEqual(['it’s a flex item with z-index: 2'])
    expect(stackingReasons({ ...base, transform: 'matrix(1, 0, 0, 1, 0, 0)', opacity: '0.9' })).toEqual(['it has opacity: 0.9 (anything below 1)', 'it has a transform'])
    expect(stackingReasons({ ...base, willChange: 'transform, scroll-position', isolation: 'isolate' })).toEqual(['it has isolation: isolate', 'it has will-change: transform'])
    expect(stackingReasons(base, true)[0]).toMatch(/root element/)
  })
})

describe('stacking tree', () => {
  // the classic bug: a modal with z-index 9999 inside a transformed card, behind a header with z-index 10
  const page = [
    el('html', -1),
    el('header.top', 0, { position: 'fixed', zIndex: '10' }),
    el('main', 0),
    el('div.card', 2, { transform: 'translateX(0px)' }),
    el('div.modal', 3, { position: 'fixed', zIndex: '9999' }),
    el('div.toast', 0, { position: 'absolute', zIndex: '-1' }),
  ]
  const tree = stackingTree(page)!

  it('nests contexts and orders them back to front', () => {
    expect(tree.children.map((c) => c.label)).toEqual(['div.toast', 'div.card', 'header.top'])
    expect(tree.children[1].children.map((c) => [c.label, c.depth])).toEqual([['div.modal', 2]])
  })

  it('explains why one paints above another', () => {
    expect(compareStacking(tree, 1, 4)).toBe(
      'Inside html, header.top paints above div.card: z-index 10 beats auto. A z-index set deeper inside either one can’t change that.',
    )
    expect(compareStacking(tree, 4, 3)).toBe('div.modal is inside div.card, so it paints on top of it.')
  })
})

describe('measuring', () => {
  it('measures gaps edge to edge', () => {
    expect(gapBetween({ x: 0, y: 0, width: 50, height: 20 }, { x: 74, y: 30, width: 10, height: 10 })).toMatchObject({ horizontal: 24, vertical: 10, text: '24px to the right and 10px below' })
    expect(gapBetween(rect, { x: 10, y: 10, width: 5, height: 5 }).text).toBe('They overlap.')
    expect(insetWithin({ x: 16, y: 8, width: 60, height: 20 }, rect)).toEqual({ top: 8, right: 24, bottom: 72, left: 16 })
  })

  it('checks type against the design', () => {
    const checks = checkType({ fontSize: '16px', lineHeight: 'normal', fontWeight: '500', letterSpacing: 'normal' }, { fontSize: 15, lineHeight: 19.2, fontWeight: 500 })
    expect(checks.map((c) => [c.property, c.ok])).toEqual([
      ['font size', false],
      ['line height', true],
      ['font weight', true],
    ])
    expect(checks[0].text).toBe('font size is 16px, the design says 15px (+1px)')
  })
})

describe('QA report', () => {
  it('writes the comments as a table, with screenshots below', () => {
    const md = qaReport({
      url: 'http://localhost:5173/signup',
      title: 'Sign up',
      date: new Date('2026-10-18T10:30:00Z'),
      viewport: { width: 1440, height: 900 },
      overlay: { name: 'Signup.png', opacity: 0.5, offsetX: 0, offsetY: -2 },
      comments: [{ n: 1, text: 'Button | 4px too low', x: 120.4, y: 300, selector: 'form > button', screenshot: 'data:image/png;base64,AAA' }],
      notes: ['font size is 16px, the design says 15px (+1px)'],
    })
    expect(md).toContain('# QA report: Sign up')
    expect(md).toContain('- Design: Signup.png at 50% opacity, offset 0, -2')
    expect(md).toContain('| 1 | Button \\| 4px too low | `form > button` | 120, 300 |')
    expect(md).toContain('![Comment 1](data:image/png;base64,AAA)')
    expect(md).toContain('## Measurements')
  })
})

describe('pixel diff', () => {
  const image = (w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4)
    return data
  }
  const white = (): [number, number, number, number] => [255, 255, 255, 255]

  it('finds nothing when the images match, and ignores small colour noise', () => {
    const a = image(32, 32, white)
    const b = image(32, 32, () => [250, 252, 255, 255])
    const d = diffPixels(a, b, 32, 32)
    expect(d).toMatchObject({ compared: 1024, changed: 0, ratio: 0, regions: [] })
  })

  it('boxes each cluster of differences, biggest first', () => {
    const a = image(64, 64, white)
    // a 10 × 10 block at (4, 4) and a 20 × 4 bar at (30, 50)
    const b = image(64, 64, (x, y) => ((x >= 4 && x < 14 && y >= 4 && y < 14) || (x >= 30 && x < 50 && y >= 50 && y < 54) ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const d = diffPixels(a, b, 64, 64)
    expect(d.changed).toBe(180)
    expect(d.ratio).toBeCloseTo(180 / 4096)
    expect(d.regions).toEqual([
      { x: 0, y: 0, width: 16, height: 16 },
      { x: 24, y: 48, width: 32, height: 8 },
    ])
    expect(d.mask[4 * 64 + 4]).toBe(1)
    expect(d.mask[0]).toBe(0)
  })

  it('skips pixels either image leaves transparent, and lone stray pixels', () => {
    const a = image(16, 16, white)
    const b = image(16, 16, (x, y) => (x < 8 ? [0, 0, 0, 0] : x === 12 && y === 12 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const d = diffPixels(a, b, 16, 16)
    expect(d.compared).toBe(128)
    expect(d.changed).toBe(1)
    expect(d.regions).toEqual([])
  })
})
