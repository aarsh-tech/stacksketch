import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FORM_ZOD_FUNCTIONS,
  blankValues,
  createField,
  emptyForm,
  fieldShown,
  formFileNames,
  formZodRuntime,
  formFromSchema,
  formProblems,
  formToSchema,
  humanize,
  inferSchema,
  insertItem,
  keyFromLabel,
  layoutOf,
  messagesOf,
  regexLiteral,
  renameKey,
  toFormComponent,
  toFormZod,
  toTypeScript,
  toZod,
  uniqueKey,
  withWidget,
} from './index'
import type { Form, FormField, FormItem } from './index'
import { typecheck } from './typecheck.testutil'

let n = 0
const id = () => `i${++n}`

const field = (widget: FormField['widget'], key: string, extra: Partial<FormField> = {}): FormField => ({
  kind: 'field',
  id: id(),
  widget,
  key,
  label: humanize(key.split('.').at(-1)!),
  required: true,
  rules: {},
  messages: {},
  ...extra,
})

const form = (items: FormItem[], name = 'SignupForm'): Form => ({ ...emptyForm(id(), name), items })

/** The business sign-up from the roadmap: GST number only for companies. */
const signup = form([
  { kind: 'step', id: 'st1', title: 'About you' },
  field('text', 'fullName', { rules: { min: 2, max: 60 } }),
  field('text', 'email', { inputType: 'email' }),
  field('text', 'website', { inputType: 'url', required: false }),
  field('number', 'age', { integer: true, rules: { min: 18 }, messages: { min: 'You must be 18 or over' } }),
  { kind: 'step', id: 'st2', title: 'Business' },
  field('radio', 'businessType', {
    options: [
      { value: 'individual', label: 'Individual' },
      { value: 'company', label: 'Company' },
    ],
  }),
  field('text', 'gstNumber', {
    label: 'GST number',
    rules: { pattern: '^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' },
    showWhen: { field: 'businessType', op: 'equals', value: 'company' },
  }),
  { kind: 'section', id: 'sec1', title: 'Address' },
  field('text', 'address.line1'),
  field('text', 'address.pincode', { rules: { pattern: '^\\d{6}$' }, messages: { pattern: 'Pincodes have six digits' } }),
  field('select', 'address.state', { options: ['Gujarat', 'Maharashtra'].map((v) => ({ value: v, label: v })), required: false }),
  field('date', 'startedOn', { required: false }),
  field('date', 'callAt', { withTime: true, required: false }),
  field('textarea', 'about', { required: false, rules: { max: 200 } }),
  field('file', 'logo', { required: false, rules: { max: 2 } }),
  field('checkbox', 'terms', { label: 'I agree to the terms' }),
])

const valid = {
  fullName: 'Diya Shah',
  email: 'diya@shahtraders.in',
  age: 32,
  businessType: 'company',
  gstNumber: '24ABCDE1234F1Z5',
  address: { line1: '14 Station Road', pincode: '360001', state: 'Gujarat' },
  startedOn: '2019-04-01',
  callAt: '2026-10-20T11:30',
  terms: true,
}

/** Run the generated schema against the real zod and return it. */
function evalForm(code: string, exportName: string): z.ZodType {
  const js = code
    .replace(/^import .*$/m, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^export const /gm, 'const ')
    // strip the TypeScript bits the generator emits
    .replace(/z\.custom<FileList>/g, 'z.custom')
    .replace(/\(message\?: string\)/g, '(message)')
    .replace(/\(\{ value \}: \{ value: unknown \}\)/g, '({ value })')
  return new Function('z', `${js}\nreturn ${exportName}`)(z) as z.ZodType
}

/** first message per path, as a form shows them */
function errors(schema: z.ZodType, value: unknown): Record<string, string> {
  const r = schema.safeParse(value)
  if (r.success) return {}
  const out: Record<string, string> = {}
  for (const issue of r.error.issues) out[issue.path.join('.')] ??= issue.message
  return out
}

/** A stand-in for the browser's FileList. */
class FakeFileList {
  [i: number]: { size: number }
  length: number
  constructor(sizes: number[]) {
    sizes.forEach((size, i) => (this[i] = { size }))
    this.length = sizes.length
  }
}

