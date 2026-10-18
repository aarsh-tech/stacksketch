import { pascalCase } from './names'
import type { Field, Schema, Shape, StringFormat } from './types'

/**
 * Hand edits on top of an inferred schema. They're keyed by the *inferred*
 * type name and the field key, so pasting a new sample re-infers the schema
 * and the edits still apply to it.
 */
export interface Overrides {
  types: Record<string, TypeOverride>
}

export interface TypeOverride {
  rename?: string
  fields?: Record<string, FieldOverride>
}

/** What a field's value can be changed to. Refs and arrays keep their type; you rename the type they point at instead. */
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'unknown'

export interface FieldOverride {
  optional?: boolean
  nullable?: boolean
  type?: FieldType
  /** for strings; `null` removes a detected format */
  format?: StringFormat | null
  /** for enums; defaults to the sample values */
  values?: string[]
}

export const emptyOverrides = (): Overrides => ({ types: {} })

/* ---------- reading a field ---------- */

const nonNull = (shape: Shape): Shape[] => (shape.kind === 'union' ? shape.options : [shape]).filter((o) => o.kind !== 'null')
const isNullable = (shape: Shape) => shape.kind === 'null' || (shape.kind === 'union' && shape.options.some((o) => o.kind === 'null'))

/** The editable type of a field, or null when it holds an object, an array or a mix of kinds. */
export function fieldType(shape: Shape): FieldType | null {
  const base = nonNull(shape)
  if (base.length === 0) return 'unknown' // always null in the samples
  if (base.length > 1) return null
  const b = base[0]
  switch (b.kind) {
    case 'string':
    case 'boolean':
    case 'enum':
    case 'unknown':
      return b.kind
    case 'number':
      return b.integer ? 'integer' : 'number'
    default:
      return null
  }
}

export function fieldFormat(shape: Shape): StringFormat | undefined {
  const b = nonNull(shape)
  return b.length === 1 && b[0].kind === 'string' ? b[0].format : undefined
}

export function fieldNullable(shape: Shape): boolean {
  return isNullable(shape)
}

/** Sample string values of a field, for turning it into an enum. */
export function sampleValues(shape: Shape): string[] {
  const values = new Set<string>()
  for (const o of nonNull(shape)) {
    if (o.kind === 'string') o.examples?.forEach((v) => values.add(v))
    if (o.kind === 'enum') o.values.forEach((v) => values.add(v))
  }
  return [...values]
}

const ENUM_KEYS = new Set('status type kind role currency level category gender method mode priority tier plan stage variant size unit lang language locale visibility severity'.split(' '))
const CODE_LIKE = /^[a-z][a-z0-9_-]*$|^[A-Z][A-Z0-9_]*$/

/**
 * Sample values worth offering as an enum, or null. Plain strings only, with
 * a few short, code-like values (`shipped`, `INR`), or any few values under
 * a key that usually holds one (`status`, `currency`).
 */
export function enumCandidate(key: string, shape: Shape): string[] | null {
  const base = nonNull(shape)
  if (base.length !== 1 || base[0].kind !== 'string' || base[0].format) return null
  const values = base[0].examples ?? []
  // the inferrer keeps at most 8 examples, so 7 or more might not be all of them
  if (values.length === 0 || values.length > 6 || values.some((v) => !v || v.length > 32)) return null
  const last = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .at(-1)
  if (last && ENUM_KEYS.has(last)) return values
  return values.length >= 2 && values.every((v) => CODE_LIKE.test(v) && v.length <= 20) ? values : null
}

/* ---------- changing overrides (immutably) ---------- */

function prune(o: Overrides): Overrides {
  const types: Record<string, TypeOverride> = {}
  for (const [name, t] of Object.entries(o.types)) {
    const fields: Record<string, FieldOverride> = {}
    for (const [key, f] of Object.entries(t.fields ?? {})) {
      const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as FieldOverride
      if (Object.keys(clean).length) fields[key] = clean
    }
    const next: TypeOverride = {}
    if (t.rename) next.rename = t.rename
    if (Object.keys(fields).length) next.fields = fields
    if (Object.keys(next).length) types[name] = next
  }
  return { types }
}

/** Merge a patch into one field's override; `undefined` values remove that edit. */
export function editField(o: Overrides, typeName: string, key: string, patch: FieldOverride | null): Overrides {
  const type = o.types[typeName] ?? {}
  const fields = { ...type.fields, [key]: patch === null ? {} : { ...type.fields?.[key], ...patch } }
  return prune({ types: { ...o.types, [typeName]: { ...type, fields } } })
}

