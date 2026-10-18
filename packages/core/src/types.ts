/**
 * The shared schema format. Every Stacksketch module reads and writes this:
 * the API explorer infers it from JSON, the form builder (phase 2) turns it
 * into fields, the contract designer (phase 3) attaches it to endpoints.
 *
 * Objects are never inlined: each one is a named entry in `types`, and shapes
 * point at it with a `ref`. That keeps code generation simple and gives the
 * canvas one node per type.
 */

export type StringFormat = 'date-time' | 'date' | 'email' | 'uuid' | 'uri'

export type Shape =
  | { kind: 'string'; format?: StringFormat; examples?: string[] }
  | { kind: 'number'; integer: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  /** a string that can only be one of `values` (never empty); added in schema v2 */
  | { kind: 'enum'; values: string[] }
  | { kind: 'null' }
  /** nothing to go on, e.g. the items of an empty array */
  | { kind: 'unknown' }
  | { kind: 'array'; items: Shape }
  | { kind: 'ref'; name: string }
  /** at most one member per kind, never nested, `null` last */
  | { kind: 'union'; options: Shape[] }

export interface Field {
  key: string
  shape: Shape
  /** missing from at least one sample */
  optional: boolean
}

export interface ObjectType {
  name: string
  fields: Field[]
}

export interface Schema {
  /** 2 added the `enum` shape; a v1 schema is a valid v2 schema (see `upgradeSchema`) */
  version: 2
  /** the name the user gave the whole response */
  rootName: string
  root: Shape
  /** dependencies come before the types that use them */
  types: ObjectType[]
}
