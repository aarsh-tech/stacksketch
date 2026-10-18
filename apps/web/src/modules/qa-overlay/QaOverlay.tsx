import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Crosshair, Download, ImageUp, LoaderCircle, MessageSquarePlus, Move, RefreshCw, Ruler, ScanSearch, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { diffPixels, qaReport } from '@stacksketch/core'
import type { QaComment, Rect } from '@stacksketch/core'
import { Button, Group, IconButton, Labeled, Pane, Segmented, Select, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { downloadText } from '@/lib/download'
import { SAMPLE_QA_DESIGN, SAMPLE_QA_PAGE } from '@/lib/sampleQa'
import { RunOutside } from '@/modules/RunOutside'
import { useQa } from '@/store/qa'
import type { QaDiff, QaImage, QaMobilePane, QaMode, QaTool } from '@/store/qa'

/* ---------- images ---------- */

const loadElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The browser couldn’t read that image. Use a PNG, JPEG, WebP or SVG.'))
    img.src = src
  })

async function readImage(src: string, name: string): Promise<QaImage> {
  const img = await loadElement(src)
  // Figma names @2x exports "Frame@2x.png"; macOS names retina screenshots like that too
  const scale = Number(/@(\d)x\b/.exec(name)?.[1] ?? 1)
  return { src, name, width: img.naturalWidth || 1, height: img.naturalHeight || 1, scale }
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Couldn’t read the file.'))
    reader.readAsDataURL(file)
  })

const cssSize = (img: QaImage) => ({ width: img.width / img.scale, height: img.height / img.scale })
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** A colour token as RGB, through a 1px canvas so any CSS colour works. */
function rgbOf(color: string): [number, number, number] {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

const diffKey = (s: { page: QaImage | null; design: QaImage | null; x: number; y: number }) =>
  s.page && s.design ? [s.page.name, s.page.width, s.page.scale, s.design.name, s.design.width, s.design.scale, s.x, s.y].join('|') : ''

/** Draw the page and the design (where it sits) on canvases of the page's size and compare them. */
async function computeDiff(page: QaImage, design: QaImage, x: number, y: number): Promise<QaDiff> {
  const css = cssSize(page)
  // big screenshots are compared at a smaller size: at most about six million pixels
  const factor = Math.min(1, Math.sqrt(6e6 / (css.width * css.height)))
  const w = Math.max(1, Math.round(css.width * factor))
  const h = Math.max(1, Math.round(css.height * factor))
  const [pi, di] = await Promise.all([loadElement(page.src), loadElement(design.src)])
  const canvas = () => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return [c, c.getContext('2d', { willReadFrequently: true })!] as const
  }
  const [, a] = canvas()
  a.drawImage(pi, 0, 0, w, h)
  const [, b] = canvas()
  const d = cssSize(design)
  b.drawImage(di, x * factor, y * factor, d.width * factor, d.height * factor)
  const result = diffPixels(a.getImageData(0, 0, w, h).data, b.getImageData(0, 0, w, h).data, w, h, { tile: Math.max(4, Math.round(8 * factor)) })

  const [maskCanvas, m] = canvas()
  const image = m.createImageData(w, h)
  const [r, g, bl] = rgbOf(token('--c-danger'))
  for (let i = 0; i < result.mask.length; i++) if (result.mask[i]) image.data.set([r, g, bl, 230], i * 4)
  m.putImageData(image, 0, 0)
  return {
    ratio: result.ratio,
    changed: result.changed,
    mask: maskCanvas.toDataURL('image/png'),
    regions: result.regions.map((q) => ({ x: q.x / factor, y: q.y / factor, width: q.width / factor, height: q.height / factor })),
    key: diffKey({ page, design, x, y }),
  }
}