describe('names', () => {
  it('turns keys into labels and labels into keys', () => {
    expect(humanize('contactName')).toBe('Contact name')
    expect(humanize('imageUrl')).toBe('Image URL')
    expect(humanize('line1')).toBe('Line 1')
    expect(humanize('gst_number')).toBe('GST number')
    expect(keyFromLabel('GST number')).toBe('gstNumber')
    expect(keyFromLabel('Your e-mail address')).toBe('yourEMailAddress')
    expect(keyFromLabel('???')).toBe('field')
    expect(uniqueKey('email', ['email', 'email2'])).toBe('email3')
  })
})

describe('layout', () => {
  it('splits the flat list into steps of sections', () => {
    const steps = layoutOf(signup)
    expect(steps.map((s) => s.title)).toEqual(['About you', 'Business'])
    expect(steps[1].sections.map((s) => s.title)).toEqual(['', 'Address'])
    expect(steps[1].sections[1].fields.map((f) => f.key)).toContain('address.pincode')
  })

  it('treats fields above the first marker as their own step', () => {
    const f = form([field('text', 'a'), { kind: 'step', id: 's', title: 'Two' }, field('text', 'b')])
    expect(layoutOf(f).map((s) => [s.id, s.sections.flatMap((x) => x.fields.map((y) => y.key))])).toEqual([
      [null, ['a']],
      ['s', ['b']],
    ])
    expect(layoutOf(form([]))).toHaveLength(1)
  })
})

describe('editing', () => {
  it('gives new fields unique keys', () => {
    let f = form([])
    for (let i = 0; i < 3; i++) f = insertItem(f, createField('text', id(), f), f.items.length)
    expect(f.items.map((x) => (x as FormField).key)).toEqual(['shortAnswer', 'shortAnswer2', 'shortAnswer3'])
  })

  it('keeps conditions pointing at a renamed field', () => {
    const typeField = signup.items.find((i) => i.kind === 'field' && i.key === 'businessType')!
    const renamed = renameKey(signup, typeField.id, 'entityType')
    const gst = renamed.items.find((i) => i.kind === 'field' && i.key === 'gstNumber') as FormField
    expect(gst.showWhen?.field).toBe('entityType')
    expect(formProblems(renamed)).toEqual([])
  })

  it('drops rules that mean something else for the new kind', () => {
    const text = field('text', 'name', { rules: { min: 2, max: 10, pattern: 'x' } })
    expect(withWidget(text, 'textarea').rules).toEqual({ min: 2, max: 10, pattern: 'x' })
    expect(withWidget(text, 'number').rules).toEqual({})
    expect(withWidget(text, 'select').options).toHaveLength(3)
    expect(withWidget(withWidget(text, 'select'), 'text').options).toBeUndefined()
  })
})

describe('problems', () => {
  it('points out what would break the code, and the code still compiles', () => {
    const broken = form([
      field('text', 'email'),
      field('text', 'email'),
      field('text', 'buyer'),
      field('text', 'buyer.name'),
      field('text', '1st'),
      field('text', 'code', { rules: { pattern: '([a-z]', min: 5, max: 2 } }),
      field('select', 'size', { options: [] }),
      field('text', 'gone', { showWhen: { field: 'nothing', op: 'filled' } }),
      field('text', 'pick', { showWhen: { field: 'businessType', op: 'equals', value: 'x' } }),
    ])
    const messages = formProblems(broken).map((p) => p.message)
    expect(messages).toEqual([
      expect.stringContaining('already uses the key email'),
      expect.stringContaining('one would hold the other'),
      expect.stringContaining('The key can only use'),
      expect.stringContaining('isn\'t a valid regular expression'),
      expect.stringContaining('minimum is bigger'),
      'Add at least one option.',
      expect.stringContaining('isn’t in the form any more'),
      expect.stringContaining('isn’t in the form any more'),
    ])
    const code = toFormZod(broken)
    expect(code).not.toContain('1st')
    expect(code).not.toContain('([a-z]')
    expect(typecheck({ 'package.json': '{"type":"module"}', 'schema.ts': code })).toEqual([])
  })

  it('needs condition values the source field can hold', () => {
    const choice = field('radio', 'kind', { options: [{ value: 'a', label: 'A' }] })
    const p = (c: FormField['showWhen'], source: FormField = choice) => formProblems(form([source, field('text', 'x', { showWhen: c })]))
    expect(p({ field: 'kind', op: 'equals', value: 'b' })[0].message).toContain('isn’t one of Kind’s options')
    expect(p({ field: 'kind', op: 'equals', value: 'a' })).toEqual([])
    expect(p({ field: 'n', op: 'equals', value: 'ten' }, field('number', 'n'))[0].message).toContain('Type the number')
    expect(p({ field: 'f', op: 'equals', value: 'x' }, field('file', 'f'))[0].message).toContain('filled in or empty')
    expect(p({ field: 'x', op: 'filled' })[0].message).toContain('depend on itself')
  })
})

