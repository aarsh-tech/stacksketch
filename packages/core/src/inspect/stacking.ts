/**
 * Stacking contexts, from computed styles. The browser extension reads the
 * styles off the page; this decides which elements start a stacking context,
 * says why in plain words, and orders them the way the browser paints them.
 */

/** The computed style properties that can start a stacking context. Values are as `getComputedStyle` returns them. */
export interface StyleSnapshot {
  position: string
  zIndex: string
  opacity: string
  transform: string
  filter: string
  backdropFilter?: string
  perspective?: string
  clipPath?: string
  mask?: string
  maskImage?: string
  mixBlendMode?: string
  isolation?: string
  willChange?: string
  contain?: string
  containerType?: string
  translate?: string
  rotate?: string
  scale?: string
  /** the parent's `display`: a flex or grid item with a z-index starts a context even when it isn't positioned */
  parentDisplay?: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const none = (v: string | undefined) => v === undefined || v === '' || v === 'none' || v === 'normal' || v === 'auto'

/**
 * Why an element starts a stacking context, in plain words; empty when it
 * doesn't. `isRoot` is the `<html>` element, which always does.
 */
export function stackingReasons(style: StyleSnapshot, isRoot = false): string[] {
  const out: string[] = []
  if (isRoot) out.push('it’s the root element (<html>), which always starts one')
  const z = style.zIndex !== 'auto' && style.zIndex !== ''
  if (style.position === 'fixed' || style.position === 'sticky') out.push(`it has position: ${style.position}, which always starts one`)
  else if (z && (style.position === 'relative' || style.position === 'absolute')) out.push(`it has position: ${style.position} and z-index: ${style.zIndex}`)
  else if (z && /\b(flex|grid)\b/.test(style.parentDisplay ?? '')) out.push(`it’s a ${/grid/.test(style.parentDisplay ?? '') ? 'grid' : 'flex'} item with z-index: ${style.zIndex}`)
  if (style.opacity !== '' && Number(style.opacity) < 1) out.push(`it has opacity: ${style.opacity} (anything below 1)`)
  if (!none(style.transform)) out.push('it has a transform')
  if (!none(style.translate)) out.push('it has translate')
  if (!none(style.rotate)) out.push('it has rotate')
  if (!none(style.scale)) out.push('it has scale')
  if (!none(style.filter)) out.push(`it has filter: ${style.filter}`)
  if (!none(style.backdropFilter)) out.push('it has a backdrop-filter')
  if (!none(style.perspective)) out.push('it has perspective')
  if (!none(style.clipPath)) out.push('it has a clip-path')
  if (!none(style.mask) || !none(style.maskImage)) out.push('it has a mask')
  if (!none(style.mixBlendMode)) out.push(`it has mix-blend-mode: ${style.mixBlendMode}`)
  if (style.isolation === 'isolate') out.push('it has isolation: isolate')
  const will = (style.willChange ?? '').split(',').map((s) => s.trim())
  const willStack = will.filter((w) => ['transform', 'opacity', 'filter', 'perspective', 'clip-path', 'mask', 'isolation', 'mix-blend-mode', 'translate', 'rotate', 'scale', 'z-index', 'position'].includes(w))
  if (willStack.length) out.push(`it has will-change: ${willStack.join(', ')}`)
  if (/\b(layout|paint|strict|content)\b/.test(style.contain ?? '')) out.push(`it has contain: ${style.contain}`)
  if (style.containerType === 'size' || style.containerType === 'inline-size') out.push(`it has container-type: ${style.containerType}`)
  return out
}

/** One element as the extension saw it. `parent` is the index of its nearest element ancestor in the list, or -1. */
export interface ScannedElement {
  label: string
  parent: number
  style: StyleSnapshot
  rect: Rect
}

export interface StackingContext {
  /** index into the scanned elements */
  index: number
  label: string
  /** the z-index it's painted with inside its parent context (`auto` counts as 0) */
  z: number
  zIndex: string
  reasons: string[]
  rect: Rect
  /** how deep it is: the root is 0 */
  depth: number
  /** the contexts inside it, back to front */
  children: StackingContext[]
}

const zOf = (style: StyleSnapshot) => (style.zIndex === 'auto' || style.zIndex === '' ? 0 : Number(style.zIndex) || 0)

/**
 * The tree of stacking contexts, with children in paint order (back to
 * front: negative z-index, then 0 and auto in document order, then positive).
 * Element 0 is the root.
 */
export function stackingTree(elements: ScannedElement[]): StackingContext | null {
  if (!elements.length) return null
  const nodes = new Map<number, StackingContext>()
  const contextOf: number[] = []
  elements.forEach((el, i) => {
    const reasons = stackingReasons(el.style, i === 0)
    // the nearest context above it
    const parentContext = el.parent >= 0 ? (nodes.has(el.parent) ? el.parent : contextOf[el.parent]) : -1
    contextOf[i] = parentContext
    if (!reasons.length) return
    const parent = nodes.get(parentContext)
    const node: StackingContext = { index: i, label: el.label, z: zOf(el.style), zIndex: el.style.zIndex, reasons, rect: el.rect, depth: parent ? parent.depth + 1 : 0, children: [] }
    nodes.set(i, node)
    parent?.children.push(node)
  })
  // sort is stable, so equal z-index keeps document order
  for (const node of nodes.values()) node.children.sort((a, b) => a.z - b.z)
  return nodes.get(0) ?? null
}

/** Why `a` paints above or below `b`, in plain words, by walking up to the context they share. */
export function compareStacking(root: StackingContext, a: number, b: number): string {
  const path = (target: number): StackingContext[] => {
    const walk = (n: StackingContext, trail: StackingContext[]): StackingContext[] | null => {
      if (n.index === target) return [...trail, n]
      for (const c of n.children) {
        const found = walk(c, [...trail, n])
        if (found) return found
      }
      return null
    }
    return walk(root, []) ?? []
  }
  const pa = path(a)
  const pb = path(b)
  if (!pa.length || !pb.length) return 'One of them isn’t a stacking context.'
  let i = 0
  while (i < pa.length && i < pb.length && pa[i].index === pb[i].index) i++
  const shared = pa[i - 1]
  const ca = pa[i]
  const cb = pb[i]
  if (!ca || !cb) return `${(ca ?? pa[pa.length - 1]).label} is inside ${(cb ?? pb[pb.length - 1]).label}, so it paints on top of it.`
  const order = shared.children
  const above = order.indexOf(ca) > order.indexOf(cb) ? [ca, cb] : [cb, ca]
  const zNote = ca.z === cb.z ? 'they have the same z-index, so the one later in the page wins' : `z-index ${above[0].zIndex} beats ${above[1].zIndex}`
  return `Inside ${shared.label}, ${above[0].label} paints above ${above[1].label}: ${zNote}. A z-index set deeper inside either one can’t change that.`
}
