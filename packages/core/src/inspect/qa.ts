import type { Rect } from './stacking'

/**
 * Measuring and reporting for the QA overlay: gaps between two boxes, type
 * against the design, and a Markdown report of the comments pinned on a page.
 */

export interface Gap {
  /** space between the boxes side to side; 0 when they overlap horizontally, negative never */
  horizontal: number
  vertical: number
  /** how they sit: `b is 24px right of a` */
  text: string
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`

/** The space between two boxes, edge to edge. */
export function gapBetween(a: Rect, b: Rect): Gap {
  const right = b.x - (a.x + a.width)
  const left = a.x - (b.x + b.width)
  const below = b.y - (a.y + a.height)
  const above = a.y - (b.y + b.height)
  const horizontal = Math.max(0, right, left)
  const vertical = Math.max(0, below, above)
  const parts: string[] = []
  if (right > 0) parts.push(`${px(right)} to the right`)
  else if (left > 0) parts.push(`${px(left)} to the left`)
  if (below > 0) parts.push(`${px(below)} below`)
  else if (above > 0) parts.push(`${px(above)} above`)
  return { horizontal, vertical, text: parts.length ? parts.join(' and ') : 'They overlap.' }
}

/** Distances from a box to the edges of the box it sits in: padding as the eye sees it. */
export function insetWithin(inner: Rect, outer: Rect): { top: number; right: number; bottom: number; left: number } {
  return {
    top: inner.y - outer.y,
    right: outer.x + outer.width - (inner.x + inner.width),
    bottom: outer.y + outer.height - (inner.y + inner.height),
    left: inner.x - outer.x,
  }
}

export interface TypeCheck {
  property: 'font size' | 'line height' | 'font weight' | 'letter spacing'
  actual: number
  expected: number
  /** within half a pixel (or 0 weight) */
  ok: boolean
  text: string
}

/** `normal` line height, roughly as browsers draw it */
const lineHeightPx = (value: string, fontSize: number) => (value === 'normal' ? Math.round(fontSize * 1.2 * 10) / 10 : parseFloat(value))

/** Compare an element's computed type with what the design says. Only the values given in `design` are checked. */
export function checkType(
  computed: { fontSize: string; lineHeight: string; fontWeight: string; letterSpacing: string },
  design: { fontSize?: number; lineHeight?: number; fontWeight?: number; letterSpacing?: number },
): TypeCheck[] {
  const size = parseFloat(computed.fontSize)
  const actual = {
    'font size': size,
    'line height': lineHeightPx(computed.lineHeight, size),
    'font weight': Number(computed.fontWeight),
    'letter spacing': computed.letterSpacing === 'normal' ? 0 : parseFloat(computed.letterSpacing),
  }
  const wanted: [TypeCheck['property'], number | undefined][] = [
    ['font size', design.fontSize],
    ['line height', design.lineHeight],
    ['font weight', design.fontWeight],
    ['letter spacing', design.letterSpacing],
  ]
  return wanted
    .filter((w): w is [TypeCheck['property'], number] => w[1] !== undefined && Number.isFinite(w[1]))
    .map(([property, expected]) => {
      const a = actual[property]
      const tolerance = property === 'font weight' ? 0 : 0.5
      const ok = Math.abs(a - expected) <= tolerance
      const unit = property === 'font weight' ? '' : 'px'
      const off = Math.round((a - expected) * 10) / 10
      return { property, actual: a, expected, ok, text: ok ? `${property} matches (${a}${unit})` : `${property} is ${a}${unit}, the design says ${expected}${unit} (${off > 0 ? '+' : ''}${off}${unit})` }
    })
}

export interface QaComment {
  n: number
  text: string
  /** where it's pinned, in page pixels */
  x: number
  y: number
  /** a CSS selector for the element under the pin */
  selector?: string
  /** a PNG data URL of the visible page when it was pinned */
  screenshot?: string
}

export interface QaReportInput {
  url: string
  title: string
  date: Date
  viewport: { width: number; height: number }
  /** the design frame laid over the page, if any */
  overlay?: { name: string; opacity: number; offsetX: number; offsetY: number }
  comments: QaComment[]
  /** measurements worth keeping, already in words */
  notes?: string[]
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** A Markdown QA report. Screenshots are embedded as data URLs, so the file stands on its own. */
export function qaReport(r: QaReportInput): string {
  const lines = [
    `# QA report: ${r.title || r.url}`,
    '',
    `- Page: ${r.url}`,
    `- Checked: ${r.date.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `- Viewport: ${r.viewport.width} × ${r.viewport.height}`,
  ]
  if (r.overlay) lines.push(`- Design: ${r.overlay.name} at ${Math.round(r.overlay.opacity * 100)}% opacity, offset ${r.overlay.offsetX}, ${r.overlay.offsetY}`)
  lines.push('')
  if (!r.comments.length) lines.push('No comments: the page matches the design.')
  else {
    lines.push(`## ${r.comments.length} ${r.comments.length === 1 ? 'comment' : 'comments'}`, '', '| # | Comment | Element | Position |', '| --- | --- | --- | --- |')
    for (const c of r.comments) lines.push(`| ${c.n} | ${cell(c.text)} | ${c.selector ? `\`${cell(c.selector)}\`` : ''} | ${Math.round(c.x)}, ${Math.round(c.y)} |`)
    for (const c of r.comments.filter((x) => x.screenshot)) lines.push('', `### ${c.n}. ${cell(c.text)}`, '', `![Comment ${c.n}](${c.screenshot})`)
  }
  if (r.notes?.length) lines.push('', '## Measurements', '', ...r.notes.map((n) => `- ${n}`))
  return lines.join('\n') + '\n'
}
