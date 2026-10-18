import { pascalCase } from '../names'
import type { Field, ObjectType, Schema, Shape } from '../types'
import { usableCondition, usableFields, valueTree } from './model'
import type { ValueNode } from './model'
import type { Form, FormField } from './types'
import { formValuesName } from './zod'

function shapeOf(field: FormField): Shape {
  switch (field.widget) {
    case 'text':
      if (field.inputType === 'email') return { kind: 'string', format: 'email' }
      if (field.inputType === 'url') return { kind: 'string', format: 'uri' }
      return { kind: 'string' }
    case 'textarea':
      return { kind: 'string' }
    case 'number':
      return { kind: 'number', integer: Boolean(field.integer) }
    case 'select':
    case 'radio': {
      const values = [...new Set(field.options?.map((o) => o.value) ?? [])]
      return values.length ? { kind: 'enum', values } : { kind: 'string' }
    }
    case 'checkbox':
      return { kind: 'boolean' }
    case 'date':
      return { kind: 'string', format: field.withTime ? 'date-time' : 'date' }
    case 'file':
      // a FileList has no JSON shape; the form's Zod schema checks it
      return { kind: 'unknown' }
  }
}

/**
 * The values a form submits, as a shared schema: one type for the form and
 * one per nested object, so the other modules (types, mocks, contracts) can
 * use a form like any inferred response. A field is optional when it isn't
 * required or only shows sometimes.
 */
export function formToSchema(form: Form): Schema {
  const types: ObjectType[] = []
  const taken = new Set<string>()
  const rootName = formValuesName(form)
  taken.add(rootName)
  const conditional = new Set(usableFields(form).filter((f) => usableCondition(form, f)).map((f) => f.id))

  const typeName = (trail: string[]) => {
    // `Address`, or `BuyerAddress` when another object already took that name
    for (let n = 1; n <= trail.length; n++) {
      const name = pascalCase(trail.slice(-n).join(' '))
      if (!taken.has(name)) return name
    }
    let n = 2
    while (taken.has(`${pascalCase(trail.join(' '))}${n}`)) n++
    return `${pascalCase(trail.join(' '))}${n}`
  }

  // children first, so dependencies come before the types that use them
  const build = (nodes: ValueNode[], name: string, trail: string[]) => {
    taken.add(name)
    const fields: Field[] = nodes.map((n) => {
      if ('children' in n) {
        const child = typeName([...trail, n.key])
        build(n.children, child, [...trail, n.key])
        return { key: n.key, shape: { kind: 'ref', name: child }, optional: false }
      }
      return { key: n.key, shape: shapeOf(n.field), optional: !n.field.required || conditional.has(n.field.id) }
    })
    types.push({ name, fields })
  }

  build(valueTree(usableFields(form)), rootName, [])
  return { version: 2, rootName, root: { kind: 'ref', name: rootName }, types }
}
