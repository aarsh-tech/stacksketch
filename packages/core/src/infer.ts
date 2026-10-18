import { itemName, pascalCase } from './names'
import type { Field, ObjectType, Schema, Shape, StringFormat } from './types'

/* ---------- stage 1: a raw shape tree, merged across samples ---------- */

type Raw =
  | { kind: 'string'; format: StringFormat | null | undefined; examples: string[] }
  | { kind: 'number'; integer: boolean; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'unknown' }
  | { kind: 'array'; items: Raw }
  | { kind: 'object'; fields: Map<string, { shape: Raw; count: number }>; count: number }
  | { kind: 'union'; options: Raw[] }

const MAX_EXAMPLES = 8

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URI = /^https?:\/\/[^\s]+$/

export function detectFormat(s: string): StringFormat | undefined {
  if (UUID.test(s)) return 'uuid'
  if (DATE_TIME.test(s) && !Number.isNaN(Date.parse(s))) return 'date-time'
  if (DATE.test(s) && !Number.isNaN(Date.parse(s))) return 'date'
  if (EMAIL.test(s)) return 'email'
  if (URI.test(s)) return 'uri'
  return undefined
}

function fromValue(v: unknown): Raw {
  if (v === null) return { kind: 'null' }
  switch (typeof v) {
    case 'string':
      return { kind: 'string', format: detectFormat(v) ?? null, examples: [v] }
    case 'number':
      return { kind: 'number', integer: Number.isInteger(v), min: v, max: v }
    case 'boolean':
      return { kind: 'boolean' }
    case 'object': {
      if (Array.isArray(v)) return { kind: 'array', items: v.reduce<Raw>((acc, x) => merge(acc, fromValue(x)), { kind: 'unknown' }) }
      const fields = new Map<string, { shape: Raw; count: number }>()
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) fields.set(k, { shape: fromValue(x), count: 1 })
      return { kind: 'object', fields, count: 1 }
    }
    default:
      return { kind: 'unknown' }
  }
}

const flat = (r: Raw): Raw[] => (r.kind === 'union' ? r.options : [r])

function mergeSame(a: Raw, b: Raw): Raw {
  switch (a.kind) {
    case 'string': {
      const bs = b as typeof a
      // null = "seen, no format"; undefined = "formats disagree"
      const format = a.format === bs.format ? a.format : undefined
      const examples = [...new Set([...a.examples, ...bs.examples])].slice(0, MAX_EXAMPLES)
      return { kind: 'string', format, examples }
    }
    case 'number': {
      const bn = b as typeof a
      return { kind: 'number', integer: a.integer && bn.integer, min: Math.min(a.min, bn.min), max: Math.max(a.max, bn.max) }
    }
    case 'array':
      return { kind: 'array', items: merge(a.items, (b as typeof a).items) }
    case 'object': {
      const bo = b as typeof a
      const fields = new Map(a.fields)
      for (const [k, f] of bo.fields) {
        const prev = fields.get(k)
        fields.set(k, prev ? { shape: merge(prev.shape, f.shape), count: prev.count + f.count } : f)
      }
      return { kind: 'object', fields, count: a.count + bo.count }
    }
    default:
      return a
  }
}

const ORDER: Raw['kind'][] = ['object', 'array', 'string', 'number', 'boolean', 'null']

function merge(a: Raw, b: Raw): Raw {
  if (a.kind === 'unknown') return b
  if (b.kind === 'unknown') return a
  const byKind = new Map<Raw['kind'], Raw>()
  for (const r of [...flat(a), ...flat(b)]) {
    const prev = byKind.get(r.kind)
    byKind.set(r.kind, prev ? mergeSame(prev, r) : r)
  }
  const options = [...byKind.values()].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind))
  return options.length === 1 ? options[0] : { kind: 'union', options }
}

/* ---------- stage 2: name every object and build the schema ---------- */

class Registry {
  types: ObjectType[] = []
  private signatures = new Map<string, string>()