export function renameType(o: Overrides, typeName: string, name: string | undefined): Overrides {
  const type = o.types[typeName] ?? {}
  return prune({ types: { ...o.types, [typeName]: { ...type, rename: name && name !== typeName ? name : undefined } } })
}

/** How many separate edits there are, for "Reset 3 edits". */
export function countEdits(o: Overrides): number {
  let n = 0
  for (const t of Object.values(o.types)) {
    if (t.rename) n++
    for (const f of Object.values(t.fields ?? {})) n += Object.keys(f).length ? 1 : 0
  }
  return n
}

/** The inferred name behind a type name shown on screen (they differ once it's renamed). */
export function inferredName(o: Overrides, shownName: string): string {
  for (const [name, t] of Object.entries(o.types)) if (t.rename === shownName) return name
  return shownName
}

/**
 * Why `name` can't be the new name of `typeName`, or null if it can. Names
 * must be unique across the schema.
 */
export function renameProblem(schema: Schema, o: Overrides, typeName: string, name: string): string | null {
  const clean = pascalCase(name)
  if (!name.trim()) return 'Type a name.'
  const shown = o.types[typeName]?.rename ?? typeName
  const taken = schema.types.some((t) => t.name === clean && t.name !== shown) || clean === `${schema.rootName}List`
  return taken ? `${clean} is already the name of another type.` : null
}

/* ---------- applying overrides ---------- */

function retype(shape: Shape, f: FieldOverride): Shape {
  let options = nonNull(shape)
  let nullable = isNullable(shape)

  if (f.type && fieldType(shape) !== null) {
    const old = options[0]
    const examples = sampleValues(shape)
    const num = old?.kind === 'number' ? old : undefined
    switch (f.type) {
      case 'string':
        options = [{ kind: 'string', ...(old?.kind === 'string' && old.format ? { format: old.format } : {}), examples }]
        break
      case 'integer':
      case 'number':
        options = [{ kind: 'number', integer: f.type === 'integer', ...(num ? { min: num.min, max: num.max } : {}) }]
        break
      case 'enum': {
        const values = f.values?.length ? f.values : examples
        options = values.length ? [{ kind: 'enum', values }] : [{ kind: 'string', examples }]
        break
      }
      case 'boolean':
      case 'unknown':
        options = [{ kind: f.type }]
        break
    }
  }
  if (f.format !== undefined && options.length === 1 && options[0].kind === 'string') {
    const { format: _drop, ...rest } = options[0]
    options = [f.format ? { ...rest, format: f.format } : rest]
  }
  if (f.nullable !== undefined) nullable = f.nullable

  if (options.length === 0) return { kind: 'null' }
  const all = nullable ? [...options, { kind: 'null' } as Shape] : options
  return all.length === 1 ? all[0] : { kind: 'union', options: all }
}

function renameRefs(shape: Shape, names: Map<string, string>): Shape {
  switch (shape.kind) {
    case 'ref':
      return { kind: 'ref', name: names.get(shape.name) ?? shape.name }
    case 'array':
      return { kind: 'array', items: renameRefs(shape.items, names) }
    case 'union':
      return { kind: 'union', options: shape.options.map((o) => renameRefs(o, names)) }
    default:
      return shape
  }
}

/** The inferred schema with the user's edits applied. Edits for types or fields that no longer exist are ignored. */
export function applyOverrides(schema: Schema, o: Overrides): Schema {
  if (!Object.keys(o.types).length) return schema
  const rootRef = schema.root.kind === 'ref' ? schema.root.name : null
  const names = new Map<string, string>()
  const taken = new Set(schema.types.map((t) => t.name))
  for (const [name, t] of Object.entries(o.types)) {
    if (!t.rename || name === rootRef || !taken.has(name)) continue
    const next = pascalCase(t.rename)
    if (taken.has(next) || [...names.values()].includes(next)) continue // a clash: keep the inferred name
    names.set(name, next)
  }
  const types = schema.types.map((type) => {
    const edits = o.types[type.name]?.fields ?? {}
    const fields: Field[] = type.fields.map((field) => {
      const f = edits[field.key]
      const shape = renameRefs(f ? retype(field.shape, f) : field.shape, names)
      return { ...field, shape, optional: f?.optional ?? field.optional }
    })
    return { name: names.get(type.name) ?? type.name, fields }
  })
  return { ...schema, root: renameRefs(schema.root, names), types }
}

