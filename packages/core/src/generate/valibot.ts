import { rootTypeName } from '../infer'
import { propertyKey } from '../names'
import type { Schema, Shape } from '../types'
import { schemaName } from './zod'

function stringValibot(shape: Extract<Shape, { kind: 'string' }>): string {
  switch (shape.format) {
    case 'email':
      return 'v.pipe(v.string(), v.email())'
    case 'uuid':
      return 'v.pipe(v.string(), v.uuid())'
    case 'uri':
      return 'v.pipe(v.string(), v.url())'
    case 'date-time':
      return 'v.pipe(v.string(), v.isoTimestamp())'
    case 'date':
      return 'v.pipe(v.string(), v.isoDate())'
    default:
      return 'v.string()'
  }
}

export function valibotExpr(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
      return stringValibot(shape)
    case 'number':
      return shape.integer ? 'v.pipe(v.number(), v.integer())' : 'v.number()'
    case 'boolean':
      return 'v.boolean()'
    case 'enum':
      return `v.picklist([${shape.values.map((s) => JSON.stringify(s)).join(', ')}])`
    case 'null':
      return 'v.null()'
    case 'unknown':
      return 'v.unknown()'
    case 'ref':
      return schemaName(shape.name)
    case 'array':
      return `v.array(${valibotExpr(shape.items)})`
    case 'union': {
      const nonNull = shape.options.filter((o) => o.kind !== 'null')
      const base = nonNull.length === 1 ? valibotExpr(nonNull[0]) : `v.union([${nonNull.map(valibotExpr).join(', ')}])`
      return nonNull.length < shape.options.length ? `v.nullable(${base})` : base
    }
  }
}

/** Valibot 1.x schemas plus their output types, dependencies first. */
export function toValibot(schema: Schema): string {
  const blocks: string[] = [`import * as v from 'valibot'`]
  for (const type of schema.types) {
    const lines = type.fields.map((f) => {
      const expr = valibotExpr(f.shape)
      return `  ${propertyKey(f.key)}: ${f.optional ? `v.optional(${expr})` : expr},`
    })
    const body = lines.length ? `v.object({\n${lines.join('\n')}\n})` : 'v.object({})'
    blocks.push(`export const ${schemaName(type.name)} = ${body}\nexport type ${type.name} = v.InferOutput<typeof ${schemaName(type.name)}>`)
  }
  if (schema.root.kind !== 'ref') {
    const name = rootTypeName(schema)
    blocks.push(`export const ${schemaName(name)} = ${valibotExpr(schema.root)}\nexport type ${name} = v.InferOutput<typeof ${schemaName(name)}>`)
  }
  return blocks.join('\n\n') + '\n'
}