/** A crop of the page around a point, with a numbered pin on it, for the report. */
async function screenshotAt(page: QaImage, at: { x: number; y: number }, n: number, box?: Rect): Promise<string> {
  const img = await loadElement(page.src)
  const css = cssSize(page)
  const w = Math.min(css.width, 420)
  const h = Math.min(css.height, 260)
  const left = Math.max(0, Math.min(css.width - w, at.x - w / 2))
  const top = Math.max(0, Math.min(css.height - h, at.y - h / 2))
  const c = document.createElement('canvas')
  c.width = w * 2
  c.height = h * 2
  const ctx = c.getContext('2d')!
  ctx.scale(2, 2)
  ctx.drawImage(img, left * page.scale, top * page.scale, w * page.scale, h * page.scale, 0, 0, w, h)
  const accent = token('--c-accent')
  if (box) {
    ctx.strokeStyle = token('--c-danger')
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1.5
    ctx.strokeRect(box.x - left, box.y - top, box.width, box.height)
    ctx.setLineDash([])
  }
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.arc(at.x - left, at.y - top, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = token('--c-accent-ink')
  ctx.font = '700 11px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), at.x - left, at.y - top + 0.5)
  return c.toDataURL('image/png')
}

/* ---------- actions, on the store ---------- */

let timer = 0
const qa = () => useQa.getState()

async function runDiff() {
  const { page, design, x, y, set } = qa()
  if (!page || !design) return
  set({ busy: true })
  try {
    const result = await computeDiff(page, design, x, y)
    // only keep it if nothing changed while it ran
    if (diffKey(qa()) === result.key) set({ diff: result })
  } catch (e) {
    toast.error('Couldn’t compare the images', { description: e instanceof Error ? e.message : String(e) })
  } finally {
    set({ busy: false })
  }
}

/** Compare again a moment after the images or the design's position change. */
function scheduleDiff() {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void runDiff(), 250)
}

function update(patch: Parameters<ReturnType<typeof qa>['set']>[0]) {
  qa().set(patch)
  if ('page' in patch || 'design' in patch || 'x' in patch || 'y' in patch) scheduleDiff()
}

async function open(which: 'page' | 'design', file: File) {
  if (!file.type.startsWith('image/')) {
    toast.error('That isn’t an image', { description: 'Use a PNG, JPEG, WebP or SVG: a screenshot of your page, and the frame exported from Figma.' })
    return
  }
  try {
    const img = await readImage(await fileToDataUrl(file), file.name || (which === 'page' ? 'Pasted screenshot.png' : 'Pasted design.png'))
    const other = qa()[which === 'page' ? 'design' : 'page']
    update({ [which]: img, diff: null, ...(which === 'page' ? { comments: [], notes: [] } : {}), mobilePane: other ? 'stage' : 'images' })
    toast.success(`Opened ${img.name} as the ${which === 'page' ? 'page' : 'design'}`)
  } catch (e) {
    toast.error('Couldn’t open that image', { description: e instanceof Error ? e.message : String(e) })
  }
}

async function loadSample() {
  const [p, d] = await Promise.all([readImage(SAMPLE_QA_PAGE.src, SAMPLE_QA_PAGE.name), readImage(SAMPLE_QA_DESIGN.src, SAMPLE_QA_DESIGN.name)])
  update({ page: p, design: d, x: 0, y: 0, diff: null, comments: [], notes: [], mode: 'overlay', opacity: 0.5, mobilePane: 'stage' })
}

function onPaste(e: ClipboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
  if (!file) return
  e.preventDefault()
  const { page, design } = qa()
  void open(!page ? 'page' : !design ? 'design' : 'design', file)
}

