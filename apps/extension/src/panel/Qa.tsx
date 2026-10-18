import { useState } from 'react'
import { Download, Eye, EyeOff, ImageUp, Lock, MessageSquarePlus, Ruler, Trash2, Unlock } from 'lucide-react'

import { checkType, qaReport } from '@stacksketch/core'
import { Button, Group, IconButton, Labeled, Segmented, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import type { Inspected, OverlayState, PinnedComment, Tool } from '../messages'
import type { TabState } from './tab'

const num = (v: string) => (v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number }) {
  return (
    <Labeled label={label}>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(num(e.target.value))} className={cx(inputClass, 'w-full font-mono')} />
    </Labeled>
  )
}

/* ---------- overlay ---------- */

export function OverlayPanel({ overlay, setOverlay, tool, setTool }: { overlay: OverlayState | null; setOverlay: (o: OverlayState | null) => void; tool: Tool; setTool: (t: Tool) => void }) {
  const open = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        // Figma names @2x exports "Frame@2x.png"
        const scale = Number(/@(\d)x\./.exec(file.name)?.[1] ?? 1)
        setOverlay({ src, name: file.name, width: img.naturalWidth, scale, opacity: 0.5, blend: 'normal', x: 0, y: 0, visible: true })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  }
  const set = (patch: Partial<OverlayState>) => overlay && setOverlay({ ...overlay, ...patch })

  return (
    <>
      <Group title="Design">
        <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong bg-raised text-[13px] font-medium text-ink hover:bg-hover has-focus-visible:outline-2 has-focus-visible:outline-accent">
          <ImageUp size={14} />
          {overlay ? 'Replace the design image' : 'Open a design image (PNG)'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => open(e.target.files?.[0])} />
        </label>
        {overlay ? (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <span className="min-w-0 flex-1 truncate font-mono">{overlay.name}</span>
            <IconButton label={overlay.visible ? 'Hide the overlay' : 'Show the overlay'} onClick={() => set({ visible: !overlay.visible })}>
              {overlay.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </IconButton>
            <IconButton label="Remove the overlay" onClick={() => setOverlay(null)}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        ) : (
          <p className="text-[12px] text-ink-3">Export the frame from Figma (File → Export, PNG) and lay it over the page to see where it drifts.</p>
        )}
      </Group>
      {overlay ? (
        <>
          <Group title="Look">
            <Labeled label={`Opacity ${Math.round(overlay.opacity * 100)}%`}>
              <input type="range" min={0} max={1} step={0.05} value={overlay.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} className="w-full accent-[var(--c-accent)]" />
            </Labeled>
            <Segmented
              label="Blend"
              className="w-full"
              value={overlay.blend}
              onChange={(blend) => set({ blend })}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'difference', label: 'Difference', title: 'Matching pixels turn black; anything that drifts lights up' },
              ]}
            />
            <Segmented
              label="Image scale"
              className="w-full"
              value={String(overlay.scale) as '1' | '2' | '3'}
              onChange={(s) => set({ scale: Number(s) })}
              options={[
                { value: '1', label: '1x' },
                { value: '2', label: '2x' },
                { value: '3', label: '3x' },
              ]}
            />
          </Group>
          <Group title="Position">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="X" value={overlay.x} onChange={(x) => set({ x: x ?? 0 })} />
              <NumberField label="Y" value={overlay.y} onChange={(y) => set({ y: y ?? 0 })} />
            </div>
            <p className="text-[12px] text-ink-3">Click the page, then use the arrow keys to nudge it 1px (Shift for 10px).</p>
            {overlay.lockedTo ? (
              <div className="flex items-center gap-2 text-[12.5px]">
                <Lock size={13} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-ink-2" title={overlay.lockedTo}>
                  {overlay.lockedTo}
                </span>
                <Button variant="outline" size="sm" onClick={() => set({ lockedTo: undefined })}>
                  <Unlock size={13} />
                  Unlock
                </Button>
              </div>
            ) : (
              <Button variant={tool === 'lock' ? 'primary' : 'outline'} size="sm" onClick={() => setTool(tool === 'lock' ? 'none' : 'lock')}>
                <Lock size={13} />
                {tool === 'lock' ? 'Click an element on the page…' : 'Lock it to an element'}
              </Button>
            )}
          </Group>
        </>
      ) : null}
    </>
  )
}

/* ---------- measure ---------- */

