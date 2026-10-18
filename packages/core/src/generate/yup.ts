import { rootTypeName } from '../infer'
import { propertyKey } from '../names'
import type { Schema, Shape } from '../types'
import { schemaName } from './zod'

function stringYup(shape: Extract<Shape, { kind: 'string' }>): string {
  switch (shape.format) {
    case 'email':
      return 'yup.string().email()'
    case 'uuid':
      return 'yup.string().uuid()'
    case 'uri':
      return 'yup.string().url()'
    case 'date-time':
      return 'yup.string().datetime({ allowOffset: true })'
    case 'date':
      return `yup.string().matches(/^\\d{4}-\\d{2}-\\d{2}$/, 'Expected a date like 2026-01-31')`
    default:
      return 'yup.string()'
  }
}

/** A Yup schema that accepts `null` only if the shape does. Presence (`defined`) is added by the caller. */
function base(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
      return stringYup(shape)
    case 'number':
      return shape.integer ? 'yup.number().integer()' : 'yup.number()'
    case 'boolean':
      return 'yup.boolean()'
    case 'enum':
      return `yup.string().oneOf([${shape.values.map((s) => JSON.stringify(s)).join(', ')}])`
    case 'null':
      return 'yup.mixed().nullable().oneOf([null])'
    case 'unknown':
      return 'yup.mixed()'
    case 'ref':
      return schemaName(shape.name)
    case 'array':
      return `yup.array().of(${item(shape.items)})`
    case 'union': {
      const nonNull = shape.options.filter((o) => o.kind !== 'null')
      // Yup has no unions: a value that can be several kinds is only checked for presence
      const one = nonNull.length === 1 ? base(nonNull[0]) : 'yup.mixed()'
      if (nonNull.length === shape.options.length) return one
      // `oneOf` rejects null unless it's listed, even on a nullable schema
      if (nonNull.length === 1 && nonNull[0].kind === 'enum') return one.replace(/\]\)$/, ', null])') + '.nullable()'
      return `${one}.nullable()`
    }
  }
}

/** An array item: never missing, and null only when the shape says so. */
function item(shape: Shape): string {
  return `${base(shape)}.defined()`
}

/**
 * Yup 1.x schemas plus their inferred types, dependencies first. Validate
 * with `{ strict: true }` so Yup checks values instead of converting them.
 */
export function toYup(schema: Schema): string {
  const blocks: string[] = [`import * as yup from 'yup'`, `// Validate with { strict: true } so Yup checks values instead of converting them, e.g. schema.validateSync(data, { strict: true })`]
  for (const type of schema.types) {
    const lines = type.fields.map((f) => {
      const b = base(f.shape)
      // objects default to {} in Yup, so a missing optional object has to default to undefined
      const expr = f.optional ? (f.shape.kind === 'ref' ? `${b}.default(undefined)` : `${b}.optional()`) : `${b}.defined()`
      return `  ${propertyKey(f.key)}: ${expr},`
    })
    blocks.push(`export const ${schemaName(type.name)} = yup.object({\n${lines.join('\n')}\n})\nexport type ${type.name} = yup.InferType<typeof ${schemaName(type.name)}>`.replace('yup.object({\n\n})', 'yup.object({})'))
  }
  if (schema.root.kind !== 'ref') {
    const name = rootTypeName(schema)
    blocks.push(`export const ${schemaName(name)} = ${item(schema.root)}\nexport type ${name} = yup.InferType<typeof ${schemaName(name)}>`)
  }
  return blocks.join('\n\n') + '\n'
}