describe('zod', () => {
  const code = toFormZod(signup)
  const schema = evalForm(code, 'signupFormSchema')
  const real = globalThis.FileList

  beforeAll(() => {
    ;(globalThis as Record<string, unknown>).FileList = FakeFileList
  })
  afterAll(() => {
    ;(globalThis as Record<string, unknown>).FileList = real
  })

  it('compiles under strict TypeScript', () => {
    expect(typecheck({ 'package.json': '{"type":"module"}', 'schema.ts': code })).toEqual([])
  })

  it('accepts a filled-in form', () => {
    expect(errors(schema, valid)).toEqual({})
    expect(errors(schema, { ...valid, logo: new FakeFileList([1024]) })).toEqual({})
  })

  it('says what to enter when required fields are missing', () => {
    expect(errors(schema, { address: {} })).toEqual({
      fullName: 'Enter full name',
      email: 'Enter email',
      age: 'Enter age',
      businessType: 'Choose business type',
      'address.line1': 'Enter line 1',
      'address.pincode': 'Enter pincode',
      terms: 'Tick this box to continue',
    })
  })

  it('checks rules with default and custom messages', () => {
    expect(
      errors(schema, {
        ...valid,
        fullName: ' D ',
        email: 'diya@',
        website: 'ftp://files.example.com',
        age: 16.5,
        address: { ...valid.address, pincode: '3600', state: 'Kerala' },
        startedOn: '2019-02-30',
        about: 'x'.repeat(201),
        terms: false,
      }),
    ).toEqual({
      fullName: 'Use at least 2 characters',
      email: 'Enter a valid email address, like name@example.com',
      website: 'Enter a full URL, starting with https://',
      age: 'Enter a whole number',
      'address.pincode': 'Pincodes have six digits',
      'address.state': expect.any(String),
      startedOn: 'Enter a valid date',
      about: 'Use 200 characters or fewer',
      terms: 'Tick this box to continue',
    })
    expect(errors(schema, { ...valid, age: 17 })).toEqual({ age: 'You must be 18 or over' })
    expect(errors(schema, { ...valid, logo: new FakeFileList([3 * 1024 * 1024]) })).toEqual({ logo: 'Each file must be 2 MB or smaller' })
  })

  it('requires a conditional field only when it shows, even while other fields have errors', () => {
    const { gstNumber: _gst, ...noGst } = valid
    expect(errors(schema, noGst)).toEqual({ gstNumber: 'Enter GST number' })
    expect(errors(schema, { ...noGst, businessType: 'individual' })).toEqual({})
    expect(errors(schema, { businessType: 'company', address: {} })).toMatchObject({ fullName: 'Enter full name', gstNumber: 'Enter GST number' })
    // including a non-whole number, which Zod's own .int() would abort on
    expect(errors(schema, { ...noGst, age: 32.5 })).toEqual({ age: 'Enter a whole number', gstNumber: 'Enter GST number' })
    // when it shows and is filled in, its own rules still apply
    expect(errors(schema, { ...valid, gstNumber: 'nope' })).toEqual({ gstNumber: 'Check the format of GST number' })
    // and the checks don't crash on something that isn't a form at all
    expect(errors(schema, null)).toEqual({ '': expect.any(String) })
  })

  it('handles every kind of condition', () => {
    const terms = field('checkbox', 'subscribe', { required: false })
    const qty = field('number', 'qty', { required: false })
    const file = field('file', 'cv', { required: false })
    const make = (extra: FormField[]) => form([terms, qty, file, ...extra], 'ConditionsForm')
    const f = make([
      field('text', 'freq', { showWhen: { field: 'subscribe', op: 'equals', value: 'true' } }),
      field('text', 'why', { showWhen: { field: 'subscribe', op: 'not-equals', value: 'true' } }),
      field('text', 'bulk', { showWhen: { field: 'qty', op: 'equals', value: '100' } }),
      field('text', 'cvNote', { showWhen: { field: 'cv', op: 'filled' } }),
      field('checkbox', 'noCv', { showWhen: { field: 'cv', op: 'empty' } }),
    ])
    const code = toFormZod(f)
    expect(typecheck({ 'package.json': '{"type":"module"}', 'schema.ts': code })).toEqual([])
    const s = evalForm(code, 'conditionsFormSchema')
    ;(globalThis as Record<string, unknown>).FileList = FakeFileList
    expect(Object.keys(errors(s, { subscribe: true, cv: new FakeFileList([]) }))).toEqual(['freq', 'noCv'])
    expect(Object.keys(errors(s, { subscribe: false, qty: 100, cv: new FakeFileList([1]) }))).toEqual(['why', 'bulk', 'cvNote'])
    expect(errors(s, { subscribe: false, qty: 1, cv: new FakeFileList([]), why: 'busy', noCv: true })).toEqual({})
  })

  it('writes patterns as regex literals that end where they should', () => {
    expect(regexLiteral('a/b')).toBe('/a\\/b/')
    expect(regexLiteral('a\\/b')).toBe('/a\\/b/')
    expect(regexLiteral('a\\\\/b')).toBe('/a\\\\\\/b/')
    const f = form([field('text', 'path', { rules: { pattern: '^/users/\\d+$' } })], 'PathForm')
    const s = evalForm(toFormZod(f), 'pathFormSchema')
    expect(errors(s, { path: '/users/42' })).toEqual({})
    expect(errors(s, { path: '/users/x' })).toEqual({ path: 'Check the format of path' })
  })

  it('uses custom messages over the defaults', () => {
    const f = field('text', 'email', { inputType: 'email', messages: { required: 'We need your email', format: '  ' } })
    expect(messagesOf(f).required).toBe('We need your email')
    expect(messagesOf(f).format).toContain('valid email')
  })
})