export function MeasurePanel({ tool, setTool, inspected, notes, setNotes }: { tool: Tool; setTool: (t: Tool) => void; inspected: Inspected | null; notes: string[]; setNotes: (n: string[]) => void }) {
  const [design, setDesign] = useState<{ fontSize?: number; lineHeight?: number; fontWeight?: number; letterSpacing?: number }>({})
  const checks = inspected ? checkType(inspected, design) : []
  return (
    <>
      <Group title="Measure">
        <Button variant={tool === 'measure' ? 'primary' : 'outline'} size="sm" onClick={() => setTool(tool === 'measure' ? 'none' : 'measure')}>
          <Ruler size={13} />
          {tool === 'measure' ? 'Measuring: Esc to stop' : 'Start measuring'}
        </Button>
        <p className="text-[12px] text-ink-3">Hover to see an element’s size and type. Click one, then hover another to see the gap between them.</p>
      </Group>
      {inspected ? (
        <Group title="Element">
          <p className="truncate font-mono text-[12px] text-ink" title={inspected.selector}>
            {inspected.selector}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink-3">Size</dt>
            <dd className="font-mono">
              {Math.round(inspected.rect.width)} × {Math.round(inspected.rect.height)}
            </dd>
            {inspected.gap ? (
              <>
                <dt className="text-ink-3">Gap</dt>
                <dd>{inspected.gap}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Type</dt>
            <dd className="font-mono">
              {inspected.fontSize} / {inspected.lineHeight}, {inspected.fontWeight}
            </dd>
            <dt className="text-ink-3">Font</dt>
            <dd className="truncate" title={inspected.fontFamily}>
              {inspected.fontFamily}
            </dd>
          </dl>
        </Group>
      ) : null}
      <Group title="Against the design">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Font size" value={design.fontSize} onChange={(fontSize) => setDesign({ ...design, fontSize })} step={0.5} />
          <NumberField label="Line height" value={design.lineHeight} onChange={(lineHeight) => setDesign({ ...design, lineHeight })} step={0.5} />
          <NumberField label="Weight" value={design.fontWeight} onChange={(fontWeight) => setDesign({ ...design, fontWeight })} step={100} />
          <NumberField label="Letter spacing" value={design.letterSpacing} onChange={(letterSpacing) => setDesign({ ...design, letterSpacing })} step={0.1} />
        </div>
        {checks.length ? (
          <ul className="space-y-1 text-[12.5px]">
            {checks.map((c) => (
              <li key={c.property} className={c.ok ? 'text-ok' : 'text-danger'}>
                {c.ok ? '✓' : '✗'} {c.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-3">Type the values from Figma’s inspect panel, then hover the text.</p>
        )}
        {inspected && checks.some((c) => !c.ok) ? (
          <Button variant="outline" size="sm" onClick={() => setNotes([...notes, ...checks.filter((c) => !c.ok).map((c) => `${inspected.selector}: ${c.text}`)])}>
            Add to the report
          </Button>
        ) : null}
        {notes.length ? <p className="text-[12px] text-ink-3">{notes.length} measurements in the report.</p> : null}
      </Group>
    </>
  )
}

/* ---------- comments ---------- */

export function CommentsPanel({
  tab,
  tool,
  setTool,
  comments,
  setComments,
  notes,
  overlay,
}: {
  tab: TabState
  tool: Tool
  setTool: (t: Tool) => void
  comments: PinnedComment[]
  setComments: (c: PinnedComment[]) => void
  notes: string[]
  overlay: OverlayState | null
}) {
  const exportReport = () => {
    const md = qaReport({
      url: tab.url,
      title: tab.page?.title ?? '',
      date: new Date(),
      viewport: tab.page?.viewport ?? { width: 0, height: 0 },
      overlay: overlay ? { name: overlay.name, opacity: overlay.opacity, offsetX: overlay.x, offsetY: overlay.y } : undefined,
      comments,
      notes,
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    a.download = `qa-${new URL(tab.url).hostname}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return (
    <>
      <Group title="Comments">
        <Button variant={tool === 'comment' ? 'primary' : 'outline'} size="sm" onClick={() => setTool(tool === 'comment' ? 'none' : 'comment')}>
          <MessageSquarePlus size={13} />
          {tool === 'comment' ? 'Click the page to pin: Esc to stop' : 'Pin a comment'}
        </Button>
        {comments.length ? (
          <ol className="space-y-2">
            {comments.map((c) => (
              <li key={c.n} className="flex gap-2">
                <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent font-mono text-[10.5px] font-bold text-accent-ink">{c.n}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <TextInput
                    aria-label={`Comment ${c.n}`}
                    value={c.text}
                    placeholder="What’s off?"
                    onChange={(e) => setComments(comments.map((x) => (x.n === c.n ? { ...x, text: e.target.value } : x)))}
                    className="w-full"
                  />
                  <p className="truncate font-mono text-[11px] text-ink-3">{c.selector}</p>
                </div>
                <IconButton label={`Delete comment ${c.n}`} onClick={() => setComments(comments.filter((x) => x.n !== c.n))}>
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12px] text-ink-3">Pins stay on the page, and each one keeps a screenshot for the report.</p>
        )}
      </Group>
      <Group title="Report">
        <Button variant="outline" size="sm" onClick={exportReport} disabled={!comments.length && !notes.length}>
          <Download size={13} />
          Download the QA report (Markdown)
        </Button>
        {comments.length ? (
          <Button variant="ghost" size="sm" onClick={() => setComments([])}>
            <Trash2 size={13} />
            Clear all comments
          </Button>
        ) : null}
      </Group>
    </>
  )
}

