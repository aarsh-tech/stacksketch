import { Component, Fragment, useMemo, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'

import { axisProps, cellCount, defaultAxes, variantGrid } from '@stacksketch/core'
import type { ComponentInfo, PropInfo } from '@stacksketch/core'

/**
 * The canvas page: every component found in the app, rendered as a grid of
 * its prop combinations (sizes across, kinds down) once per theme. A variant
 * that throws shows its error in its cell instead of taking the page down.
 */

export interface CanvasComponent extends ComponentInfo {
  Component: ComponentType<Record<string, unknown>> | undefined
}

export interface CanvasProps {
  components: CanvasComponent[]
  /** default `['light', 'dark']` */
  themes?: string[]
  /** how a theme is applied to its grid: `class` (default) adds it as a class name, anything else is an attribute, like `data-theme` */
  themeAttribute?: string
  /** wraps every cell, for providers */
  Wrapper?: ComponentType<{ children: ReactNode }>
}

// the canvas runs inside someone else's app, so its own few styles live here, light and dark
const CSS = `
.ssv { --bg:#f4f3f0; --panel:#fbfaf8; --ink:#211f1d; --ink2:#5a5652; --ink3:#8b8681; --line:#e0ddd8; --accent:#b24f28; --danger:#b3412f;
  display:grid; grid-template-columns: 220px minmax(0,1fr); min-height:100vh; background:var(--bg); color:var(--ink); font:13px/1.45 ui-sans-serif, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { .ssv { --bg:#141312; --panel:#1a1918; --ink:#ebe8e4; --ink2:#aaa49e; --ink3:#77726c; --line:#2d2b29; --accent:#e9875c; --danger:#e57461; } }
@media (max-width: 720px) { .ssv { grid-template-columns: 1fr; } .ssv-nav { position: static !important; height: auto !important; max-height: 40vh; } }
.ssv * { box-sizing: border-box; }
.ssv-nav { position: sticky; top: 0; height: 100vh; overflow: auto; border-right: 1px solid var(--line); background: var(--panel); padding: 12px; }
.ssv-nav h1 { font-size: 13px; margin: 0 0 8px; } .ssv-nav input { width: 100%; margin-bottom: 8px; }
.ssv-nav button { display: flex; width: 100%; justify-content: space-between; border: 0; background: none; color: var(--ink2); padding: 5px 8px; border-radius: 6px; cursor: pointer; font: inherit; text-align: left; }
.ssv-nav button[aria-current] { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--ink); font-weight: 600; }
.ssv-nav small, .ssv small { color: var(--ink3); font: 11px ui-monospace, Menlo, monospace; }
.ssv-main { padding: 20px; min-width: 0; }
.ssv-main h2 { margin: 0; font-size: 18px; }
.ssv-bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 12px 0 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.ssv-bar label { display: flex; gap: 6px; align-items: center; color: var(--ink2); }
.ssv input, .ssv select { font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; }
.ssv :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.ssv-theme { margin-bottom: 20px; border: 1px solid var(--line); border-radius: 10px; overflow: auto; }
.ssv-theme > header { padding: 6px 12px; border-bottom: 1px solid var(--line); background: var(--panel); color: var(--ink2); font-weight: 600; }
.ssv-surface { padding: 4px; background: #ffffff; color: #211f1d; color-scheme: light; }
.ssv-surface.ssv-dark { background: #141312; color: #ebe8e4; color-scheme: dark; }
.ssv-grid { border-collapse: collapse; }
.ssv-grid th { padding: 8px 12px; color: var(--ink3); font: 11px ui-monospace, Menlo, monospace; text-align: left; white-space: nowrap; }
.ssv-grid td { padding: 16px; vertical-align: middle; }
.ssv-error { max-width: 240px; color: var(--danger); font: 11px ui-monospace, Menlo, monospace; white-space: pre-wrap; }
.ssv-warn { color: var(--danger); }
`

class Boundary extends Component<{ children: ReactNode; onError: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError()
  }
  render() {
    return this.state.error ? <div className="ssv-error">This variant throws: {this.state.error.message}</div> : this.props.children
  }
}

function FixedControl({ prop, value, onChange }: { prop: PropInfo; value: unknown; onChange: (v: unknown) => void }) {
  const t = prop.type
  let control: ReactNode = null
  if (t.kind === 'enum')
    control = (
      <select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
        {prop.optional ? <option value="">default</option> : null}
        {t.values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    )
  else if (t.kind === 'boolean') control = <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  else if (t.kind === 'number') control = <input type="number" value={value === undefined ? '' : Number(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} style={{ width: 70 }} />
  else if (t.kind === 'string' || t.kind === 'node') control = <input value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value || undefined)} style={{ width: 120 }} />
  if (!control) return null
  return (
    <label title={prop.text}>
      {prop.name}
      {control}
    </label>
  )
}

