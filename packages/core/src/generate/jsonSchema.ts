import { rootTypeName } from '../infer'
import type { ObjectType, Schema, Shape } from '../types'

export type Json = { [key: string]: unknown }

/** One shape as JSON Schema. Refs point at `${refPrefix}Name`: `#/$defs/` here, `#/components/schemas/` in OpenAPI. */
export function jsonSchemaNode(shape: Shape, refPrefix = '#/$defs/'): Json {
  const node = (s: Shape) => jsonSchemaNode(s, refPrefix)
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
      return { $ref: `${refPrefix}${shape.name}` }
    case 'array':
      return { type: 'array', items: node(shape.items) }
    case 'union':
      return { anyOf: shape.options.map(node) }
  }
}

/** An object type as JSON Schema. */
export function objectJsonSchema(type: ObjectType, refPrefix = '#/$defs/'): Json {
  const required = type.fields.filter((f) => !f.optional).map((f) => f.key)
  return {
    type: 'object',
    properties: Object.fromEntries(type.fields.map((f) => [f.key, jsonSchemaNode(f.shape, refPrefix)])),
    ...(required.length ? { required } : {}),
  }
}

/**
 * JSON Schema (draft 2020-12). This is also the body format OpenAPI 3.1 uses,
 * which is where the contract designer will pick it up.
 */
export function toJsonSchema(schema: Schema): Json {
  const $defs: Record<string, Json> = {}
  for (const type of schema.types) $defs[type.name] = objectJsonSchema(type)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: rootTypeName(schema),
    ...jsonSchemaNode(schema.root),
    ...(schema.types.length ? { $defs } : {}),
  }
}