  add(hint: string, fields: Field[]): string {
    const signature = JSON.stringify(fields, (k, v) => (k === 'examples' || k === 'min' || k === 'max' ? undefined : v))
    for (let n = 1; ; n++) {
      const name = n === 1 ? hint : `${hint}${n}`
      const existing = this.signatures.get(name)
      if (existing === undefined) {
        this.signatures.set(name, signature)
        this.types.push({ name, fields })
        return name
      }
      if (existing === signature) {
        // same structure seen twice: reuse it, but let it learn new examples
        const type = this.types.find((t) => t.name === name)
        if (type) type.fields = fields.map((f, i) => ({ ...f, shape: widenExamples(type.fields[i].shape, f.shape) }))
        return name
      }
    }
  }
}

function widenExamples(a: Shape, b: Shape): Shape {
  if (a.kind === 'string' && b.kind === 'string') {
    const examples = [...new Set([...(a.examples ?? []), ...(b.examples ?? [])])].slice(0, MAX_EXAMPLES)
    return { ...a, examples }
  }
  if (a.kind === 'number' && b.kind === 'number') {
    return { ...a, min: Math.min(a.min ?? Infinity, b.min ?? Infinity), max: Math.max(a.max ?? -Infinity, b.max ?? -Infinity) }
  }
  return a
}

/** Keys too vague to name a type on their own: `items` inside `Order` becomes `OrderItem`. */
const GENERIC = new Set(
  'item items data datum result results value values entry entries node nodes meta metadata info detail details attributes attrs props properties options settings config payload record records element elements child children line lines row rows'.split(' '),
)

function toShape(raw: Raw, hint: string, reg: Registry, isRoot = false): Shape {
  switch (raw.kind) {
    case 'string':
      return { kind: 'string', ...(raw.format ? { format: raw.format } : {}), examples: raw.examples }
    case 'number':
      return { kind: 'number', integer: raw.integer, min: raw.min, max: raw.max }
    case 'boolean':
    case 'null':
    case 'unknown':
      return { kind: raw.kind }
    case 'array':
      return { kind: 'array', items: toShape(raw.items, itemName(hint), reg) }
    case 'union':
      return { kind: 'union', options: raw.options.map((o) => toShape(o, hint, reg)) }
    case 'object': {
      const fields: Field[] = [...raw.fields].map(([key, f]) => {
        const own = pascalCase(key)
        const childHint = !isRoot && GENERIC.has(own.toLowerCase()) ? pascalCase(hint) + own : own
        return { key, shape: toShape(f.shape, childHint, reg), optional: f.count < raw.count }
      })
      return { kind: 'ref', name: reg.add(pascalCase(hint), fields) }
    }
  }
}

/**
 * Infer a schema from one or more sample values (usually parsed JSON
 * responses). Several samples are merged: a key missing from some becomes
 * optional, and a key that is sometimes `null` becomes nullable.
 *
 * When the root is an array, its items take `rootName` and the array itself
 * is `${rootName}List`.
 */
export function inferSchema(samples: unknown[], rootName = 'Root'): Schema {
  const name = pascalCase(rootName)
  const raw = samples.reduce<Raw>((acc, s) => merge(acc, fromValue(s)), { kind: 'unknown' })
  const reg = new Registry()
  let root: Shape
  if (raw.kind === 'array') root = { kind: 'array', items: toShape(raw.items, name, reg) }
  else root = toShape(raw, name, reg, true)
  return { version: 1, rootName: name, root, types: reg.types }
}

/** Names of the object types a shape points at directly, in order. */
export function refsOf(shape: Shape): string[] {
  switch (shape.kind) {
    case 'ref':
      return [shape.name]
    case 'array':
      return refsOf(shape.items)
    case 'union':
      return shape.options.flatMap(refsOf)
    default:
      return []
  }
}

/** The name a generator should give the root type. */
export function rootTypeName(schema: Schema): string {
  const r = schema.root
  if (r.kind === 'ref') return r.name
  if (r.kind === 'array') return `${schema.rootName}List`
  return schema.rootName
}

/** Every type reachable from the root, breadth first from the root: the order people read a response in. */
export function typesTopDown(schema: Schema): ObjectType[] {
  const byName = new Map(schema.types.map((t) => [t.name, t]))
  const seen = new Set<string>()
  const out: ObjectType[] = []
  const queue = refsOf(schema.root)
  while (queue.length) {
    const name = queue.shift() as string
    const type = byName.get(name)
    if (!type || seen.has(name)) continue
    seen.add(name)
    out.push(type)
    for (const f of type.fields) queue.push(...refsOf(f.shape))
  }
  return out
}