function ComponentGrid({ info, themes, themeAttribute, Wrapper }: { info: CanvasComponent; themes: string[]; themeAttribute: string; Wrapper?: CanvasProps['Wrapper'] }) {
  const initial = useMemo(() => defaultAxes(info.props), [info])
  const [columns, setColumns] = useState(initial.columns ?? '')
  const [rows, setRows] = useState(initial.rows ?? '')
  const [fixed, setFixed] = useState<Record<string, unknown>>({})
  const [shown, setShown] = useState(themes)
  const grid = variantGrid(info, { columns, rows }, fixed)
  // errors are counted per arrangement: changing an axis or a value starts the count again
  const gridKey = JSON.stringify([columns, rows, fixed, shown])
  const [errors, setErrors] = useState({ key: '', n: 0 })
  const broken = errors.key === gridKey ? errors.n : 0
  const axes = axisProps(info.props)
  const others = info.props.filter((p) => p.name !== columns && p.name !== rows)
  const Comp = info.Component
  // function props get a no-op, so onClick and friends don't crash a variant
  const noops = Object.fromEntries(info.props.filter((p) => p.type.kind === 'function').map((p) => [p.name, () => undefined]))
  const cell = (r: number, c: number) => {
    const node = Comp ? <Comp {...noops} {...grid.args(r, c)} /> : null
    return (
      <Boundary key={gridKey} onError={() => setErrors((e) => (e.key === gridKey ? { key: gridKey, n: e.n + 1 } : { key: gridKey, n: 1 }))}>
        {Wrapper ? <Wrapper>{node}</Wrapper> : node}
      </Boundary>
    )
  }
  const pick = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">none</option>
        {axes.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <>
      <h2>{info.name}</h2>
      <small>
        {info.file} · {cellCount(grid)} variants per theme
      </small>
      {!Comp ? <p className="ssv-warn">Couldn’t import {info.exportName ?? info.name} from {info.file}.</p> : null}
      {broken ? <p className="ssv-warn">{broken} variants threw an error. They’re marked in red below.</p> : null}
      <div className="ssv-bar">
        {pick('Across', columns, setColumns)}
        {pick('Down', rows, setRows)}
        {themes.map((t) => (
          <label key={t}>
            <input type="checkbox" checked={shown.includes(t)} onChange={(e) => setShown(e.target.checked ? themes.filter((x) => x === t || shown.includes(x)) : shown.filter((x) => x !== t))} />
            {t}
          </label>
        ))}
        {others.map((p) => (
          <FixedControl key={p.name} prop={p} value={fixed[p.name] ?? grid.args(0, 0)[p.name]} onChange={(v) => setFixed({ ...fixed, [p.name]: v })} />
        ))}
      </div>
      {shown.map((theme) => (
        <section key={theme} className="ssv-theme">
          <header>{theme}</header>
          {/* each theme sits on a surface of its own lightness, so light text in the dark theme stays readable */}
          <div
            {...(themeAttribute === 'class' ? { className: `${theme} ssv-surface${/dark/i.test(theme) ? ' ssv-dark' : ''}` } : { [themeAttribute]: theme, className: `ssv-surface${/dark/i.test(theme) ? ' ssv-dark' : ''}` })}
          >
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
                      <td key={l}>{cell(r, c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}

export function VariantCanvas({ components, themes = ['light', 'dark'], themeAttribute = 'class', Wrapper }: CanvasProps) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(() => decodeURIComponent(location.hash.slice(1)) || components[0]?.name || '')
  const info = components.find((c) => c.name === current) ?? components[0]
  const select = (name: string) => {
    setCurrent(name)
    history.replaceState(null, '', `#${encodeURIComponent(name)}`)
  }
  const list = components.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="ssv">
      <style>{CSS}</style>
      <nav className="ssv-nav" aria-label="Components">
        <h1>Variants</h1>
        <input type="search" placeholder="Find a component" aria-label="Find a component" value={query} onChange={(e) => setQuery(e.target.value)} />
        {list.map((c) => (
          <button key={`${c.file}:${c.name}`} type="button" aria-current={c === info ? 'true' : undefined} onClick={() => select(c.name)}>
            {c.name}
            <small>{c.props.length}</small>
          </button>
        ))}
      </nav>
      <main className="ssv-main">
        {info ? (
          <Fragment key={`${info.file}:${info.name}`}>
            <ComponentGrid info={info} themes={themes} themeAttribute={themeAttribute} Wrapper={Wrapper} />
          </Fragment>
        ) : (
          <p>No components found. Export a PascalCase function component from a .tsx file under src/.</p>
        )}
      </main>
    </div>
  )
}
