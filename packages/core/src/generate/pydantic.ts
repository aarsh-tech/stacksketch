import { rootTypeName } from '../infer'
import type { Schema, Shape } from '../types'

const KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type model_config dt'.split(' '),
)

/** "createdAt" / "created-at" → "created_at"; never a keyword, never starts with a digit. */
export function snakeCase(key: string): string {
  const s = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
  const safe = !s ? 'field' : /^\d/.test(s) ? `field_${s}` : s
  return KEYWORDS.has(safe) ? `${safe}_` : safe
}

interface Used {
  datetime: boolean
  date: boolean
  uuid: boolean
  any: boolean
  literal: boolean
  field: boolean
}

function pyType(shape: Shape, used: Used): string {
  switch (shape.kind) {
    case 'string':
      // `dt.date`, not `date`: a field called `date` would shadow the class
      if (shape.format === 'date-time') return (used.datetime = true), 'dt.datetime'
      if (shape.format === 'date') return (used.date = true), 'dt.date'
      if (shape.format === 'uuid') return (used.uuid = true), 'UUID'
      return 'str'
    case 'number':
      return shape.integer ? 'int' : 'float'
    case 'boolean':
      return 'bool'
    case 'enum':
      used.literal = true
      return `Literal[${shape.values.map((v) => JSON.stringify(v)).join(', ')}]`
    case 'null':
      return 'None'
    case 'unknown':
      used.any = true
      return 'Any'
    case 'ref':
      return shape.name
    case 'array':
      return `list[${pyType(shape.items, used)}]`
    case 'union':
      return shape.options.map((o) => pyType(o, used)).join(' | ')
  }
}

const formatNote = (shape: Shape): string | undefined => {
  const s = shape.kind === 'union' ? shape.options.find((o) => o.kind === 'string') : shape
  return s?.kind === 'string' && (s.format === 'email' || s.format === 'uri') ? s.format : undefined
}

/**
 * Pydantic v2 models, dependencies first. Keys that aren't snake_case keep
 * their JSON name as an alias, and `populate_by_name` lets you use either.
 */
export function toPydantic(schema: Schema): string {
  const used: Used = { datetime: false, date: false, uuid: false, any: false, literal: false, field: false }
  const blocks: string[] = []
  for (const type of schema.types) {
    const taken = new Set<string>()
    const lines = type.fields.map((f) => {
      let name = snakeCase(f.key)
      for (let n = 2; taken.has(name); n++) name = `${snakeCase(f.key)}_${n}`
      taken.add(name)
      let annotation = pyType(f.shape, used)
      if (f.optional && !annotation.split(' | ').includes('None')) annotation += ' | None'
      const alias = name !== f.key ? `alias=${JSON.stringify(f.key)}` : ''
      if (alias) used.field = true
      const value = alias ? (f.optional ? ` = Field(default=None, ${alias})` : ` = Field(${alias})`) : f.optional ? ' = None' : ''
      const note = formatNote(f.shape)
      return `    ${name}: ${annotation}${value}${note ? `  # ${note}` : ''}`
    })
    const needsConfig = lines.some((l) => l.includes('alias='))
    const body = [...(needsConfig ? ['    model_config = ConfigDict(populate_by_name=True)', ''] : []), ...(lines.length ? lines : ['    pass'])]
    blocks.push(`class ${type.name}(BaseModel):\n${body.join('\n')}`)
  }
  let rootModel = false
  if (schema.root.kind !== 'ref') {
    rootModel = true
    blocks.push(`class ${rootTypeName(schema)}(RootModel[${pyType(schema.root, used)}]):\n    pass`)
  }

  const pydantic = ['BaseModel', ...(blocks.some((b) => b.includes('ConfigDict(')) ? ['ConfigDict'] : []), ...(used.field ? ['Field'] : []), ...(rootModel ? ['RootModel'] : [])]
  const typing = [...(used.any ? ['Any'] : []), ...(used.literal ? ['Literal'] : [])]
  const imports = [
    ...(used.datetime || used.date ? ['import datetime as dt'] : []),
    ...(typing.length ? [`from typing import ${typing.join(', ')}`] : []),
    ...(used.uuid ? ['from uuid import UUID'] : []),
    '',
    `from pydantic import ${pydantic.join(', ')}`,
  ]
  return `${imports.join('\n').replace(/^\n/, '')}\n\n\n${blocks.join('\n\n\n')}\n`
}