describe('from a schema', () => {
  const response = {
    orders: [
      {
        id: 'b3f1c2d4-7a8e-4f21-9c3d-2e5a6b7c8d90',
        number: 'WH-10421',
        status: 'shipped',
        placedAt: '2026-10-12T09:41:00+05:30',
        buyer: { id: 2201, company: 'Shah Traders', email: 'diya@shahtraders.in', address: { city: 'Rajkot' } },
        items: [{ sku: 'LMP-1001', quantity: 24 }],
        notes: null,
        deliveryNotes: 'Ring twice',
        isPaid: true,
        'gift-wrap': false,
        weight: 1.5,
        createdAt: '2026-10-12T09:41:00Z',
      },
      { id: 'x', number: 'WH-10422', status: 'pending', placedAt: '2026-10-13T16:05:00Z', buyer: { id: 1, company: 'M', email: 'r@m.in', phone: '1', address: { city: 'X' } }, items: [], notes: 'n', deliveryNotes: 'n', isPaid: false, 'gift-wrap': true, weight: 2, createdAt: '2026-10-13T16:05:00Z' },
    ],
  }
  const schema = inferSchema([response], 'OrdersResponse')
  const withEnum = { ...schema, types: schema.types.map((t) => (t.name === 'Order' ? { ...t, fields: t.fields.map((f) => (f.key === 'status' ? { ...f, shape: { kind: 'enum' as const, values: ['shipped', 'pending', 'in_transit'] } } : f)) } : t)) }
  const { form: order, skipped } = formFromSchema(withEnum, 'Order', id)

  it('makes a field per value, and a section per nested object', () => {
    const rows = order.items.map((i) => (i.kind === 'field' ? `${i.key}:${i.widget}${i.inputType ? `/${i.inputType}` : ''}${i.withTime ? '/time' : ''}${i.integer ? '/int' : ''}${i.required ? '' : '?'}` : `§ ${i.title}`))
    expect(rows).toEqual([
      'number:text',
      'status:radio',
      'placedAt:date/time',
      'notes:textarea?',
      'deliveryNotes:textarea',
      'isPaid:checkbox?',
      'weight:number',
      '§ Buyer',
      'buyer.company:text',
      'buyer.email:text/email',
      'buyer.phone:text?',
      '§ Buyer › Address',
      'buyer.address.city:text',
    ])
    expect(order.name).toBe('OrderForm')
    const status = order.items[1] as FormField
    expect(status.options?.map((o) => o.label)).toEqual(['Shipped', 'Pending', 'In transit'])
  })

  it('says what it left out and why', () => {
    expect(skipped.map((s) => s.key)).toEqual(['id', 'items', 'gift-wrap', 'createdAt', 'buyer.id'])
    expect(skipped.find((s) => s.key === 'items')?.reason).toContain('list')
    expect(formProblems(order)).toEqual([])
  })

  it('round-trips through the shared schema', () => {
    const back = formToSchema(order)
    expect(back.types.map((t) => t.name)).toEqual(['Address', 'Buyer', 'OrderFormValues'])
    const buyer = back.types.find((t) => t.name === 'Buyer')!
    expect(buyer.fields.map((f) => [f.key, f.shape.kind, f.optional])).toEqual([
      ['company', 'string', false],
      ['email', 'string', false],
      ['phone', 'string', true],
      ['address', 'ref', false],
    ])
    // and the shared generators take it like any inferred schema
    expect(toTypeScript(back)).toContain('export interface OrderFormValues')
    expect(toZod(back)).toContain('status: z.enum(["shipped", "pending", "in_transit"])')
  })

  it('makes a form whose schema compiles', () => {
    expect(typecheck({ 'package.json': '{"type":"module"}', 'schema.ts': toFormZod(order) })).toEqual([])
  })
})

