import { Component, use, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { ArrowRight, RotateCcw, TriangleAlert } from 'lucide-react'

import { axisProps, cellCount, componentsFromSource, defaultAxes, variantGrid } from '@stacksketch/core'
import type { ComponentInfo, PropInfo } from '@stacksketch/core'
import { Button, Checkbox, IconButton, Pane, Segmented, Select, Tabs, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { SAMPLE_VARIANTS_CSS, SAMPLE_VARIANTS_TSX } from '@/lib/sampleVariants'
import { RunOutside } from '@/modules/RunOutside'
import { useForms } from '@/store/forms'
import { useUi } from '@/store/ui'
import { useVariants } from '@/store/variants'
import { compileComponents, loadSucrase } from './compile'

const THEMES = ['light', 'dark']

// the grid's own look inside the shadow root; the app's colour tokens are custom properties, so they reach in
const CHROME = `
:host { display: block; color: var(--c-ink); }
* { box-sizing: border-box; }
.ssv-theme { margin: 16px; border: 1px solid var(--c-line); border-radius: 10px; overflow: hidden; background: var(--c-panel); }
.ssv-theme > header { padding: 6px 12px; border-bottom: 1px solid var(--c-line); color: var(--c-ink-2); font: 600 12px/1.5 'Schibsted Grotesk Variable', system-ui, sans-serif; }
.ssv-surface { overflow: auto; padding: 4px; background: var(--c-stage-light); color: var(--c-stage-light-ink); color-scheme: light; }
.ssv-surface.ssv-dark { background: var(--c-stage-dark); color: var(--c-stage-dark-ink); color-scheme: dark; }
.ssv-grid { border-collapse: collapse; }
.ssv-grid th { padding: 8px 12px; opacity: 0.6; font: 500 11px/1.3 'JetBrains Mono Variable', ui-monospace, monospace; text-align: left; white-space: nowrap; }
.ssv-grid td { padding: 16px; vertical-align: middle; }
.ssv-error { max-width: 240px; padding: 6px 8px; border: 1px dashed var(--c-danger); border-radius: 6px; color: var(--c-danger); font: 11px/1.4 'JetBrains Mono Variable', ui-monospace, monospace; white-space: pre-wrap; }
`

/* ---------- rendering into a shadow root ---------- */

/**
 * A React root inside a shadow root: the pasted CSS stays in, the app's CSS
 * stays out, and the component's events work because the root listens inside.
 */
function ShadowStage({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const root = useRef<Root | null>(null)
  useEffect(() => {
    const el = host.current!
    const shadow = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    const mount = document.createElement('div')
    shadow.append(mount)
    const r = createRoot(mount)
    root.current = r
    return () => {
      root.current = null
      // unmount after React finishes the commit it's in
      setTimeout(() => {
        r.unmount()
        mount.remove()
      })
    }
  }, [])
  useEffect(() => {
    root.current?.render(children)
  })
  return <div ref={host} className="min-h-full" />
}

class Boundary extends Component<{ children: ReactNode; onError: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.error ? <div className="ssv-error">This variant throws: {this.state.error.message}</div> : this.props.children
  }
}

/* ---------- controls ---------- */

function FixedControl({ prop, value, onChange }: { prop: PropInfo; value: unknown; onChange: (v: unknown) => void }) {
  const t = prop.type
  const label = <span className="font-mono text-[11.5px] text-ink-3">{prop.name}</span>
  if (t.kind === 'boolean') return <Checkbox label={prop.name} checked={Boolean(value)} onChange={onChange} />
  if (t.kind === 'enum')
    return (
      <label className="flex items-center gap-1.5" title={prop.text}>
        {label}
        <Select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
          {prop.optional ? <option value="">default</option> : null}
          {t.values.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
      </label>
    )
  if (t.kind === 'number')
    return (
      <label className="flex items-center gap-1.5" title={prop.text}>
        {label}
        <input type="number" value={value === undefined ? '' : Number(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} className={cx(inputClass, 'w-20 font-mono')} />
      </label>
    )
  if (t.kind === 'string' || t.kind === 'node')
    return (
      <label className="flex items-center gap-1.5" title={prop.text}>
        {label}
        <TextInput value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} className="w-32" />
      </label>
    )
  return null
}

/* ---------- one component's grid ---------- */

function VariantGrid({ info, Comp, css, themes }: { info: ComponentInfo; Comp: ComponentType<Record<string, unknown>>; css: string; themes: string[] }) {
  const initial = useMemo(() => defaultAxes(info.props), [info])
  const [columns, setColumns] = useState(initial.columns ?? '')
  const [rows, setRows] = useState(initial.rows ?? '')
  const [fixed, setFixed] = useState<Record<string, unknown>>({})
  const grid = variantGrid(info, { columns, rows }, fixed)
  // errors are counted per arrangement: changing an axis, a value or the code starts the count again
  const gridKey = JSON.stringify([columns, rows, fixed, themes, css.length]) + String(Comp)
  const [errors, setErrors] = useState({ key: '', n: 0 })
  const broken = errors.key === gridKey ? errors.n : 0
  const axes = axisProps(info.props)
  const others = info.props.filter((p) => p.name !== columns && p.name !== rows)
  // function props get a no-op, so onClick and friends don't crash a variant
  const noops = Object.fromEntries(info.props.filter((p) => p.type.kind === 'function').map((p) => [p.name, () => undefined]))
  const onError = () => setErrors((e) => (e.key === gridKey ? { key: gridKey, n: e.n + 1 } : { key: gridKey, n: 1 }))

  const axisPicker = (label: string, value: string, setValue: (v: string) => void) => (
    <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
      {label}
      <Select value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">none</option>
        {axes.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </Select>
    </label>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
        {axisPicker('Across', columns, setColumns)}
        {axisPicker('Down', rows, setRows)}
        {others.map((p) => (
          <FixedControl key={p.name} prop={p} value={fixed[p.name] ?? grid.args(0, 0)[p.name]} onChange={(v) => setFixed({ ...fixed, [p.name]: v })} />
        ))}
        <span className="ml-auto text-[12px] text-ink-3">
          {cellCount(grid) * themes.length} variants
          {broken ? <span className="ml-2 font-medium text-danger">{broken} throw</span> : null}
        </span>
      </div>
      <div className="paper-grid relative min-h-0 flex-1 overflow-auto scrollbar-thin">
        <ShadowStage>
          <style>{CHROME + css.replace(/:root\b/g, ':host')}</style>
          {themes.map((theme) => (
            <section key={theme} className="ssv-theme">
              <header>{theme}</header>
              {/* the theme is a class on the surface, so `.dark .btn` in the pasted CSS applies */}
              <div className={`${theme} ssv-surface${/dark/i.test(theme) ? ' ssv-dark' : ''}`} data-theme={theme}>
                <table className="ssv-grid">
                  {grid.columns ? (
                    <thead>
                      <tr>
                        {grid.rows ? <th /> : null}
                        {grid.columns.labels.map((l) => (
                          <th key={l} scope="col">
                            {grid.columns!.prop}: {l}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {(grid.rows?.labels ?? ['']).map((rowLabel, r) => (
                      <tr key={rowLabel}>
                        {grid.rows ? (
                          <th scope="row">
                            {grid.rows.prop}: {rowLabel}
                          </th>
                        ) : null}
                        {(grid.columns?.labels ?? ['']).map((l, c) => (
                          <td key={l}>
                            <Boundary key={gridKey} onError={onError}>
                              <Comp {...noops} {...grid.args(r, c)} />
                            </Boundary>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </ShadowStage>
      </div>
    </div>
  )
}

/* ---------- the module ---------- */

export default function Variants() {
  const sucrase = use(loadSucrase())
  const source = useVariants((s) => s.source)
  const css = useVariants((s) => s.css)
  const tab = useVariants((s) => s.tab)
  const picked = useVariants((s) => s.component)
  const themes = useVariants((s) => s.themes)
  const mobilePane = useVariants((s) => s.mobilePane)
  const set = useVariants((s) => s.set)
  const setModule = useUi((s) => s.setModule)
  const setForms = useForms((s) => s.set)

  const read = useMemo(() => componentsFromSource(source), [source])
  const compiled = useMemo(() => compileComponents(sucrase, source), [sucrase, source])
  const info = read.components.find((c) => c.name === picked) ?? read.components[0]
  const exported = compiled.ok && info ? compiled.exports[info.exportName ?? info.name] : undefined
  const Comp = typeof exported === 'function' || (typeof exported === 'object' && exported !== null) ? (exported as ComponentType<Record<string, unknown>>) : null

  const problem = !compiled.ok
    ? `${compiled.stage === 'compile' ? 'The code doesn’t compile' : 'The code throws when it loads'}: ${compiled.message}`
    : info && !Comp
      ? `${info.name} isn’t exported as a component. Check the export.`
      : null
  const show = (pane: 'code' | 'canvas') => (mobilePane === pane ? 'flex' : 'max-xl:hidden')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'code', label: 'Component' },
            { value: 'canvas', label: 'Variants' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('code'), 'xl:flex')} aria-label="Component source">
          <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
            <div className="min-w-0 flex-1">
              <Tabs
                label="File"
                value={tab}
                onChange={(t) => set({ tab: t })}
                options={[
                  { value: 'tsx', label: 'Component.tsx' },
                  { value: 'css', label: 'styles.css' },
                ]}
              />
            </div>
            <IconButton label="Load the sample" onClick={() => set({ source: SAMPLE_VARIANTS_TSX, css: SAMPLE_VARIANTS_CSS, component: '' })}>
              <RotateCcw size={15} />
            </IconButton>
          </header>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 flex flex-col gap-2 p-3">
              <p className="text-[12px] text-ink-3">
                {tab === 'tsx'
                  ? 'Paste a React component file. Its props are read from the TypeScript types; react, clsx and classnames imports work.'
                  : 'The CSS the components need. Put dark styles under a .dark class: each theme is a class on its surface.'}
              </p>
              <textarea
                key={tab}
                aria-label={tab === 'tsx' ? 'Component source' : 'CSS'}
                value={tab === 'tsx' ? source : css}
                wrap="off"
                spellCheck={false}
                onChange={(e) => set(tab === 'tsx' ? { source: e.target.value } : { css: e.target.value })}
                className={cx(inputClass, 'h-auto min-h-0 w-full flex-1 resize-none py-2 font-mono text-[12px] leading-relaxed')}
              />
              {problem || read.warnings.length ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink scrollbar-thin">
                  {[...(problem ? [problem] : []), ...read.warnings].map((p) => (
                    <li key={p} className="flex gap-1.5">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                      <span className="min-w-0 break-words">{p}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </section>

        <Pane
          title="Variants"
          meta={info ? `${info.name} · ${info.props.length} props` : undefined}
          className={cx(show('canvas'), 'xl:flex')}
          actions={<RunOutside id="variants" label="Run it in your app" />}
          toolbar={
            <>
              {read.components.length > 1 ? (
                <Select aria-label="Component" value={info?.name ?? ''} onChange={(e) => set({ component: e.target.value })} className="font-mono">
                  {read.components.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </Select>
              ) : null}
              {THEMES.map((t) => (
                <Checkbox
                  key={t}
                  label={t === 'light' ? 'Light' : 'Dark'}
                  checked={themes.includes(t)}
                  onChange={(on) => set({ themes: on ? THEMES.filter((x) => x === t || themes.includes(x)) : themes.filter((x) => x !== t) })}
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setForms({ view: 'states' })
                  setModule('form-builder')
                }}
              >
                Form states
                <ArrowRight size={13} />
              </Button>
            </>
          }
        >
          <div className="absolute inset-0">
            {info && Comp ? (
              <VariantGrid key={`${info.name}:${info.props.map((p) => `${p.name}:${p.type.kind}`).join(',')}`} info={info} Comp={Comp} css={css} themes={themes} />
            ) : (
              <div className="paper-grid flex h-full items-center justify-center p-6 text-center text-[13px] text-ink-3">
                <p className="max-w-sm">{problem ?? read.warnings[0] ?? 'Paste a component to see every prop combination.'}</p>
              </div>
            )}
          </div>
        </Pane>
      </div>
    </div>
  )
}
