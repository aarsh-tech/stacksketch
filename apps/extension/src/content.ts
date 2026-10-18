import { gapBetween } from '@stacksketch/core'
import type { Rect } from '@stacksketch/core'
import { labelOf, scanStacking } from '../../web/src/lib/stackingScan'
import type { FromContent, Inspected, OverlayState, PinnedComment, PingReply, ScanReply, ToContent, Tool } from './messages'

/**
 * Runs on pages the user turned Stacksketch on for. Draws the design overlay,
 * the measure tool and comment pins in a shadow root (so the page's CSS can't
 * reach them), and reads computed styles for the stacking inspector.
 */

declare global {
  interface Window {
    __stacksketch?: boolean
  }
}

// the page isn't ours to theme, so the overlay carries its own few colours: Stacksketch's clay accent and a measuring blue
const INK = { accent: '#d9693a', measure: '#2f7fd8', label: '#1a1918', text: '#ffffff' }

if (!window.__stacksketch) {
  window.__stacksketch = true
  start()
}

function start() {
  const host = document.createElement('stacksketch-qa')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
    img { position: absolute; max-width: none; user-select: none; }
    .box { position: absolute; border: 1px solid ${INK.measure}; background: ${INK.measure}1a; }
    .box.a { border-color: ${INK.accent}; background: ${INK.accent}1a; }
    .box.hl { border: 2px solid ${INK.accent}; background: ${INK.accent}26; }
    .tag { position: absolute; padding: 2px 5px; border-radius: 3px; background: ${INK.label}; color: ${INK.text}; white-space: nowrap; }
    .line { position: absolute; background: ${INK.accent}; }
    .pin { position: absolute; width: 22px; height: 22px; margin: -22px 0 0 -2px; border-radius: 11px 11px 11px 2px; background: ${INK.accent}; color: ${INK.text}; display: grid; place-items: center; font-weight: 700; box-shadow: 0 2px 6px #0006; }
  </style><div id="overlay"></div><div id="marks"></div><div id="pins"></div>`
  document.documentElement.append(host)
  const overlayLayer = root.getElementById('overlay') as HTMLDivElement
  const marks = root.getElementById('marks') as HTMLDivElement
  const pinsLayer = root.getElementById('pins') as HTMLDivElement

  let overlay: OverlayState | null = null
  let tool: Tool = 'none'
  let comments: PinnedComment[] = []
  let first: Element | null = null
  let hovered: Element | null = null
  let highlighted: Element | null = null
  let scanned: Element[] = []

  const send = (m: FromContent) => void chrome.runtime.sendMessage(m).catch(() => undefined)

  /* ---------- helpers ---------- */

  const pageRect = (el: Element): Rect => {
    const r = el.getBoundingClientRect()
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }
  }
  const viewRect = (r: Rect): Rect => ({ ...r, x: r.x - scrollX, y: r.y - scrollY })

  /** A selector short enough to read and specific enough to find the element again. */
  function selectorOf(el: Element): string {
    const parts: string[] = []
    let at: Element | null = el
    while (at && at !== document.documentElement && parts.length < 5) {
      if (at.id && /^[A-Za-z][\w-]*$/.test(at.id)) {
        parts.unshift(`#${at.id}`)
        break
      }
      const tag = at.tagName.toLowerCase()
      const parent: Element | null = at.parentElement
      const same = parent ? [...parent.children].filter((c) => c.tagName === at!.tagName) : []
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag)
      at = parent
    }
    return parts.join(' > ')
  }

  const div = (cls: string, r: Rect, text?: string) => {
    const d = document.createElement('div')
    d.className = cls
    d.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`
    if (text) d.textContent = text
    return d
  }
  const tag = (x: number, y: number, text: string) => {
    const d = document.createElement('div')
    d.className = 'tag'
    d.style.cssText = `left:${Math.max(2, x)}px;top:${Math.max(2, y)}px`
    d.textContent = text
    return d
  }

  /* ---------- drawing ---------- */

  function drawOverlay() {
    overlayLayer.replaceChildren()
    if (!overlay?.visible) return
    let x = overlay.x
    let y = overlay.y
    if (overlay.lockedTo) {
      const anchor = document.querySelector(overlay.lockedTo)
      if (anchor) {
        const r = pageRect(anchor)
        x += r.x
        y += r.y
      }
    }
    const img = document.createElement('img')
    img.src = overlay.src
    img.alt = ''
    img.style.cssText = `left:${x - scrollX}px;top:${y - scrollY}px;width:${overlay.width / overlay.scale}px;opacity:${overlay.opacity};mix-blend-mode:${overlay.blend}`
    overlayLayer.append(img)
  }

  function drawMarks() {
    marks.replaceChildren()
    if (highlighted) {
      const r = viewRect(pageRect(highlighted))
      marks.append(div('box hl', r), tag(r.x, r.y - 20, labelOf(highlighted)))
    }
    if (tool !== 'measure' && tool !== 'lock') return
    if (first) marks.append(div('box a', viewRect(pageRect(first))))
    if (!hovered) return
    const h = viewRect(pageRect(hovered))
    marks.append(div('box', h), tag(h.x, h.y + h.height + 4, `${labelOf(hovered)}  ${Math.round(h.width)} × ${Math.round(h.height)}`))
    if (first && first !== hovered && tool === 'measure') {
      const a = viewRect(pageRect(first))
      const gap = gapBetween(a, h)
      // a line across each gap, labelled with its length
      if (gap.horizontal > 0) {
        const left = a.x + a.width <= h.x ? a.x + a.width : h.x + h.width
        const y = Math.max(a.y, h.y) + Math.min(a.height, h.height) / 2
        marks.append(div('line', { x: left, y, width: gap.horizontal, height: 1 }), tag(left + gap.horizontal / 2 - 14, y + 4, `${Math.round(gap.horizontal)}px`))
      }
      if (gap.vertical > 0) {
        const top = a.y + a.height <= h.y ? a.y + a.height : h.y + h.height
        const x = Math.max(a.x, h.x) + Math.min(a.width, h.width) / 2
        marks.append(div('line', { x, y: top, width: 1, height: gap.vertical }), tag(x + 4, top + gap.vertical / 2 - 8, `${Math.round(gap.vertical)}px`))
      }
    }
  }

  function drawPins() {
    pinsLayer.replaceChildren(
      ...comments.map((c) => {
        const d = div('pin', { x: c.x - scrollX, y: c.y - scrollY, width: 22, height: 22 }, String(c.n))
        d.title = c.text
        return d
      }),
    )
  }

  let frame = 0
  const redraw = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      drawOverlay()
      drawMarks()
      drawPins()
    })
  }
  addEventListener('scroll', redraw, { passive: true, capture: true })
  addEventListener('resize', redraw)

  /* ---------- tools ---------- */

  const inspect = (el: Element): Inspected => {
    const s = getComputedStyle(el)
    return {
      selector: selectorOf(el),
      rect: pageRect(el),
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      fontFamily: s.fontFamily,
      color: s.color,
      ...(first && first !== el ? { gap: gapBetween(pageRect(first), pageRect(el)).text } : {}),
    }
  }

  const target = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    return el && el !== host ? el : null
  }

  addEventListener(
    'mousemove',
    (e) => {
      if (tool !== 'measure' && tool !== 'lock') return
      const el = target(e)
      if (el === hovered) return
      hovered = el
      if (el && tool === 'measure') send({ type: 'inspected', inspected: inspect(el) })
      redraw()
    },
    true,
  )

  addEventListener(
    'click',
    (e) => {
      if (tool === 'none') return
      // the tool takes the click, not the page
      e.preventDefault()
      e.stopPropagation()
      const el = target(e)
      if (!el) return
      if (tool === 'measure') {
        first = first === el ? null : el
        send({ type: 'inspected', inspected: inspect(el) })
      } else if (tool === 'lock') {
        const selector = selectorOf(el)
        if (overlay) {
          // keep the overlay where it is on screen, now measured from the element
          const r = pageRect(el)
          const base = overlay.lockedTo ? document.querySelector(overlay.lockedTo) : null
          const b = base ? pageRect(base) : { x: 0, y: 0 }
          overlay = { ...overlay, x: overlay.x + b.x - r.x, y: overlay.y + b.y - r.y, lockedTo: selector }
          send({ type: 'nudged', x: overlay.x, y: overlay.y })
        }
        send({ type: 'locked', selector })
        tool = 'none'
        send({ type: 'toolDone' })
      } else if (tool === 'comment') {
        send({ type: 'commentAt', x: e.clientX + scrollX, y: e.clientY + scrollY, selector: selectorOf(el) })
      }
      redraw()
    },
    true,
  )

  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && tool !== 'none') {
        tool = 'none'
        first = hovered = null
        send({ type: 'toolDone' })
        redraw()
        return
      }
      // arrow keys nudge the overlay, unless the page is taking typing
      if (!overlay?.visible || !e.key.startsWith('Arrow')) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      const by = e.shiftKey ? 10 : 1
      overlay = {
        ...overlay,
        x: overlay.x + (e.key === 'ArrowLeft' ? -by : e.key === 'ArrowRight' ? by : 0),
        y: overlay.y + (e.key === 'ArrowUp' ? -by : e.key === 'ArrowDown' ? by : 0),
      }
      send({ type: 'nudged', x: overlay.x, y: overlay.y })
      redraw()
    },
    true,
  )

  /* ---------- stacking scan ---------- */

  function scan(): ScanReply {
    const { scan: result, nodes } = scanStacking(document, (el) => el === host)
    scanned = nodes
    return result
  }

  /* ---------- messages from the side panel ---------- */

  chrome.runtime.onMessage.addListener((m: ToContent, _sender, reply: (r: unknown) => void) => {
    switch (m.type) {
      case 'ping':
        reply({ ok: true, url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight } } satisfies PingReply)
        return
      case 'overlay':
        overlay = m.overlay
        break
      case 'tool':
        tool = m.tool
        first = hovered = null
        break
      case 'comments':
        comments = m.comments
        break
      case 'scan':
        reply(scan())
        return
      case 'highlight':
        highlighted = m.index === null ? null : (scanned[m.index] ?? null)
        highlighted?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        break
    }
    redraw()
    reply({ ok: true })
  })
}
