import { camelCase } from '../names'
import type { ChoiceOption, FieldMessages, Form, FormField, FormItem, SectionBreak, StepBreak, Widget } from './types'

/* ---------- names ---------- */

const ACRONYMS = new Set('id url uri api gst gstin pan sku ip html json uuid otp ifsc upi vat iban'.split(' '))

/** `contactName` / `contact_name` → "Contact name"; `imageUrl` → "Image URL"; `line1` → "Line 1". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()))
  if (!words.length) return 'Field'
  const first = words[0]
  words[0] = first[0].toUpperCase() + first.slice(1)
  return words.join(' ')
}

const KEY_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/

/** A key is one or more identifiers joined by dots: `email`, `shippingAddress.city`. */
export const isValidKey = (key: string) => KEY_PATH.test(key)

export function keyFromLabel(label: string): string {
  const key = camelCase(label)
  return key === 'item' && !/item/i.test(label) ? 'field' : key
}

/** `base`, or `base2`, `base3`… whichever isn't taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(base)) return base
  let n = 2
  while (set.has(`${base}${n}`)) n++
  return `${base}${n}`
}

/* ---------- making fields ---------- */

const DEFAULT_LABEL: Record<Widget, string> = {
  text: 'Short answer',
  textarea: 'Long answer',
  number: 'Number',
  select: 'Dropdown',
  radio: 'Choice',
  checkbox: 'Checkbox',
  date: 'Date',
  file: 'File',
}

export const defaultOptions = (): ChoiceOption[] => [1, 2, 3].map((n) => ({ value: `option-${n}`, label: `Option ${n}` }))

/** A new field of this kind with a label and a key no other field uses. */
export function createField(widget: Widget, id: string, form: Form): FormField {
  const label = DEFAULT_LABEL[widget]
  const field: FormField = {
    kind: 'field',
    id,
    widget,
    key: uniqueKey(keyFromLabel(label), fieldsOf(form).map((f) => f.key)),
    label,
    required: false,
    rules: {},
    messages: {},
  }
  return withWidget(field, widget)
}

/** The field as another kind of input, keeping what still applies (label, key, options…). */
export function withWidget(field: FormField, widget: Widget): FormField {
  const next: FormField = { ...field, widget, rules: { ...field.rules } }
  if (widget !== 'text') delete next.inputType
  if (widget !== 'number') delete next.integer
  if (widget !== 'date') delete next.withTime
  if (widget !== 'file') {
    delete next.accept
    delete next.multiple
  }
  if (widget === 'select' || widget === 'radio') next.options = field.options?.length ? field.options : defaultOptions()
  else delete next.options
  // characters, values and megabytes aren't interchangeable
  if (ruleUnit(widget) !== ruleUnit(field.widget)) {
    delete next.rules.min
    delete next.rules.max
  }
  if (ruleUnit(widget) === 'none' || ruleUnit(widget) === 'megabytes') delete next.rules.min
  if (ruleUnit(widget) !== 'characters') delete next.rules.pattern
  return next
}

/** What a field's min and max count. Files only have a max. */
export function ruleUnit(widget: Widget): 'characters' | 'value' | 'megabytes' | 'none' {
  if (widget === 'text' || widget === 'textarea') return 'characters'
  if (widget === 'number') return 'value'
  if (widget === 'file') return 'megabytes'
  return 'none'
}

export function emptyForm(id: string, name = 'NewForm'): Form {
  return { version: 1, id, name, title: humanize(name), submitLabel: 'Submit', items: [] }
}

/* ---------- reading a form ---------- */

export const fieldsOf = (form: Form): FormField[] => form.items.filter((i): i is FormField => i.kind === 'field')

export interface LayoutSection {
  /** the section marker's id; null for fields before any section in a step */
  id: string | null
  title: string
  description?: string
  fields: FormField[]
}

