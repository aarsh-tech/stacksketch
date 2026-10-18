import type { Shape, StringFormat } from '../types'

/**
 * Shapes as the contract designer edits them: one base (a scalar or an object
 * type), optionally a list, optionally nullable. Anything else (a mix of
 * kinds, a list of lists) is shown as it is and can only be replaced.
 */

export type ScalarKind = 'string' | StringFormat | 'integer' | 'number' | 'boolean' | 'enum' | 'unknown'

export interface ShapeParts {
  base: ScalarKind | { ref: string }
  list: boolean
  nullable: boolean
  /** for `enum` */
  values: string[]
}

export const STRING_FORMATS: StringFormat[] = ['email', 'uuid', 'uri', 'date-time', 'date']

const nonNull = (shape: Shape): Shape[] => (shape.kind === 'union' ? shape.options.filter((o) => o.kind !== 'null') : shape.kind === 'null' ? [] : [shape])
const isNullable = (shape: Shape) => shape.kind === 'null' || (shape.kind === 'union' && shape.options.some((o) => o.kind === 'null'))

function leafBase(shape: Shape): ShapeParts['base'] | null {
  switch (shape.kind) {
    case 'string':
      return shape.format ?? 'string'
    case 'number':
      return shape.integer ? 'integer' : 'number'
    case 'boolean':
    case 'enum':
    case 'unknown':
      return shape.kind
    case 'ref':
      return { ref: shape.name }
    default:
      return null
  }
}

/** The editable parts of a shape, or null when it's something the picker can't show (a mix of kinds, a list of lists). */
export function shapeParts(shape: Shape): ShapeParts | null {
  const nullable = isNullable(shape)
  const options = nonNull(shape)
  if (options.length === 0) return { base: 'unknown', list: false, nullable, values: [] }
  if (options.length > 1) return null
  const one = options[0]
  const list = one.kind === 'array'
  const leaf = one.kind === 'array' ? one.items : one
  const base = leafBase(leaf)
  if (!base) return null
  return { base, list, nullable, values: leaf.kind === 'enum' ? leaf.values : [] }
}

/** The leaf a shape holds (the item of a list, without null), to keep its examples when only the list or null part changes. */
function leafOf(shape: Shape | undefined): Shape | undefined {
  const one = shape ? nonNull(shape) : []
  if (one.length !== 1) return undefined
  return one[0].kind === 'array' ? one[0].items : one[0]
}

const sameBase = (a: ShapeParts['base'], b: ShapeParts['base']) => (typeof a === 'string' ? a === b : typeof b !== 'string' && a.ref === b.ref)

/** Build a shape from its parts. `previous` keeps sample values (used for mock data) when the base doesn't change. */
export function shapeFromParts(parts: ShapeParts, previous?: Shape): Shape {
  const before = leafOf(previous)
  const keep = before && leafBase(before) && sameBase(leafBase(before) as ShapeParts['base'], parts.base) && parts.base !== 'enum' ? before : undefined
  let leaf: Shape
  const b = parts.base
  if (keep) leaf = keep
  else if (typeof b !== 'string') leaf = { kind: 'ref', name: b.ref }
  else if (b === 'string') leaf = { kind: 'string' }
  else if (b === 'integer' || b === 'number') leaf = { kind: 'number', integer: b === 'integer' }
  else if (b === 'boolean' || b === 'unknown') leaf = { kind: b }
  else if (b === 'enum') leaf = parts.values.length ? { kind: 'enum', values: parts.values } : { kind: 'string' }
  else leaf = { kind: 'string', format: b }
  const value: Shape = parts.list ? { kind: 'array', items: leaf } : leaf
  if (!parts.nullable || value.kind === 'unknown') return value
  return { kind: 'union', options: [value, { kind: 'null' }] }
}

/** A short label: `Order`, `Order[]`, `email`, `integer | null`. */
export function shapeLabel(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
      return shape.format ?? 'string'
    case 'number':
      return shape.integer ? 'integer' : 'number'
    case 'enum':
      return shape.values.length === 1 ? JSON.stringify(shape.values[0]) : 'enum'
    case 'ref':
      return shape.name
    case 'array': {
      const inner = shapeLabel(shape.items)
      return shape.items.kind === 'union' ? `(${inner})[]` : `${inner}[]`
    }
    case 'union':
      return shape.options.map(shapeLabel).join(' | ')
    default:
      return shape.kind
  }
}

/** Point every ref in a shape somewhere else. */
export function mapRefs(shape: Shape, fn: (name: string) => Shape): Shape {
  switch (shape.kind) {
    case 'ref':
      return fn(shape.name)
    case 'array':
      return { kind: 'array', items: mapRefs(shape.items, fn) }
    case 'union':
      return { kind: 'union', options: shape.options.map((o) => mapRefs(o, fn)) }
    default:
      return shape
  }
}

/** Whether a shape can be a path or query param: a scalar (strings, numbers, booleans, enums) or, for query params, a list of them. */
export function isParamShape(shape: Shape, allowList: boolean): boolean {
  const parts = shapeParts(shape)
  if (!parts || typeof parts.base !== 'string' || parts.base === 'unknown') return false
  return allowList || !parts.list
}

/** Two shapes describe the same values (sample values and ranges aside). */
export function sameShape(a: Shape, b: Shape): boolean {
  const strip = (s: Shape): unknown =>
    s.kind === 'string'
      ? { kind: 'string', format: s.format }
      : s.kind === 'number'
        ? { kind: 'number', integer: s.integer }
        : s.kind === 'array'
          ? { kind: 'array', items: strip(s.items) }
          : s.kind === 'union'
            ? { kind: 'union', options: s.options.map(strip) }
            : s
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}