describe('react component', () => {
  /** the settings a fresh `pnpm create vite --template react-ts` app type-checks with */
  const vite = { noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true, noFallthroughCasesInSwitch: true }
  const compile = (f: Form) => {
    const names = formFileNames(f)
    const app = `import { ${toFormComponentName(f)} } from './${names.component.replace(/\.tsx$/, '')}'\n\nexport const App = () => <${toFormComponentName(f)} onSubmit={(values) => console.log(values)} />\n`
    return typecheck({ 'package.json': '{"type":"module"}', [names.schema]: toFormZod(f), [names.component]: toFormComponent(f), 'App.tsx': app }, vite)
  }
  const toFormComponentName = (f: Form) => formFileNames(f).component.replace(/\.tsx$/, '')

  it('compiles with its schema under a fresh Vite app’s settings', () => {
    expect(compile(signup)).toEqual([])
  }, 60_000)

  it('compiles one-step forms, empty forms, every condition and forms with problems', () => {
    const conditions = form(
      [
        field('checkbox', 'subscribe', { required: false }),
        field('number', 'qty', { required: false }),
        field('file', 'cv', { required: false, multiple: true, accept: '.pdf' }),
        field('text', 'freq', { showWhen: { field: 'subscribe', op: 'equals', value: 'true' } }),
        field('text', 'bulk', { showWhen: { field: 'qty', op: 'equals', value: '100' } }),
        field('checkbox', 'noCv', { showWhen: { field: 'cv', op: 'empty' } }),
        field('select', 'size', { options: [{ value: "it's", label: 'Quote " and {brace} & <tag>' }], placeholder: 'Pick "one"' }),
      ],
      'ConditionsForm',
    )
    const broken = form([field('text', 'email'), field('text', 'email'), field('text', '1st'), field('select', 'none', { options: [] })], 'BrokenForm')
    const onlySteps = form([{ kind: 'step', id: 's1', title: 'One' }, { kind: 'step', id: 's2', title: 'Two' }], 'EmptyForm')
    for (const f of [conditions, broken, form([], 'BlankForm'), onlySteps, form([field('radio', 'pick', { options: [{ value: 'a', label: 'A' }] })], 'Field')])
      expect(compile(f), f.name).toEqual([])
  }, 60_000)

  it('walks through steps, checks each one, and hides conditional fields', () => {
    const code = toFormComponent(signup)
    expect(code).toContain(`{ title: 'About you', fields: ['fullName', 'email', 'website', 'age'] },`)
    expect(code).toContain(`const showGstNumber = values.businessType === 'company'`)
    expect(code).toContain(`await trigger(fields, { shouldFocus: true })`)
    expect(code).toContain(`{...register('age', { valueAsNumber: true })}`)
    expect(code).toContain(`import { signupFormSchema } from './signupForm.schema'`)
    // a form without steps has no step logic at all
    const single = toFormComponent(form([field('text', 'name')], 'NameForm'))
    expect(single).not.toContain('STEPS')
    expect(single).toContain('onSubmit={handleSubmit(onSubmit)}')
  })

  it('keeps clear of its own helpers’ names', () => {
    expect(formFileNames(form([], 'Field')).component).toBe('FieldForm.tsx')
    expect(formFileNames(signup)).toEqual({ schema: 'signupForm.schema.ts', component: 'SignupForm.tsx' })
  })
})