export interface LayoutStep {
  /** the step marker's id; null for fields before the first step */
  id: string | null
  title: string
  sections: LayoutSection[]
}

/**
 * The flat item list as steps of sections. A form without step markers is one
 * step. Fields above the first marker form an untitled step or section, and
 * empty untitled groups are dropped.
 */
export function layoutOf(form: Form): LayoutStep[] {
  const steps: LayoutStep[] = []
  let step: LayoutStep = { id: null, title: '', sections: [] }
  let section: LayoutSection = { id: null, title: '', fields: [] }
  const closeSection = () => {
    if (section.id !== null || section.fields.length) step.sections.push(section)
  }
  const closeStep = () => {
    closeSection()
    if (step.id !== null || step.sections.length) steps.push(step)
  }
  for (const item of form.items) {
    if (item.kind === 'step') {
      closeStep()
      step = { id: item.id, title: item.title, sections: [] }
      section = { id: null, title: '', fields: [] }
    } else if (item.kind === 'section') {
      closeSection()
      section = { id: item.id, title: item.title, description: item.description, fields: [] }
    } else section.fields.push(item)
  }
  closeStep()
  return steps.length ? steps : [{ id: null, title: '', sections: [] }]
}

/**
 * The layout the exported component and the preview show: only fields code
 * can be generated for, and no step left with nothing in it.
 */
export function usableLayout(form: Form): LayoutStep[] {
  const usable = new Set(usableFields(form).map((f) => f.id))
  return layoutOf(form)
    .map((step) => ({ ...step, sections: step.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => usable.has(f.id)) })) }))
    .filter((step) => step.sections.some((s) => s.fields.length || s.title))
}

/** The step a field is on, counting from 0. */
export function stepIndexOf(form: Form, itemId: string): number {
  let n = 0
  let seenField = false
  for (const item of form.items) {
    if (item.kind === 'step' && seenField) n++
    if (item.kind === 'step') seenField = true // a leading marker doesn't start a second step
    if (item.kind === 'field') seenField = true
    if (item.id === itemId) return n
  }
  return n
}

/* ---------- messages ---------- */

/** "Company name" → "company name", but "GST number" stays. */
function lowerFirst(label: string): string {
  const t = label.trim()
  if (!t) return 'a value'
  return /^[A-Z][A-Z0-9]/.test(t) ? t : t[0].toLowerCase() + t.slice(1)
}

/** Every message a field can show: the custom ones, or defaults built from its label. */
export function messagesOf(field: FormField): Required<FieldMessages> {
  const name = lowerFirst(field.label)
  const { min, max } = field.rules
  const lengthy = field.widget === 'text' || field.widget === 'textarea'
  const required =
    field.widget === 'select' || field.widget === 'radio'
      ? `Choose ${name}`
      : field.widget === 'checkbox'
        ? 'Tick this box to continue'
        : field.widget === 'file'
          ? `Add ${name}`
          : `Enter ${name}`
  const format =
    field.widget === 'text' && field.inputType === 'email'
      ? 'Enter a valid email address, like name@example.com'
      : field.widget === 'text' && field.inputType === 'url'
        ? 'Enter a full URL, starting with https://'
        : field.widget === 'date'
          ? field.withTime
            ? 'Enter a valid date and time'
            : 'Enter a valid date'
          : field.widget === 'number' && field.integer
            ? 'Enter a whole number'
            : `Check ${name}`
  const defaults: Required<FieldMessages> = {
    required,
    min: lengthy ? `Use at least ${min} characters` : `Enter ${min} or more`,
    max: lengthy ? `Use ${max} characters or fewer` : field.widget === 'file' ? `Each file must be ${max} MB or smaller` : `Enter ${max} or less`,
    pattern: `Check the format of ${name}`,
    format,
  }
  const custom = Object.fromEntries(Object.entries(field.messages).filter(([, v]) => v?.trim())) as FieldMessages
  return { ...defaults, ...custom }
}

