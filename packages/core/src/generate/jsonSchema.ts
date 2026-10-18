import { rootTypeName } from '../infer'
import type { Schema, Shape } from '../types'

type Json = { [key: string]: unknown }

function node(shape: Shape): Json {
  switch (shape.kind) {
    case 'string':
      return shape.format ? { type: 'string', format: shape.format } : { type: 'string' }
    case 'number':
      return { type: shape.integer ? 'integer' : 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'enum':
      return { type: 'string', enum: shape.values }
    case 'null':
      return { type: 'null' }
    case 'unknown':
      return {}
    case 'ref':
      return { $ref: `#/$defs/${shape.name}` }
    case 'array':
      return { type: 'array', items: node(shape.items) }
    case 'union':
      return { anyOf: shape.options.map(node) }
  }
}

/**
 * JSON Schema (draft 2020-12). This is also the body format OpenAPI 3.1 uses,
 * which is where the contract designer will pick it up.
 */
export function toJsonSchema(schema: Schema): Json {
  const $defs: Record<string, Json> = {}
  for (const type of schema.types) {
    const required = type.fields.filter((f) => !f.optional).map((f) => f.key)
    $defs[type.name] = {
      type: 'object',
      properties: Object.fromEntries(type.fields.map((f) => [f.key, node(f.shape)])),
      ...(required.length ? { required } : {}),
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: rootTypeName(schema),
    ...node(schema.root),
    ...(schema.types.length ? { $defs } : {}),
  }
}
