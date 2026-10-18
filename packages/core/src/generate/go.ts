import { rootTypeName } from '../infer'
import { pascalCase } from '../names'
import type { Schema, Shape } from '../types'

const INITIALISMS = new Set('id url uri uuid api http https json xml html sql ip sku gst gstin cpu css dns eta sms ttl utc'.split(' '))

/** "imageUrl" / "user_id" → "ImageURL" / "UserID", the way Go spells exported names. */
export function goName(key: string): string {
  const words = pascalCase(key).match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[0-9]+/g) ?? ['Field']
  return words.map((w) => (INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w)).join('')
}

interface Ctx {
  time: boolean
  /** named string types for enums, in the order they're met */
  enums: { name: string; values: string[] }[]
}

function enumConst(typeName: string, value: string): string {
  const v = goName(value)
  return `${typeName}${/^[A-Z]/.test(v) ? v : `V${v}`}`
}

function goType(shape: Shape, ctx: Ctx, hint: string): string {
  switch (shape.kind) {
    case 'string':
      if (shape.format === 'date-time') {
        ctx.time = true
        return 'time.Time'
      }
      return 'string'
    case 'number':
      return shape.integer ? 'int64' : 'float64'
    case 'boolean':
      return 'bool'
    case 'enum': {
      const existing = ctx.enums.find((e) => e.values.join('\0') === shape.values.join('\0') && e.name.startsWith(hint))
      if (existing) return existing.name
      let name = hint
      for (let n = 2; ctx.enums.some((e) => e.name === name); n++) name = `${hint}${n}`
      ctx.enums.push({ name, values: shape.values })
      return name
    }
    case 'null':
    case 'unknown':
      return 'any'
    case 'ref':
      return shape.name
    case 'array':
      return `[]${goType(shape.items, ctx, hint)}`
    case 'union': {
      const nonNull = shape.options.filter((o) => o.kind !== 'null')
      if (nonNull.length !== 1) return 'any' // Go has no unions
      const inner = goType(nonNull[0], ctx, hint)
      // slices, maps and any are already nil-able
      return inner.startsWith('[]') || inner === 'any' ? inner : `*${inner}`
    }
  }
}

/** Lines aligned into columns the way gofmt does it. */
function align(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (i < r.length - 1 ? r[i].length : 0)))) ?? []
  return rows.map((r) => r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]) : cell)).join(' '))
}

/**
 * Go structs with `json` tags, dependencies first. Nullable values become
 * pointers, optional ones get `omitempty`, and enums become named string
 * types with constants.
 */
export function toGo(schema: Schema, packageName = 'api'): string {
  const ctx: Ctx = { time: false, enums: [] }
  const blocks: string[] = []
  for (const type of schema.types) {
    const taken = new Set<string>()
    const rows = type.fields.map((f) => {
      let name = goName(f.key)
      for (let n = 2; taken.has(name); n++) name = `${goName(f.key)}${n}`
      taken.add(name)
      let t = goType(f.shape, ctx, `${type.name}${goName(f.key)}`)
      // a missing struct would otherwise decode as its zero value
      if (f.optional && !t.startsWith('*') && !t.startsWith('[]') && t !== 'any') t = `*${t}`
      const tag = '`json:"' + f.key.replace(/[`"]/g, '') + (f.optional ? ',omitempty' : '') + '"`'
      return [name, t, tag]
    })
    blocks.push(rows.length ? `type ${type.name} struct {\n${align(rows).map((l) => `\t${l}`).join('\n')}\n}` : `type ${type.name} struct{}`)
  }
  if (schema.root.kind !== 'ref') {
    const name = rootTypeName(schema)
    blocks.push(`type ${name} ${goType(schema.root, ctx, name).replace(/^\*/, '')}`)
  }
  const enums = ctx.enums.map((e) => {
    const rows = e.values.map((v) => [enumConst(e.name, v), e.name, '= ' + JSON.stringify(v)])
    return `type ${e.name} string\n\nconst (\n${align(rows).map((l) => `\t${l}`).join('\n')}\n)`
  })
  const header = `package ${packageName}${ctx.time ? '\n\nimport "time"' : ''}`
  return [header, ...enums, ...blocks].join('\n\n') + '\n'
}
