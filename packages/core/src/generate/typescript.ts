import { rootTypeName, typesTopDown } from '../infer'
import { propertyKey } from '../names'
import type { Schema, Shape } from '../types'

export interface TypeScriptOptions {
  /** `interface User {}` or `type User = {}` */
  style?: 'interface' | 'type'
  /** mark every property `readonly` */
  readonly?: boolean
  /** note detected string formats in a comment, e.g. `// email` */
  formatComments?: boolean
}

export function tsType(shape: Shape): string {
  switch (shape.kind) {
    case 'string':
    case 'boolean':
    case 'null':
    case 'unknown':
      return shape.kind
    case 'number':
      return 'number'
    case 'ref':
      return shape.name
    case 'array': {
      const inner = tsType(shape.items)
      return shape.items.kind === 'union' ? `(${inner})[]` : `${inner}[]`
    }
    case 'union':
      return shape.options.map(tsType).join(' | ')
  }
}

function formatOf(shape: Shape): string | undefined {
  if (shape.kind === 'string') return shape.format
  if (shape.kind === 'union') return shape.options.map(formatOf).find(Boolean)
  if (shape.kind === 'array') return formatOf(shape.items)
  return undefined
}

/** TypeScript declarations for every type in the schema, root first. */
export function toTypeScript(schema: Schema, options: TypeScriptOptions = {}): string {
  const { style = 'interface', readonly = false, formatComments = true } = options
  const blocks: string[] = []
  const root = schema.root
  if (root.kind !== 'ref') blocks.push(`export type ${rootTypeName(schema)} = ${tsType(root)}`)

  for (const type of typesTopDown(schema)) {
    const lines = type.fields.map((f) => {
      const comment = formatComments ? formatOf(f.shape) : undefined
      const prop = `${readonly ? 'readonly ' : ''}${propertyKey(f.key)}${f.optional ? '?' : ''}: ${tsType(f.shape)}`
      return `  ${prop}${comment ? ` // ${comment}` : ''}`
    })
    const body = lines.length ? `{\n${lines.join('\n')}\n}` : '{}'
    blocks.push(style === 'interface' ? `export interface ${type.name} ${body}` : `export type ${type.name} = ${body}`)
  }
  return blocks.join('\n\n') + '\n'
}
