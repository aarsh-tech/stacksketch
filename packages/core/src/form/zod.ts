import { schemaName } from '../generate/zod'
import { pascalCase } from '../names'
import { messagesOf, patternError, usableCondition, usableFields, valueTree } from './model'
import type { ValueNode } from './model'
import type { Condition, Form, FormField } from './types'

const str = (s: string) => JSON.stringify(s)

/** `a/b` → `/a\/b/`: escape slashes that aren't escaped already, so the literal ends where it should. */
export function regexLiteral(pattern: string): string {
  let out = ''
  let escaped = false
  for (const ch of pattern) {
    if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '/' && !escaped) out += '\\/'
    else out += ch
    escaped = ch === '\\' && !escaped
  }
  return `/${out}/`
}

/** The name of the inferred values type: `SignupForm` → `SignupFormValues`. */
export const formValuesName = (form: Form) => `${pascalCase(form.name)}Values`
export const formSchemaName = (form: Form) => schemaName(pascalCase(form.name))

/** `buyer.type` → `data.buyer?.type`: the checks run on half-filled forms, so nothing is assumed to exist. */
const access = (key: string) => `data.${key.split('.').join('?.')}`

/** True when the field has a value, as code. */
function filled(field: FormField, at: string): string {
  if (field.widget === 'checkbox') return `${at} === true`
  if (field.widget === 'file') return `(${at}?.length ?? 0) > 0`
  return `${at} !== undefined`
}

function empty(field: FormField, at: string): string {
  if (field.widget === 'checkbox') return `${at} !== true`
  if (field.widget === 'file') return `(${at}?.length ?? 0) === 0`
  return `${at} === undefined`
}

function literal(source: FormField, value: string): string {
  if (source.widget === 'number') return String(Number(value))
  return str(value)
}

/** The condition under which a field shows, as code. */
function shownWhen(c: Condition, source: FormField): string {
  const at = access(c.field)
  switch (c.op) {
    case 'filled':
      return filled(source, at)
    case 'empty':
      return empty(source, at)
    case 'equals':
    case 'not-equals': {
      const is = c.op === 'equals'
      // checkboxes compare against true only, so a required (always-true) checkbox still type-checks
      if (source.widget === 'checkbox') return (c.value === 'true') === is ? `${at} === true` : `${at} !== true`
      return `${at} ${is ? '===' : '!=='} ${literal(source, c.value ?? '')}`
    }
  }
}

/** The opposite of `shownWhen`, written plainly rather than as `!(…)`. */
function hiddenWhen(c: Condition, source: FormField): string {
  const flip: Record<Condition['op'], Condition['op']> = { equals: 'not-equals', 'not-equals': 'equals', filled: 'empty', empty: 'filled' }
  return shownWhen({ ...c, op: flip[c.op] }, source)
}

/** A required-or-invalid message: one for a missing value, another for a wrong one. */
const eitherError = (required: string, invalid: string) => `(issue) => (issue.input === undefined ? ${str(required)} : ${str(invalid)})`

/**
 * One field's Zod expression. `required` is false for fields that only show
 * sometimes; the form-level refine checks them when they're shown.
 */