describe('preview helpers', () => {
  it('reads empty inputs as not filled in', () => {
    const files = new FakeFileList([])
    expect(blankValues({ a: '', b: null, c: Number.NaN, d: 0, e: false, f: { g: '' }, files })).toEqual({ a: undefined, b: undefined, c: undefined, d: 0, e: false, f: { g: undefined }, files })
  })

  it('runs the same schema as the exported code', () => {
    const real = globalThis.FileList
    ;(globalThis as Record<string, unknown>).FileList = FakeFileList
    try {
      const runtime = new Function('z', formZodRuntime(signup))(z) as z.ZodType
      const exported = evalForm(toFormZod(signup), 'signupFormSchema')
      for (const value of [valid, { address: {} }, { ...valid, gstNumber: undefined }, { ...valid, logo: new FakeFileList([5 * 1024 * 1024]) }, null])
        expect(errors(runtime, value)).toEqual(errors(exported, value))
    } finally {
      ;(globalThis as Record<string, unknown>).FileList = real
    }
  })

  it('calls no Zod function the preview doesn’t hand over', () => {
    const every = form([
      ...signup.items,
      field('number', 'qty', { required: false }),
      field('checkbox', 'subscribe', { required: false }),
      field('select', 'size', { options: [{ value: 's', label: 'S' }], required: false }),
      field('text', 'freq', { showWhen: { field: 'subscribe', op: 'equals', value: 'true' } }),
    ])
    const used = new Set([...formZodRuntime(every).matchAll(/\bz\.(\w+)/g)].map((m) => m[1]))
    expect([...used].sort()).toEqual([...FORM_ZOD_FUNCTIONS])
  })

  it('decides what shows the way the generated schema does', () => {
    const gst = signup.items.find((i) => i.kind === 'field' && i.key === 'gstNumber') as FormField
    expect(fieldShown(signup, gst, { businessType: 'company' })).toBe(true)
    expect(fieldShown(signup, gst, { businessType: 'individual' })).toBe(false)
    expect(fieldShown(signup, gst, {})).toBe(false)

    const subscribe = field('checkbox', 'subscribe', { required: false })
    const qty = field('number', 'qty', { required: false })
    const cv = field('file', 'cv', { required: false })
    const shows = (showWhen: FormField['showWhen'], values: unknown) => {
      const target = field('text', 'x', { showWhen })
      return fieldShown(form([subscribe, qty, cv, target]), target, values)
    }
    expect(shows({ field: 'subscribe', op: 'equals', value: 'true' }, { subscribe: true })).toBe(true)
    expect(shows({ field: 'subscribe', op: 'equals', value: 'false' }, { subscribe: undefined })).toBe(true)
    expect(shows({ field: 'subscribe', op: 'not-equals', value: 'true' }, { subscribe: true })).toBe(false)
    expect(shows({ field: 'qty', op: 'equals', value: '100' }, { qty: 100 })).toBe(true)
    expect(shows({ field: 'qty', op: 'not-equals', value: '100' }, { qty: 100 })).toBe(false)
    expect(shows({ field: 'qty', op: 'filled' }, { qty: 0 })).toBe(true)
    expect(shows({ field: 'qty', op: 'empty' }, {})).toBe(true)
    expect(shows({ field: 'cv', op: 'filled' }, { cv: new FakeFileList([]) })).toBe(false)
    expect(shows({ field: 'cv', op: 'empty' }, { cv: new FakeFileList([1]) })).toBe(false)
    // a condition the code leaves out never hides the field
    expect(shows({ field: 'gone', op: 'filled' }, {})).toBe(true)
  })
})
