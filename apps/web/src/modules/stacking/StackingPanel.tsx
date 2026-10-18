import { useMemo, useState } from 'react'
import { Layers, RefreshCw } from 'lucide-react'

import { compareStacking, stackingTree } from '@stacksketch/core'
import type { StackingContext } from '@stacksketch/core'
import { Button, Group } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import type { StackScan } from '@/lib/stackingScan'

/** Every context, back to front as the browser paints them, with its place in that order. */
function flatten(root: StackingContext): StackingContext[] {
  const out: StackingContext[] = []
  const walk = (n: StackingContext) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(root)
  return out
}

/**
 * The stacking inspector: an exploded 3D view of the stacking contexts, the
 * list back to front, and why each one is a context. Shared by the workbench
 * and the browser extension's side panel.
 */
export function StackingPanel({
  scan,
  onScan,
  onHighlight,
  picked: pickedProp,
  onPickedChange,
  stage = 260,
  stageHeight = 300,
  scanLabel = ['Scan the page', 'Scan the page again'],
}: {
  scan: StackScan | null
  onScan: () => void
  onHighlight: (index: number | null) => void
  /** the picked contexts, when the caller keeps them (the last one is shown) */
  picked?: number[]
  onPickedChange?: (picked: number[]) => void
  /** the width of the 3D view's page, in pixels */
  stage?: number
  stageHeight?: number
  scanLabel?: [string, string]
}) {
  const tree = useMemo(() => (scan ? stackingTree(scan.elements) : null), [scan])
  const layers = useMemo(() => (tree ? flatten(tree) : []), [tree])
  const [ownPicked, setOwnPicked] = useState<number[]>([])
  const picked = pickedProp ?? ownPicked
  const setPicked = onPickedChange ?? setOwnPicked
  const [spread, setSpread] = useState(36)
  const [tilt, setTilt] = useState(true)

  const pick = (index: number) => {
    const next = picked.includes(index) ? picked.filter((i) => i !== index) : [...picked, index].slice(-2)
    setPicked(next)
    onHighlight(next.at(-1) ?? null)
  }
  const selected = layers.find((l) => l.index === picked.at(-1))
  const scale = scan ? stage / Math.max(scan.page.width, 1) : 1

  return (
    <>
      <Group title="Stacking contexts">
        <Button variant="outline" size="sm" onClick={onScan}>
          {scan ? <RefreshCw size={13} /> : <Layers size={13} />}
          {scan ? scanLabel[1] : scanLabel[0]}
        </Button>
        {scan ? (
          <p className="text-[12px] text-ink-3">
            {layers.length} stacking contexts in {scan.elements.length} elements{scan.truncated ? ' (the first 6,000 only)' : ''}. Click one to see why it’s a context; click two to see which wins.
          </p>
        ) : (
          <p className="text-[12px] text-ink-3">See every stacking context as a layer, and why your modal is behind the header.</p>
        )}
      </Group>
      {tree ? (
        <>
          <div className="border-b border-line px-4 py-3">
            <div className="mb-2 flex items-center gap-3 text-[12px] text-ink-3">
              <label className="flex flex-1 items-center gap-2">
                Spread
                <input type="range" min={8} max={80} value={spread} onChange={(e) => setSpread(Number(e.target.value))} className="flex-1 accent-[var(--c-accent)]" />
              </label>
              <button type="button" className="rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink" onClick={() => setTilt(!tilt)}>
                {tilt ? 'Flat' : '3D'}
              </button>
            </div>
            <div className="relative overflow-hidden rounded-md bg-canvas" style={{ perspective: '900px', height: stageHeight }} aria-label="Stacking contexts in 3D, back to front">
              <div
                className="absolute top-1/2 left-1/2 transition-transform duration-300"
                style={{
                  width: stage,
                  height: (scan?.page.height ?? 0) * scale,
                  transformStyle: 'preserve-3d',
                  transform: `translate(-50%, -50%) ${tilt ? 'rotateX(58deg) rotateZ(-38deg)' : ''} scale(${tilt ? 0.8 : 0.9})`,
                }}
              >
                {layers.map((l, order) => (
                  <button
                    key={l.index}
                    type="button"
                    title={`${l.label} · z-index ${l.zIndex}`}
                    onClick={() => pick(l.index)}
                    className={cx(
                      'absolute rounded-[2px] border transition-colors',
                      picked.includes(l.index) ? 'border-accent bg-accent/35' : 'border-ink-3/60 bg-raised/50 hover:border-accent hover:bg-accent/15',
                    )}
                    style={{
                      left: l.rect.x * scale,
                      top: l.rect.y * scale,
                      width: Math.max(4, l.rect.width * scale),
                      height: Math.max(4, l.rect.height * scale),
                      transform: tilt ? `translateZ(${l.depth * spread + order * 0.5}px)` : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          {picked.length === 2 ? (
            <Group title="Which one wins">
              <p className="text-[12.5px] text-ink">{compareStacking(tree, picked[0], picked[1])}</p>
            </Group>
          ) : null}
          {selected ? (
            <Group title={selected.label}>
              <p className="text-[12.5px] text-ink-2">
                Starts a stacking context because {selected.reasons.join(', and ')}. It’s painted with z-index {selected.zIndex} among its siblings, and nothing inside it can rise above them.
              </p>
            </Group>
          ) : null}
          <Group title="Back to front">
            <ul className="space-y-px">
              {layers.map((l) => (
                <li key={l.index}>
                  <button
                    type="button"
                    onClick={() => pick(l.index)}
                    className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px]', picked.includes(l.index) ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-hover')}
                    style={{ paddingLeft: 8 + l.depth * 12 }}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{l.label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-t-number">{l.zIndex}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Group>
        </>
      ) : null}
    </>
  )
}
