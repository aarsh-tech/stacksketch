import { rootTypeName } from '../infer'
import { camelCase, propertyKey } from '../names'
import type { Schema, Shape } from '../types'

/** `User` → `userSchema` */
export function schemaName(typeName: string): string {
  return `${camelCase(typeName)}Schema`
}

function stringZod(shape: Extract<Shape, { kind: 'string' }>): string {
  switch (shape.format) {
    case 'email':
      return 'z.email()'
    case 'uuid':
      return 'z.uuid()'
    case 'uri':
      return 'z.url()'
    case 'date-time':
      return 'z.iso.datetime({ offset: true, local: true })'
    case 'date':
      return 'z.iso.date()'
    default:
      return 'z.string()'
  }
}

export function zodExpr(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
      return stringZod(shape)
    case 'number':
      return shape.integer ? 'z.number().int()' : 'z.number()'
    case 'boolean':
      return 'z.boolean()'
    case 'null':
      return 'z.null()'
    case 'unknown':
      return 'z.unknown()'
    case 'ref':
      return schemaName(shape.name)
    case 'array':
      return `z.array(${zodExpr(shape.items)})`
    case 'union': {
      const nonNull = shape.options.filter((o) => o.kind !== 'null')
      const nullable = nonNull.length < shape.options.length
      const base = nonNull.length === 1 ? zodExpr(nonNull[0]) : `z.union([${nonNull.map(zodExpr).join(', ')}])`
      return nullable ? `${base}.nullable()` : base
    }
  }
}

/** Zod 4 schemas plus inferred types. Schemas are declared before the ones that use them. */
export function toZod(schema: Schema): string {
  const blocks: string[] = [`import { z } from 'zod'`]
  for (const type of schema.types) {
    const lines = type.fields.map((f) => `  ${propertyKey(f.key)}: ${zodExpr(f.shape)}${f.optional ? '.optional()' : ''},`)
    const body = lines.length ? `z.object({\n${lines.join('\n')}\n})` : 'z.object({})'
    blocks.push(`export const ${schemaName(type.name)} = ${body}\nexport type ${type.name} = z.infer<typeof ${schemaName(type.name)}>`)
  }
  if (schema.root.kind !== 'ref') {
    const name = rootTypeName(schema)
    blocks.push(`export const ${schemaName(name)} = ${zodExpr(schema.root)}\nexport type ${name} = z.infer<typeof ${schemaName(name)}>`)
  }
  return blocks.join('\n\n') + '\n'
}
