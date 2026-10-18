import { refsOf, rootTypeName, typesInDependencyOrder } from '../infer'
import { camelCase, propertyKey } from '../names'
import type { ObjectType, Schema, Shape } from '../types'

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
    case 'enum':
      return `z.enum([${shape.values.map((v) => JSON.stringify(v)).join(', ')}])`
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
  const blocks: string[] = [`import { z } from 'zod'`, ...zodDeclarations(schema.types)]
  if (schema.root.kind !== 'ref') {
    const name = rootTypeName(schema)
    blocks.push(`export const ${schemaName(name)} = ${zodExpr(schema.root)}\nexport type ${name} = z.infer<typeof ${schemaName(name)}>`)
  }
  return blocks.join('\n\n') + '\n'
}

/**
 * An exported schema and type per object type, each declared before the ones
 * that use it. Fields inside a cycle (a category holding its subcategories)
 * become getters, which is how Zod 4 does recursive objects.
 */
export function zodDeclarations(types: ObjectType[]): string[] {
  const byName = new Map(types.map((t) => [t.name, t]))
  /** can `from` reach `to` through its fields? */
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true
    if (seen.has(from)) return false
    seen.add(from)
    return (byName.get(from)?.fields ?? []).some((f) => refsOf(f.shape).some((r) => reaches(r, to, seen)))
  }
  return typesInDependencyOrder(types).map((type) => {
    const lines = type.fields.map((f) => {
      const expr = `${zodExpr(f.shape)}${f.optional ? '.optional()' : ''}`
      const cyclic = refsOf(f.shape).some((r) => byName.has(r) && reaches(r, type.name))
      return cyclic ? `  get ${propertyKey(f.key)}() {\n    return ${expr}\n  },` : `  ${propertyKey(f.key)}: ${expr},`
    })
    const body = lines.length ? `z.object({\n${lines.join('\n')}\n})` : 'z.object({})'
    return `export const ${schemaName(type.name)} = ${body}\nexport type ${type.name} = z.infer<typeof ${schemaName(type.name)}>`
  })
}