function exportReport() {
  const { page, design, diff, notes, comments, opacity, x, y } = qa()
  if (!page) return
  const css = cssSize(page)
  const md = qaReport({
    url: page.name,
    title: page.name,
    date: new Date(),
    viewport: { width: Math.round(css.width), height: Math.round(css.height) },
    overlay: design ? { name: design.name, opacity, offsetX: x, offsetY: y } : undefined,
    comments,
    notes: [...(diff ? [`${(diff.ratio * 100).toFixed(1)}% of the compared pixels differ from the design, in ${diff.regions.length} ${diff.regions.length === 1 ? 'area' : 'areas'}.`] : []), ...notes],
  })
  downloadText(`qa-report-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown')
}

/* ---------- pieces ---------- */

function DropZone({ label, image, onFile, onScale, onRemove }: { label: string; image: QaImage | null; onFile: (f: File) => void; onScale: (s: number) => void; onRemove: () => void }) {
  const [over, setOver] = useState(false)
  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
        className={cx(
          'flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-[12.5px] transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-raised hover:bg-hover',
        )}
      >
        {image ? (
          <img src={image.src} alt="" className="size-10 shrink-0 rounded border border-line object-cover object-top" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded bg-hover text-ink-3">
            <ImageUp size={16} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink">{label}</span>
          <span className="block truncate text-ink-3">{image ? `${image.name} · ${image.width} × ${image.height}` : 'Drop, paste or pick a PNG, JPEG or SVG'}</span>
        </span>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {image ? (
        <div className="flex items-center gap-2">
          <Segmented
            label={`${label} pixel density`}
            className="flex-1"
            value={String(image.scale) as '1' | '2' | '3'}
            onChange={(s) => onScale(Number(s))}
            options={[
              { value: '1', label: '1x', title: 'One image pixel per CSS pixel' },
              { value: '2', label: '2x', title: 'A retina screenshot or a @2x export' },
              { value: '3', label: '3x' },
            ]}
          />
          <IconButton label={`Remove the ${label.toLowerCase()}`} onClick={onRemove}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      ) : null}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-ink-3">{children}</p>
}

/* ---------- the module ---------- */

export default function QaOverlay() {
  const s = useQa()
  const { page, design, mode, tool, diff, x, y, busy } = s
  const set = s.set
  const [stageWidth, setStageWidth] = useState(800)
  const [measure, setMeasure] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [focusRegion, setFocusRegion] = useState<number | null>(null)

  // paste a screenshot straight from the clipboard: the page first, then the design
  useEffect(() => {
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
  const drag = useRef<{ kind: 'move' | 'measure'; startX: number; startY: number; ox: number; oy: number } | null>(null)
  const inner = useRef<HTMLDivElement>(null)

  /* ----- the stage ----- */

  const pw = page ? cssSize(page).width : 0
  const ph = page ? cssSize(page).height : 0
  const dw = design ? cssSize(design).width : 0
  const dh = design ? cssSize(design).height : 0
  const zoom = s.zoom === 'fit' ? Math.max(0.1, Math.min(2, (stageWidth - 48) / Math.max(pw, 1))) : s.zoom
  const stale = !!diff && diff.key !== diffKey(s)

  const stageRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const point = (e: ReactPointerEvent) => {
    const r = inner.current!.getBoundingClientRect()
    return { x: Math.round((e.clientX - r.left) / zoom), y: Math.round((e.clientY - r.top) / zoom) }
  }

  const addComment = async (at: { x: number; y: number }, text = '', box?: Rect) => {
    if (!page) return
    const n = (useQa.getState().comments.at(-1)?.n ?? 0) + 1
    set({ comments: [...useQa.getState().comments, { n, text, x: at.x, y: at.y }], mobilePane: s.mobilePane === 'stage' ? 'stage' : 'findings' })
    try {
      const shot = await screenshotAt(page, at, n, box)
      set({ comments: useQa.getState().comments.map((c) => (c.n === n ? { ...c, screenshot: shot } : c)) })
    } catch {
      // the comment stands without its screenshot
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!page || e.button !== 0) return
    const p = point(e)
    if (tool === 'comment') {
      void addComment(p)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'measure') {
      drag.current = { kind: 'measure', startX: p.x, startY: p.y, ox: 0, oy: 0 }
      setMeasure({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    } else if (design && mode !== 'diff') drag.current = { kind: 'move', startX: p.x, startY: p.y, ox: x, oy: y }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    if (d.kind === 'measure') setMeasure({ x0: d.startX, y0: d.startY, x1: p.x, y1: p.y })
    else set({ x: d.ox + p.x - d.startX, y: d.oy + p.y - d.startY })
  }
  const onPointerUp = () => {
    if (drag.current?.kind === 'move') scheduleDiff()
    drag.current = null
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      set({ tool: 'none' })
      setMeasure(null)
      return
    }
    if (!design || !e.key.startsWith('Arrow')) return
    e.preventDefault()
    const by = e.shiftKey ? 10 : 1
    update({ x: x + (e.key === 'ArrowLeft' ? -by : e.key === 'ArrowRight' ? by : 0), y: y + (e.key === 'ArrowUp' ? -by : e.key === 'ArrowDown' ? by : 0) })
  }

  const m = measure && { x: Math.min(measure.x0, measure.x1), y: Math.min(measure.y0, measure.y1), width: Math.abs(measure.x1 - measure.x0), height: Math.abs(measure.y1 - measure.y0) }
  const swipeAt = s.swipe * pw
  // swipe shows the design left of the line and the page right of it
  const clipRight = Math.max(0, Math.min(dw, x + dw - swipeAt))

  const show = (pane: QaMobilePane) => (s.mobilePane === pane ? 'flex' : 'max-xl:hidden')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={s.mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'images', label: 'Images' },
            { value: 'stage', label: 'Compare' },
            { value: 'findings', label: 'Findings' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* ---------- images and settings ---------- */}
        <Pane title="Images" className={cx(show('images'), 'xl:flex')} actions={<RunOutside id="qa-overlay" label="Check a live page" />}>
          <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
            <Group title="Compare">
              <DropZone
                label="Your page"
                image={page}
                onFile={(f) => void open('page', f)}
                onScale={(scale) => update({ page: page && { ...page, scale } })}
                onRemove={() => update({ page: null, diff: null, comments: [], notes: [] })}
              />
              <DropZone
                label="The design"
                image={design}
                onFile={(f) => void open('design', f)}
                onScale={(scale) => update({ design: design && { ...design, scale } })}
                onRemove={() => update({ design: null, diff: null })}
              />
              {!page || !design ? (
                <Button variant="outline" size="sm" className="w-full" onClick={() => void loadSample()}>
                  <Sparkles size={13} />
                  Try it with a sample
                </Button>
              ) : null}
              <Empty>Take a screenshot of your page at the design’s width, and export the frame from Figma (File → Export, PNG). Nothing is uploaded.</Empty>
            </Group>
            {page && design ? (
              <>
                <Group title="Look">
                  <Segmented<QaMode>
                    label="View"
                    className="w-full"
                    value={mode}
                    onChange={(v) => set({ mode: v })}
                    options={[
                      { value: 'overlay', label: 'Overlay', title: 'The design on top of the page' },
                      { value: 'swipe', label: 'Swipe', title: 'The design on the left of a line, the page on the right' },
                      { value: 'diff', label: 'Differences', title: 'The pixels that differ, in red' },
                    ]}
                  />
                  {mode === 'overlay' ? (
                    <>
                      <Labeled label={`Design opacity ${Math.round(s.opacity * 100)}%`}>
                        <input type="range" min={0} max={1} step={0.05} value={s.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} className="w-full accent-[var(--c-accent)]" />
                      </Labeled>
                      <Segmented
                        label="Blend"
                        className="w-full"
                        value={s.blend}
                        onChange={(blend) => set({ blend })}
                        options={[
                          { value: 'normal', label: 'Normal' },
                          { value: 'difference', label: 'Difference', title: 'Matching pixels turn black; anything that drifts lights up' },
                        ]}
                      />
                    </>
                  ) : mode === 'swipe' ? (
                    <Labeled label="Swipe line">
                      <input type="range" min={0} max={1} step={0.005} value={s.swipe} onChange={(e) => set({ swipe: Number(e.target.value) })} className="w-full accent-[var(--c-accent)]" />
                    </Labeled>
                  ) : null}
                </Group>
                <Group title="Design position" aside={x || y ? <Button size="sm" onClick={() => update({ x: 0, y: 0 })}>Reset</Button> : null}>
                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y'] as const).map((k) => (
                      <Labeled key={k} label={k.toUpperCase()}>
                        <input type="number" value={s[k]} onChange={(e) => update({ [k]: Math.round(Number(e.target.value) || 0) })} className={cx(inputClass, 'w-full font-mono')} />
                      </Labeled>
                    ))}
                  </div>
                  <Empty>Drag the design, or click the picture and use the arrow keys: 1px, or 10px with Shift.</Empty>
                </Group>
              </>
            ) : null}
            {page ? (
              <Group title="Tools">
                <Segmented<QaTool>
                  label="Tool"
                  className="w-full"
                  value={tool}
                  onChange={(t) => {
                    set({ tool: t })
                    if (t !== 'measure') setMeasure(null)
                  }}
                  options={[
                    { value: 'none', label: <Move size={14} className="mx-auto" aria-label="Move" />, title: 'Move the design' },
                    { value: 'measure', label: <Ruler size={14} className="mx-auto" aria-label="Measure" />, title: 'Measure: drag a box' },
                    { value: 'comment', label: <MessageSquarePlus size={14} className="mx-auto" aria-label="Comment" />, title: 'Pin a comment: click the picture' },
                  ]}
                />
                {tool === 'measure' ? (
                  m && (m.width || m.height) ? (
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <span className="flex-1 font-mono text-ink">
                        {m.width} × {m.height} <span className="text-ink-3">at {m.x}, {m.y}</span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          set({ notes: [...s.notes, `Measured ${m.width} × ${m.height}px at ${m.x}, ${m.y}.`] })
                          toast.success('Added the measurement to the report')
                        }}
                      >
                        Add to the report
                      </Button>
                    </div>
                  ) : (
                    <Empty>Drag a box over the picture to measure it, in CSS pixels.</Empty>
                  )
                ) : tool === 'comment' ? (
                  <Empty>Click the picture where something’s off. Each pin keeps a screenshot for the report. Esc to stop.</Empty>
                ) : null}
                <Labeled label="Zoom">
                  <Select value={String(s.zoom)} onChange={(e) => set({ zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) })} className="w-full">
                    <option value="fit">Fit the width</option>
                    {[0.5, 1, 1.5, 2, 3].map((z) => (
                      <option key={z} value={String(z)}>
                        {z * 100}%
                      </option>
                    ))}
                  </Select>
                </Labeled>
              </Group>
            ) : null}
          </div>
        </Pane>

        {/* ---------- the stage ---------- */}
        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('stage'), 'xl:flex')} aria-label="Comparison">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3.5">
            <h2 className="text-[13px] font-semibold tracking-[-0.005em]">Compare</h2>
            {page ? (
              <span className="truncate text-[12px] text-ink-3">
                {Math.round(pw)} × {Math.round(ph)} · {Math.round(zoom * 100)}%
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5 text-[12px]">
              {busy ? <LoaderCircle size={14} className="animate-spin text-ink-3" aria-label="Comparing" /> : null}
              {diff && !stale ? (
                <span className={cx('font-mono font-semibold', diff.ratio < 0.002 ? 'text-ok' : 'text-danger')}>{(diff.ratio * 100).toFixed(1)}% differs</span>
              ) : null}
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            <div
              ref={stageRef}
              tabIndex={page ? 0 : -1}
              onKeyDown={onKeyDown}
              aria-label={page ? 'The page and the design. Arrow keys move the design.' : undefined}
              className="paper-grid absolute inset-0 overflow-auto scrollbar-thin focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              {page ? (
                <div className="relative m-6" style={{ width: Math.max(pw, x + dw) * zoom, height: Math.max(ph, y + dh) * zoom }}>
                  <div
                    ref={inner}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className={cx('absolute top-0 left-0 origin-top-left touch-none select-none', tool === 'none' ? (design && mode !== 'diff' ? 'cursor-move' : '') : 'cursor-crosshair')}
                    style={{ width: pw, height: ph, transform: `scale(${zoom})` }}
                  >
                    <img src={page.src} alt="Your page" draggable={false} className={cx('pointer-events-none absolute top-0 left-0 max-w-none shadow-pop', mode === 'diff' && 'opacity-35 grayscale')} style={{ width: pw, height: ph }} />
                    {design && mode !== 'diff' ? (
                      <img
                        src={design.src}
                        alt="The design"
                        draggable={false}
                        className="pointer-events-none absolute max-w-none"
                        style={{
                          left: x,
                          top: y,
                          width: dw,
                          height: dh,
                          opacity: mode === 'swipe' ? 1 : s.opacity,
                          mixBlendMode: mode === 'overlay' ? s.blend : 'normal',
                          clipPath: mode === 'swipe' ? `inset(0 ${clipRight}px 0 0)` : undefined,
                        }}
                      />
                    ) : null}
                    {mode === 'diff' && diff ? <img src={diff.mask} alt="Pixels that differ" draggable={false} className="pointer-events-none absolute top-0 left-0 max-w-none" style={{ width: pw, height: ph }} /> : null}
                    {mode === 'swipe' && design ? <div aria-hidden className="pointer-events-none absolute top-0 w-0.5 bg-accent" style={{ left: swipeAt - 1, height: Math.max(ph, y + dh) }} /> : null}
                    {s.showRegions && diff && !stale
                      ? diff.regions.map((r, i) => (
                          <div
                            key={i}
                            aria-hidden
                            className={cx('pointer-events-none absolute rounded-[2px] border-[1.5px] border-dashed', focusRegion === i ? 'border-solid border-danger bg-danger/15' : 'border-danger/80')}
                            style={{ left: r.x - 2, top: r.y - 2, width: r.width + 4, height: r.height + 4 }}
                          />
                        ))
                      : null}
                    {m && (m.width || m.height) ? (
                      <div aria-hidden className="pointer-events-none absolute border border-t-number bg-t-number/10" style={{ left: m.x, top: m.y, width: m.width, height: m.height }}>
                        <span className="absolute top-full left-0 mt-1 rounded bg-ink px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-bg" style={{ transform: `scale(${1 / zoom})`, transformOrigin: '0 0' }}>
                          {m.width} × {m.height}
                        </span>
                      </div>
                    ) : null}
                    {s.comments.map((c) => (
                      <span
                        key={c.n}
                        title={c.text || `Comment ${c.n}`}
                        className="pointer-events-none absolute grid size-[22px] place-items-center rounded-full bg-accent font-mono text-[11px] font-bold text-accent-ink shadow-pop"
                        style={{ left: c.x - 11, top: c.y - 11, transform: `scale(${1 / zoom})` }}
                      >
                        {c.n}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div className="max-w-sm text-[13px] text-ink-3">
                    <Crosshair size={22} className="mx-auto mb-2 text-accent" />
                    <p>Lay the design over a screenshot of your page and see exactly where spacing, type and colour drift.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => void loadSample()}>
                      <Sparkles size={13} />
                      Try it with a sample
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---------- findings ---------- */}
        <Pane
          title="Findings"
          className={cx(show('findings'), 'xl:flex')}
          actions={
            <IconButton label="Download the QA report (Markdown)" onClick={() => exportReport()} disabled={!page}>
              <Download size={15} />
            </IconButton>
          }
        >
          <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
            <Group
              title="Where it drifts"
              aside={
                page && design ? (
                  <IconButton label="Compare again" className="size-7" onClick={() => void runDiff()}>
                    <RefreshCw size={13} />
                  </IconButton>
                ) : null
              }
            >
              {!page || !design ? (
                <Empty>Add your page and the design, and every area that differs is boxed here.</Empty>
              ) : !diff || stale ? (
                <Empty>{busy ? 'Comparing…' : 'Moved. Comparing again in a moment.'}</Empty>
              ) : diff.regions.length === 0 ? (
                <p className="text-[12.5px] text-ok">The page matches the design here: no area differs by more than anti-aliasing.</p>
              ) : (
                <>
                  <p className="text-[12.5px] text-ink">
                    {(diff.ratio * 100).toFixed(1)}% of the pixels differ, in {diff.regions.length} {diff.regions.length === 1 ? 'area' : 'areas'}. Hover one to find it; switch to Differences to see the pixels.
                  </p>
                  <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <input type="checkbox" checked={s.showRegions} onChange={(e) => set({ showRegions: e.target.checked })} className="size-3.5 accent-[var(--c-accent)]" />
                    Box them on the picture
                  </label>
                  <ol className="space-y-px">
                    {diff.regions.map((r, i) => (
                      <li key={i} onMouseEnter={() => setFocusRegion(i)} onMouseLeave={() => setFocusRegion(null)} className={cx('flex items-center gap-2 rounded-md px-2 py-1 text-[12px]', focusRegion === i && 'bg-hover')}>
                        <ScanSearch size={13} className="shrink-0 text-danger" />
                        <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-ink-2" onFocus={() => setFocusRegion(i)} onBlur={() => setFocusRegion(null)} onClick={() => setFocusRegion(i)}>
                          {Math.round(r.width)} × {Math.round(r.height)} at {Math.round(r.x)}, {Math.round(r.y)}
                        </button>
                        <Button size="sm" className="h-6 px-1.5" onClick={() => void addComment({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }, 'Differs from the design', r)}>
                          Pin
                        </Button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Group>
            <Group title="Comments" aside={s.comments.length ? <Button size="sm" onClick={() => set({ comments: [] })}>Clear</Button> : null}>
              {s.comments.length ? (
                <ol className="space-y-2">
                  {s.comments.map((c: QaComment) => (
                    <li key={c.n} className="flex gap-2">
                      <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent font-mono text-[10.5px] font-bold text-accent-ink">{c.n}</span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <TextInput
                          aria-label={`Comment ${c.n}`}
                          value={c.text}
                          placeholder="What’s off?"
                          onChange={(e) => set({ comments: s.comments.map((x2) => (x2.n === c.n ? { ...x2, text: e.target.value } : x2)) })}
                          className="w-full"
                        />
                        <p className="font-mono text-[11px] text-ink-3">
                          at {c.x}, {c.y}
                          {c.screenshot ? ' · screenshot kept' : ''}
                        </p>
                      </div>
                      <IconButton label={`Delete comment ${c.n}`} onClick={() => set({ comments: s.comments.filter((x2) => x2.n !== c.n) })}>
                        <Trash2 size={14} />
                      </IconButton>
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty>Pick the comment tool and click the picture, or pin an area from the list above.</Empty>
              )}
            </Group>
            {s.notes.length ? (
              <Group title="Measurements">
                <ul className="space-y-1">
                  {s.notes.map((n, i) => (
                    <li key={`${i}-${n}`} className="flex items-center gap-2 text-[12px] text-ink-2">
                      <span className="flex-1">{n}</span>
                      <IconButton label="Remove this measurement" className="size-6" onClick={() => set({ notes: s.notes.filter((_, j) => j !== i) })}>
                        <X size={12} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </Group>
            ) : null}
            <Group title="Report">
              <Button variant="outline" size="sm" className="w-full" onClick={() => exportReport()} disabled={!page}>
                <Download size={13} />
                Download the QA report (Markdown)
              </Button>
              <Empty>The differences, comments with their screenshots, and measurements, in one file you can attach to a pull request.</Empty>
            </Group>
          </div>
        </Pane>
      </div>
    </div>
  )
}