/* ---------- problems ---------- */

export interface FormProblem {
  itemId: string
  message: string
}

export function patternError(pattern: string): string | null {
  try {
    new RegExp(pattern)
    return null
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'not a valid regular expression'
  }
}

/**
 * The fields code can be generated for: valid keys, the first of any
 * duplicates, and no key that's also the parent of another (`buyer` and
 * `buyer.name`). The rest show up in `formProblems`.
 */
export function usableFields(form: Form): FormField[] {
  const out: FormField[] = []
  const keys = new Set<string>()
  for (const f of fieldsOf(form)) {
    if (!isValidKey(f.key) || keys.has(f.key)) continue
    const clash = [...keys].some((k) => k.startsWith(`${f.key}.`) || f.key.startsWith(`${k}.`))
    if (clash) continue
    keys.add(f.key)
    out.push(f)
  }
  return out
}

/** Why a field's "show when" can't be used, or null when it can (or there isn't one). */
function conditionProblem(field: FormField, byKey: Map<string, FormField>): string | null {
  const c = field.showWhen
  if (!c) return null
  if (c.field === field.key) return 'A field can’t depend on itself. Pick another field to show it by.'
  const source = byKey.get(c.field)
  if (!source) return `It’s shown by ${c.field || 'a field'}, which isn’t in the form any more.`
  if (c.op === 'equals' || c.op === 'not-equals') {
    const value = c.value ?? ''
    if (source.widget === 'file') return 'A file field can only be checked for being filled in or empty.'
    if ((source.widget === 'select' || source.widget === 'radio') && !source.options?.some((o) => o.value === value))
      return `“${value}” isn’t one of ${source.label}’s options any more.`
    if (source.widget === 'checkbox' && value !== 'true' && value !== 'false') return 'Pick ticked or not ticked.'
    if (source.widget === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) return `Type the number ${source.label} should be.`
  }
  return null
}

/** A field's condition, if code can be generated for it. */
export function usableCondition(form: Form, field: FormField): FormField['showWhen'] {
  const byKey = new Map(usableFields(form).map((f) => [f.key, f]))
  return conditionProblem(field, byKey) ? undefined : field.showWhen
}

/**
 * Inputs as the schema reads them: an empty text input holds '', an empty
 * number NaN and an unpicked radio null, and all of those mean "not filled
 * in", which the schema expects as undefined. Plain objects are cleaned all
 * the way down; anything else (a FileList, a Date) is kept as it is.
 */
export function blankValues(value: unknown): unknown {
  if (value === '' || value === null || Number.isNaN(value)) return undefined
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, blankValues(v)]))
  return value
}

/** The value at a dotted key: `address.city` reads `values.address?.city`. */
export function valueAt(values: unknown, key: string): unknown {
  let at = values
  for (const part of key.split('.')) at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[part] : undefined
  return at
}

/**
 * Whether a field shows, given the values so far (cleaned by `blankValues`),
 * decided the same way as the generated schema and component. A condition
 * code can't be generated for is ignored there, so the field shows here too.
 */
export function fieldShown(form: Form, field: FormField, values: unknown): boolean {
  const c = usableCondition(form, field)
  if (!c) return true
  const source = usableFields(form).find((f) => f.key === c.field)!
  const value = valueAt(values, c.field)
  const isFilled =
    source.widget === 'checkbox' ? value === true : source.widget === 'file' ? ((value as { length?: number } | undefined)?.length ?? 0) > 0 : value !== undefined
  switch (c.op) {
    case 'filled':
      return isFilled
    case 'empty':
      return !isFilled
    case 'equals':
    case 'not-equals': {
      const same = source.widget === 'checkbox' ? (value === true) === (c.value === 'true') : value === (source.widget === 'number' ? Number(c.value) : c.value)
      return c.op === 'equals' ? same : !same
    }
  }
}

