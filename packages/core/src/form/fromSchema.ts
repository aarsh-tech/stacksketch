import { isIdentifier, pascalCase } from '../names'
import type { ObjectType, Schema, Shape } from '../types'
import { humanize } from './model'
import type { ChoiceOption, Form, FormField, FormItem } from './types'

export interface SkippedField {
  /** where it would have gone, e.g. `items` or `buyer.id` */
  key: string
  reason: string
}

/** Keys a server fills in, which a form shouldn't ask for. */
const SERVER_KEYS = new Set(['id', '_id', 'createdAt', 'updatedAt', 'deletedAt', 'created_at', 'updated_at', 'deleted_at'])
/** the last word of keys that usually hold a paragraph */
const LONG_TEXT = new Set('note notes description bio about message comment comments summary body content instructions remarks'.split(' '))
const lastWord = (key: string) => humanize(key).split(' ').at(-1)?.toLowerCase() ?? ''
/** nested objects deeper than this are left out */
const MAX_DEPTH = 3

const nonNull = (shape: Shape): Shape[] => (shape.kind === 'union' ? shape.options : [shape]).filter((o) => o.kind !== 'null')
const isNullable = (shape: Shape) => shape.kind === 'null' || (shape.kind === 'union' && shape.options.some((o) => o.kind === 'null'))

function kindLabel(shape: Shape): string {
  switch (shape.kind) {
    case 'ref':
      return shape.name
    case 'array':
      return `${kindLabel(shape.items)}[]`
    case 'union':
      return shape.options.map(kindLabel).join(' | ')
    case 'number':
      return shape.integer ? 'integer' : 'number'
    default:
      return shape.kind
  }
}

/** `shipped` → "Shipped", `in_transit` → "In transit", but `INR` and `Mr.` stay as they are. */
const optionLabel = (value: string) => (/^[a-z][a-zA-Z0-9_-]*$/.test(value) ? humanize(value) : value)

const choices = (values: string[]): ChoiceOption[] => values.map((value) => ({ value, label: optionLabel(value) }))

/**
 * A form for one object type of a schema: one field per value, with its type
 * and required-ness carried over, and a section for each nested object.
 * Lists, mixed types and server-set keys are left out, and listed in `skipped`
 * with the reason.
 */
export function formFromSchema(schema: Schema, typeName: string, newId: () => string): { form: Form; skipped: SkippedField[] } {
  const types = new Map(schema.types.map((t) => [t.name, t]))
  const skipped: SkippedField[] = []
  const items: FormItem[] = []

  const walk = (type: ObjectType, prefix: string, trail: string[], seen: Set<string>) => {
    const nested: { type: ObjectType; path: string; title: string }[] = []
    const fields: FormField[] = []
    for (const f of type.fields) {
      const path = prefix ? `${prefix}.${f.key}` : f.key
      const skip = (reason: string) => skipped.push({ key: path, reason })
      if (!isIdentifier(f.key)) {
        skip(`its key isn't a plain name in code; add it by hand with a key like ${prefix ? `${prefix}.` : ''}${pascalCase(f.key).replace(/^./, (c) => c.toLowerCase())}`)
        continue
      }
      if (SERVER_KEYS.has(f.key)) {
        skip('the server usually sets it')
        continue
      }
      const base = nonNull(f.shape)
      const required = !f.optional && !isNullable(f.shape)
      if (base.length === 0) {
        skip('it was always null in the samples, so there’s no type to go on')
        continue
      }
      if (base.length > 1) {
        skip(`it can be more than one type (${kindLabel(f.shape)})`)
        continue
      }
      const b = base[0]
      const field = (widget: FormField['widget'], extra: Partial<FormField> = {}): FormField => ({
        kind: 'field',
        id: newId(),
        widget,
        key: path,
        label: humanize(f.key),
        required,
        rules: {},
        messages: {},
        ...extra,
      })
      switch (b.kind) {
        case 'string': {
          if (b.format === 'email') fields.push(field('text', { inputType: 'email' }))
          else if (b.format === 'uri') fields.push(field('text', { inputType: 'url' }))
          else if (b.format === 'date') fields.push(field('date'))
          else if (b.format === 'date-time') fields.push(field('date', { withTime: true }))
          else {
            const examples = b.examples ?? []
            const long = LONG_TEXT.has(lastWord(f.key)) || examples.some((e) => e.length > 80)
            fields.push(field(long ? 'textarea' : 'text'))
          }
          break
        }
        case 'number':
          fields.push(field('number', b.integer ? { integer: true } : {}))
          break
        case 'boolean':
          // "required" for a checkbox means it must be ticked, which a true/false value doesn't imply
          fields.push(field('checkbox', { required: false }))
          break
        case 'enum':
          fields.push(field(b.values.length <= 4 ? 'radio' : 'select', { options: choices(b.values) }))
          break
        case 'ref': {
          const child = types.get(b.name)
          if (!child) skip(`its type ${b.name} isn't in the schema`)
          else if (seen.has(b.name)) skip(`${b.name} contains itself, so the form would never end`)
          else if (trail.length >= MAX_DEPTH) skip('it’s nested too deeply; make a separate form for it')
          else nested.push({ type: child, path, title: humanize(f.key) })
          break
        }
        case 'array':
          skip(`it’s a list (${kindLabel(b)}), and repeating groups aren't supported yet`)
          break
        case 'unknown':
          skip('the samples had nothing to infer its type from')
          break
      }
    }
    items.push(...fields)
    for (const n of nested) {
      const title = [...trail, n.title].join(' › ')
      items.push({ kind: 'section', id: newId(), title })
      walk(n.type, n.path, [...trail, n.title], new Set([...seen, n.type.name]))
    }
  }

  const root = types.get(typeName)
  if (root) walk(root, '', [], new Set([typeName]))

  const name = /Form$/.test(typeName) ? typeName : `${typeName}Form`
  const form: Form = { version: 1, id: newId(), name, title: humanize(typeName), submitLabel: 'Save', items, source: typeName }
  return { form, skipped }
}
