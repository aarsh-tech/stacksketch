import type { Rect, ScannedElement, StyleSnapshot } from '@stacksketch/core'

/**
 * Read the computed styles the stacking inspector needs off a document: the
 * workbench's preview frame, or the page the browser extension runs on. Only
 * relative imports here: the extension's content script bundles this file.
 */

export interface StackScan {
  elements: ScannedElement[]
  page: { width: number; height: number }
  truncated: boolean
}

export const MAX_SCANNED = 6000

/** `div#app` or `button.primary.large`: short enough to read in a list. */
export function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
  return cls.length ? `${tag}.${cls.join('.')}` : tag
}

/** Every visible element in document order with its stacking styles and its box in page pixels; `nodes[i]` is element `i`. */
export function scanStacking(doc: Document, skip: (el: Element) => boolean = () => false): { scan: StackScan; nodes: Element[] } {
  const view = doc.defaultView ?? window
  const elements: ScannedElement[] = []
  const nodes: Element[] = []
  const index = new Map<Element, number>()
  const all = [doc.documentElement, ...doc.body.querySelectorAll('*')].filter((el) => !skip(el))
  for (const el of all.slice(0, MAX_SCANNED)) {
    const s = view.getComputedStyle(el)
    if (s.display === 'none') continue
    const parentEl = el.parentElement
    const style: StyleSnapshot = {
      position: s.position,
      zIndex: s.zIndex,
      opacity: s.opacity,
      transform: s.transform,
      filter: s.filter,
      backdropFilter: s.backdropFilter,
      perspective: s.perspective,
      clipPath: s.clipPath,
      maskImage: s.maskImage,
      mixBlendMode: s.mixBlendMode,
      isolation: s.isolation,
      willChange: s.willChange,
      contain: s.contain,
      containerType: s.containerType,
      translate: s.translate,
      rotate: s.rotate,
      scale: s.scale,
      parentDisplay: parentEl ? view.getComputedStyle(parentEl).display : undefined,
    }
    // the nearest ancestor that was kept (one inside display: none is skipped with it)
    let p = parentEl
    while (p && !index.has(p)) p = p.parentElement
    index.set(el, elements.length)
    const r = el.getBoundingClientRect()
    const rect: Rect = { x: r.left + view.scrollX, y: r.top + view.scrollY, width: r.width, height: r.height }
    elements.push({ label: labelOf(el), parent: p ? (index.get(p) as number) : -1, style, rect })
    nodes.push(el)
  }
  return {
    scan: { elements, page: { width: doc.documentElement.scrollWidth, height: doc.documentElement.scrollHeight }, truncated: all.length > MAX_SCANNED },
    nodes,
  }
}