/** A field's value as nested objects, in the order fields first appear: `a`, `b.c`, `b.d` → a, b { c, d }. */
export type ValueNode = { key: string; field: FormField } | { key: string; children: ValueNode[] }

export function valueTree(fields: FormField[]): ValueNode[] {
  const root: ValueNode[] = []
  for (const field of fields) {
    const parts = field.key.split('.')
    let level = root
    for (const part of parts.slice(0, -1)) {
      let node = level.find((n) => n.key === part)
      if (!node || !('children' in node)) {
        node = { key: part, children: [] }
        level.push(node)
      }
      level = node.children
    }
    level.push({ key: parts.at(-1)!, field })
  }
  return root
}

/** Things to fix, per item. The generators skip what these describe, so the code still compiles. */
export function formProblems(form: Form): FormProblem[] {
  const problems: FormProblem[] = []
  const usable = new Set(usableFields(form).map((f) => f.id))
  const all = fieldsOf(form)
  const byKey = new Map(usableFields(form).map((f) => [f.key, f]))

  for (const f of all) {
    const add = (message: string) => problems.push({ itemId: f.id, message })
    if (!isValidKey(f.key)) add('The key can only use letters, digits, _ and $, with dots between nested names (like shippingAddress.city).')
    else if (!usable.has(f.id)) {
      const first = all.find((o) => o !== f && usable.has(o.id) && (o.key === f.key || o.key.startsWith(`${f.key}.`) || f.key.startsWith(`${o.key}.`)))
      if (first?.key === f.key) add(`“${first.label}” already uses the key ${f.key}. Give this field another one.`)
      else if (first) add(`${first.key} and ${f.key} can't both be fields: one would hold the other. Rename one of them.`)
    }
    if ((f.widget === 'select' || f.widget === 'radio') && !f.options?.length) add('Add at least one option.')
    const values = f.options?.map((o) => o.value) ?? []
    const dup = values.find((v, i) => values.indexOf(v) !== i)
    if (dup !== undefined) add(`Two options have the value “${dup}”. Each needs its own.`)
    if (f.rules.pattern) {
      const err = patternError(f.rules.pattern)
      if (err) add(`The pattern isn't a valid regular expression (${err}).`)
    }
    if (f.rules.min !== undefined && f.rules.max !== undefined && f.rules.min > f.rules.max) add('The minimum is bigger than the maximum, so nothing can pass.')
    const condition = conditionProblem(f, byKey)
    if (condition) add(condition)
  }
  return problems
}

/* ---------- editing (immutably) ---------- */

export function updateItem(form: Form, id: string, patch: Partial<FormField> | Partial<SectionBreak> | Partial<StepBreak>): Form {
  return { ...form, items: form.items.map((i) => (i.id === id ? ({ ...i, ...patch } as FormItem) : i)) }
}

/**
 * Change a field's key, and point the conditions that used the old key at the
 * new one, so renaming doesn't silently break "show when".
 */
export function renameKey(form: Form, id: string, key: string): Form {
  const field = fieldsOf(form).find((f) => f.id === id)
  if (!field) return form
  const old = field.key
  return {
    ...form,
    items: form.items.map((i) => {
      if (i.id === id) return { ...i, key } as FormField
      if (i.kind === 'field' && i.showWhen?.field === old && old) return { ...i, showWhen: { ...i.showWhen, field: key } }
      return i
    }),
  }
}

export function insertItem(form: Form, item: FormItem, index: number): Form {
  const items = [...form.items]
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item)
  return { ...form, items }
}

export function removeItem(form: Form, id: string): Form {
  return { ...form, items: form.items.filter((i) => i.id !== id) }
}

export function moveItem(form: Form, from: number, to: number): Form {
  if (from === to || from < 0 || from >= form.items.length) return form
  const items = [...form.items]
  const [moved] = items.splice(from, 1)
  items.splice(Math.max(0, Math.min(to, items.length)), 0, moved)
  return { ...form, items }
}
