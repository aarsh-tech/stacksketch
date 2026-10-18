import { useMemo, useRef, useState } from 'react'
import { MousePointerClick, RotateCcw } from 'lucide-react'

import { stackingTree } from '@stacksketch/core'
import type { StackingContext } from '@stacksketch/core'
import { IconButton, Pane, Segmented, Tabs, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { SAMPLE_STACKING_CSS, SAMPLE_STACKING_HTML } from '@/lib/sampleStacking'
import { scanStacking } from '@/lib/stackingScan'
import type { StackScan } from '@/lib/stackingScan'
import { RunOutside } from '@/modules/RunOutside'
import { useStacking } from '@/store/stacking'
import type { StackingMobilePane } from '@/store/stacking'
import { StackingPanel } from './StackingPanel'

const MARK = 'data-stacksketch'

/** The stacking context an element paints in: itself if it starts one, else its nearest ancestor that does. */
function contextOf(scan: StackScan, index: number): number | null {
  const tree = stackingTree(scan.elements)
  if (!tree) return null
  const contexts = new Set<number>()
  const walk = (n: StackingContext) => {
    contexts.add(n.index)
    n.children.forEach(walk)
  }
  walk(tree)
  for (let i = index; i >= 0; i = scan.elements[i].parent) if (contexts.has(i)) return i
  return null
}

const page = (html: string, css: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${html}</body></html>`

export default function Stacking() {
  const html = useStacking((s) => s.html)
  const css = useStacking((s) => s.css)
  const tab = useStacking((s) => s.tab)
  const mobilePane = useStacking((s) => s.mobilePane)
  const set = useStacking((s) => s.set)
  const frame = useRef<HTMLIFrameElement>(null)
  const nodes = useRef<Element[]>([])
  const [scan, setScan] = useState<StackScan | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  // the click handler inside the preview is added once per load, so it reads the picks from here
  const pickedNow = useRef<number[]>([])
  const srcDoc = useMemo(() => page(html, css), [html, css])

  const doc = () => frame.current?.contentDocument ?? null

  /** Outline an element inside the preview, on a layer the scan skips. */
  const highlight = (index: number | null) => {
    const d = doc()
    if (!d) return
    d.querySelector(`[${MARK}]`)?.remove()
    const el = index === null ? null : nodes.current[index]
    if (!el) return
    const view = d.defaultView ?? window
    const r = el.getBoundingClientRect()
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()
    const box = d.createElement('div')
    box.setAttribute(MARK, '')
    box.style.cssText = `all: initial; position: absolute; pointer-events: none; z-index: 2147483647; left: ${r.left + view.scrollX}px; top: ${r.top + view.scrollY}px; width: ${r.width}px; height: ${r.height}px; outline: 2px solid ${accent}; outline-offset: 1px; background: color-mix(in srgb, ${accent} 18%, transparent);`
    d.documentElement.append(box)
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const runScan = () => {
    const d = doc()
    if (!d?.body) return null
    d.querySelector(`[${MARK}]`)?.remove()
    const result = scanStacking(d, (el) => el.hasAttribute(MARK))
    nodes.current = result.nodes
    setScan(result.scan)
    return result.scan
  }

  const pick = (next: number[]) => {
    pickedNow.current = next
    setPicked(next)
    highlight(next.at(-1) ?? null)
  }

  const onLoad = () => {
    const result = runScan()
    pick([])
    const d = doc()
    if (!d || !result) return
    // click an element in the preview to see the context it paints in
    d.addEventListener(
      'click',
      (e) => {
        e.preventDefault()
        const i = nodes.current.indexOf(e.target as Element)
        const ctx = i >= 0 ? contextOf(result, i) : null
        if (ctx === null) return
        const p = pickedNow.current
        pick(p.includes(ctx) ? [...p.filter((x) => x !== ctx), ctx] : [...p, ctx].slice(-2))
        set({ mobilePane: 'layers' })
      },
      true,
    )
  }

  const show = (pane: StackingMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'code', label: 'Code' },
            { value: 'preview', label: 'Preview' },
            { value: 'layers', label: 'Layers' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('code'), 'xl:flex')} aria-label="HTML and CSS">
          <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
            <div className="min-w-0 flex-1">
              <Tabs
                label="File"
                value={tab}
                onChange={(t) => set({ tab: t })}
                options={[
                  { value: 'html', label: 'HTML' },
                  { value: 'css', label: 'CSS' },
                ]}
              />
            </div>
            <IconButton label="Load the sample" onClick={() => set({ html: SAMPLE_STACKING_HTML, css: SAMPLE_STACKING_CSS })}>
              <RotateCcw size={15} />
            </IconButton>
          </header>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 flex flex-col gap-2 p-3">
              <p className="text-[12px] text-ink-3">Paste the markup and CSS of the part that stacks wrong, or the HTML of a whole page. Scripts don’t run.</p>
              <textarea
                key={tab}
                aria-label={tab === 'html' ? 'HTML' : 'CSS'}
                value={tab === 'html' ? html : css}
                wrap="off"
                spellCheck={false}
                onChange={(e) => set(tab === 'html' ? { html: e.target.value } : { css: e.target.value })}
                className={cx(inputClass, 'h-auto min-h-0 w-full flex-1 resize-none py-2 font-mono text-[12px] leading-relaxed')}
              />
            </div>
          </div>
        </section>

        <Pane
          title="Preview"
          meta={
            <span className="inline-flex items-center gap-1">
              <MousePointerClick size={12} /> click an element to find its context
            </span>
          }
          className={cx(show('preview'), 'xl:flex')}
          actions={<RunOutside id="stacking" label="Inspect a live page" />}
        >
          <iframe ref={frame} title="Preview of your HTML and CSS" sandbox="allow-same-origin" srcDoc={srcDoc} onLoad={onLoad} className="absolute inset-0 size-full border-0 bg-raised" />
        </Pane>

        <Pane title="Layers" meta={scan ? `${scan.elements.length} elements` : undefined} className={cx(show('layers'), 'xl:flex')}>
          <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
            <StackingPanel
              scan={scan}
              onScan={() => {
                runScan()
                pick([])
              }}
              onHighlight={highlight}
              picked={picked}
              onPickedChange={pick}
              stage={300}
              stageHeight={320}
              scanLabel={['Scan the preview', 'Scan the preview again']}
            />
          </div>
        </Pane>
      </div>
    </div>
  )
}
