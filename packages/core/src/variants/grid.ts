import { humanize } from '../form/model'

/**
 * The variant canvas's grid: given a component's props (read from its
 * TypeScript types by the dev-server plugin), pick the props worth laying out
 * as rows and columns, and the arguments for every cell.
 */

export type PropType =
  | { kind: 'enum'; values: string[] }
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'string' }
  /** ReactNode, children and the like */
  | { kind: 'node' }
  | { kind: 'function' }
  | { kind: 'other' }

export interface PropInfo {
  name: string
  optional: boolean
  type: PropType
  /** the type as written, for the controls: `'sm' | 'md' | 'lg'` */
  text: string
}

export interface ComponentInfo {
  name: string
  /** the module's path, as the dev server imports it */
  file: string
  /** the export to render, when it isn't `name` (a default export) */
  exportName?: string
  props: PropInfo[]
}

export interface Axis {
  prop: string
  values: unknown[]
  labels: string[]
}

export interface Grid {
  rows: Axis | null
  columns: Axis | null
  /** the arguments of the cell at a row and column (indexes; 0 when that axis is missing) */
  args: (row: number, column: number) => Record<string, unknown>
}

/** Props that make good axes: enums with a few values, and booleans. */
export const axisProps = (props: PropInfo[]) => props.filter((p) => (p.type.kind === 'enum' && p.type.values.length <= 12) || p.type.kind === 'boolean')

const SIZE = /^(size|scale|density)$/i
const KIND = /^(variant|kind|tone|intent|color|colour|appearance|type|status|state)$/i

/** The axes a component opens with: sizes across, kinds down, else the first two enums or booleans. */
export function defaultAxes(props: PropInfo[]): { columns?: string; rows?: string } {
  const candidates = axisProps(props)
  const enums = candidates.filter((p) => p.type.kind === 'enum')
  const columns = enums.find((p) => SIZE.test(p.name)) ?? enums.find((p) => !KIND.test(p.name)) ?? candidates[0]
  const rest = candidates.filter((p) => p !== columns)
  const rows = rest.find((p) => KIND.test(p.name)) ?? rest.find((p) => p.type.kind === 'enum') ?? rest[0]
  return { columns: columns?.name, rows: rows?.name }
}

/** A value for every prop the component needs, so it renders: the first enum value, `false`, the prop's name as text. */
export function defaultArgs(props: PropInfo[], componentName = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of props) {
    switch (p.type.kind) {
      case 'enum':
        if (!p.optional) out[p.name] = p.type.values[0]
        break
      case 'boolean':
        if (!p.optional) out[p.name] = false
        break
      case 'number':
        if (!p.optional) out[p.name] = 1
        break
      case 'string':
        if (!p.optional || /^(label|title|text|placeholder|name)$/i.test(p.name)) out[p.name] = humanize(p.name)
        break
      case 'node':
        // children and the like get something to show
        if (!p.optional || p.name === 'children') out[p.name] = p.name === 'children' ? humanize(componentName) || 'Content' : humanize(p.name)
        break
      default:
        break
    }
  }
  return out
}

function axisOf(props: PropInfo[], name: string | undefined): Axis | null {
  const p = props.find((x) => x.name === name)
  if (!p) return null
  if (p.type.kind === 'enum') {
    const values: unknown[] = [...(p.optional ? [undefined] : []), ...p.type.values]
    return { prop: p.name, values, labels: values.map((v) => (v === undefined ? 'default' : String(v))) }
  }
  if (p.type.kind === 'boolean') return { prop: p.name, values: [false, true], labels: [`${p.name}: false`, `${p.name}: true`] }
  return null
}

/** The grid for a component: `fixed` holds the values set by hand for the props that aren't axes. */
export function variantGrid(component: ComponentInfo, axes: { rows?: string; columns?: string }, fixed: Record<string, unknown> = {}): Grid {
  const base = { ...defaultArgs(component.props, component.name), ...fixed }
  const columns = axisOf(component.props, axes.columns)
  const rows = axes.rows === axes.columns ? null : axisOf(component.props, axes.rows)
  return {
    rows,
    columns,
    args: (row, column) => {
      const args = { ...base }
      for (const [axis, i] of [
        [rows, row],
        [columns, column],
      ] as const) {
        if (!axis) continue
        const v = axis.values[i]
        if (v === undefined) delete args[axis.prop]
        else args[axis.prop] = v
      }
      return args
    },
  }
}

/** How many cells a grid has per theme. */
export const cellCount = (g: Grid) => (g.rows?.values.length ?? 1) * (g.columns?.values.length ?? 1)