function fieldZod(field: FormField, required: boolean): string {
  const m = messagesOf(field)
  const { min, max, pattern } = field.rules
  const chain: string[] = []
  let base: string

  switch (field.widget) {
    case 'text':
    case 'textarea': {
      const kind = field.widget === 'text' ? (field.inputType ?? 'text') : 'text'
      if (kind === 'email') base = required ? `z.email({ error: ${eitherError(m.required, m.format)} })` : `z.email(${str(m.format)})`
      else if (kind === 'url')
        base = required ? `z.url({ protocol: /^https?$/, error: ${eitherError(m.required, m.format)} })` : `z.url({ protocol: /^https?$/, error: ${str(m.format)} })`
      else {
        base = required ? `z.string({ error: ${str(m.required)} }).trim()` : 'z.string().trim()'
        if (required) chain.push(`.min(1, ${str(m.required)})`)
      }
      if (min !== undefined) chain.push(`.min(${min}, ${str(m.min)})`)
      if (max !== undefined) chain.push(`.max(${max}, ${str(m.max)})`)
      if (pattern && !patternError(pattern)) chain.push(`.regex(${regexLiteral(pattern)}, ${str(m.pattern)})`)
      break
    }
    case 'number':
      base = required ? `z.number({ error: ${str(m.required)} })` : 'z.number()'
      if (field.integer) chain.push(`.int(${str(m.format)})`)
      if (min !== undefined) chain.push(`.min(${min}, ${str(m.min)})`)
      if (max !== undefined) chain.push(`.max(${max}, ${str(m.max)})`)
      break
    case 'select':
    case 'radio': {
      const values = [...new Set(field.options?.map((o) => o.value) ?? [])]
      const list = `[${values.map(str).join(', ')}]`
      base = !values.length ? 'z.string()' : required ? `z.enum(${list}, { error: ${str(m.required)} })` : `z.enum(${list})`
      break
    }
    case 'checkbox':
      base = required ? `z.literal(true, { error: ${str(m.required)} })` : 'z.boolean()'
      break
    case 'date': {
      const fn = field.withTime ? 'z.iso.datetime' : 'z.iso.date'
      const local = field.withTime ? 'local: true, ' : ''
      base = required ? `${fn}({ ${local}error: ${eitherError(m.required, m.format)} })` : field.withTime ? `${fn}({ ${local}error: ${str(m.format)} })` : `${fn}(${str(m.format)})`
      break
    }
    case 'file':
      base = required ? `fileList(${str(m.required)})` : 'fileList()'
      if (required) chain.push(`.refine((files) => files.length > 0, ${str(m.required)})`)
      if (max !== undefined) chain.push(`.refine((files) => Array.from(files).every((file) => file.size <= ${max} * 1024 * 1024), ${str(m.max)})`)
      break
  }
  return base + chain.join('') + (required ? '' : '.optional()')
}

function objectZod(nodes: ValueNode[], depth: number, conditional: Set<string>): string {
  const pad = '  '.repeat(depth + 1)
  const lines = nodes.map((n) => {
    const value = 'children' in n ? objectZod(n.children, depth + 1, conditional) : fieldZod(n.field, n.field.required && !conditional.has(n.field.id))
    return `${pad}${n.key}: ${value},`
  })
  return `z.object({\n${lines.join('\n')}\n${'  '.repeat(depth)}})`
}

/**
 * A Zod 4 schema for the values the form submits, with each field's rules
 * and messages. A value the user didn't fill in is `undefined`, so the form
 * component turns empty inputs into `undefined` before validating. Fields
 * that only show sometimes are optional, and a refine requires them when
 * they're shown.
 */
export function toFormZod(form: Form): string {
  const fields = usableFields(form)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const conditions = fields.flatMap((f) => {
    const c = usableCondition(form, f)
    return c ? [{ field: f, condition: c, source: byKey.get(c.field)! }] : []
  })
  const conditional = new Set(conditions.map((c) => c.field.id))
  const name = formSchemaName(form)

  const blocks: string[] = [`import { z } from 'zod'`]
  if (fields.some((f) => f.widget === 'file'))
    blocks.push(
      `/** What a file input holds. Checked without \`instanceof FileList\` at the top level, so the schema also loads where FileList doesn't exist. */\nconst fileList = (message?: string) =>\n  z.custom<FileList>((value) => typeof FileList !== 'undefined' && value instanceof FileList, message)`,
    )
  const checks = conditions.filter((c) => c.field.required)
  if (checks.length)
    blocks.push(`/** Run the "required when shown" checks even while other fields still have errors. */\nconst isObject = ({ value }: { value: unknown }) => typeof value === 'object' && value !== null`)

  let body = objectZod(valueTree(fields), 0, conditional)
  for (const { field, condition, source } of checks) {
    const message = messagesOf(field).required
    const path = `[${field.key.split('.').map(str).join(', ')}]`
    body += `.refine((data) => ${hiddenWhen(condition, source)} || ${filled(field, access(field.key))}, {\n  path: ${path},\n  message: ${str(message)},\n  when: isObject,\n})`
  }
  blocks.push(`export const ${name} = ${body}\n\nexport type ${formValuesName(form)} = z.infer<typeof ${name}>`)
  return blocks.join('\n\n') + '\n'
}
