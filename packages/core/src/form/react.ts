import { pascalCase } from '../names'
import { usableCondition, usableFields, usableLayout } from './model'
import type { Form, FormField } from './types'
import { formSchemaName, formValuesName, shownWhen } from './zod'

/** A single-quoted string literal, the way the rest of the file is written. */
const str = (s: string) => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`

/** Names the component file declares or imports, which the component's own names must not shadow. */
const TAKEN = new Set(['Field', 'CheckField', 'ChoiceField', 'Messages', 'Required', 'FormEvent', 'ReactNode', 'FieldPath', 'Resolver', 'UseFormProps'])

/** `BuyerSignupForm`: the component's name, kept clear of the helpers next to it. */
export function formComponentName(form: Form): string {
  const name = pascalCase(form.name)
  return TAKEN.has(name) || TAKEN.has(`${name}Props`) || TAKEN.has(`${name}Input`) ? `${name}Form` : name
}

/** The two files a form exports, the component importing the schema by this name. */
export function formFileNames(form: Form): { schema: string; component: string } {
  return { schema: `${formSchemaName(form).replace(/Schema$/, '')}.schema.ts`, component: `${formComponentName(form)}.tsx` }
}

/* ---------- JSX text ---------- */

/** Text between tags, as an expression when it holds characters JSX would read as code. */
const text = (s: string) => (/[{}<>&]|^\s|\s$/.test(s) ? `{${str(s)}}` : s)

/** A string prop: `label="Full name"`, or `label={"…"}` when quotes or entities would get in the way. */
const prop = (name: string, s: string) => (/["&\\\n\r]/.test(s) ? `${name}={${str(s)}}` : `${name}="${s}"`)

/** `address.city` → `errors.address?.city`, the error for one field. */
const errorOf = (key: string) => `errors.${key.split('.').join('?.')}`

/** `address.city` → `ADDRESS_CITY_OPTIONS`. */
const optionsName = (key: string) =>
  `${key
    .split('.')
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase())
    .join('_')}_OPTIONS`

/** `address.city` → `showAddressCity`. */
const showName = (key: string) => `show${key.split('.').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}`

const indent = (code: string, by: number) =>
  code
    .split('\n')
    .map((line) => (line ? ' '.repeat(by) + line : line))
    .join('\n')

/* ---------- styles (Tailwind) ---------- */

const CLASSES = {
  inputClass:
    'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 focus:outline-none aria-invalid:border-red-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100',
  fileClass:
    'block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 hover:file:bg-zinc-200 dark:text-zinc-300 dark:file:bg-zinc-800 dark:file:text-zinc-100',
  checkClass: 'mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100',
}

const BUTTONS = {
  buttonClass:
    'inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100',
  backButtonClass:
    'inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800',
}

/* ---------- fields ---------- */

/** The input for one field, registered under its key. */
function inputJsx(field: FormField): string {
  const key = field.key
  const a11y = `{...described(\`\${id}-${key}\`, ${errorOf(key)}${field.help ? ', true' : ''})}`
  const placeholder = field.placeholder ? [prop('placeholder', field.placeholder)] : []
  const tag = (name: string, attrs: string[], register = `{...register('${key}')}`) => `<${name}\n  ${[...attrs, a11y, register].join('\n  ')}\n/>`

  switch (field.widget) {
    case 'text':
      return tag('input', [`type="${field.inputType ?? 'text'}"`, ...placeholder, 'className={inputClass}'])
    case 'textarea':
      return tag('textarea', ['rows={4}', ...placeholder, 'className={inputClass}'])
    case 'number':
      return tag(
        'input',
        ['type="number"', field.integer ? 'inputMode="numeric"' : 'inputMode="decimal"', field.integer ? 'step={1}' : 'step="any"', ...placeholder, 'className={inputClass}'],
        `{...register('${key}', { valueAsNumber: true })}`,
      )
    case 'date':
      return tag('input', [`type="${field.withTime ? 'datetime-local' : 'date'}"`, 'className={inputClass}'])
    case 'file':
      return tag('input', ['type="file"', ...(field.accept ? [prop('accept', field.accept)] : []), ...(field.multiple ? ['multiple'] : []), 'className={fileClass}'])
    case 'checkbox':
      return tag('input', ['type="checkbox"', 'className={checkClass}'])
    case 'select':
      return [
        `<select className={inputClass} ${a11y} {...register('${key}')}>`,
        `  <option value="">${text(field.placeholder || 'Choose one')}</option>`,
        `  {${optionsName(key)}.map((option) => (`,
        `    <option key={option.value} value={option.value}>`,
        `      {option.label}`,
        `    </option>`,
        `  ))}`,
        `</select>`,
      ].join('\n')
    case 'radio':
      return [
        `{${optionsName(key)}.map((option) => (`,
        `  <label key={option.value} className="flex items-center gap-2.5 text-sm text-zinc-800 dark:text-zinc-200">`,
        `    <input type="radio" value={option.value} className={checkClass} {...register('${key}')} />`,
        `    {option.label}`,
        `  </label>`,
        `))}`,
      ].join('\n')
  }
}

/** One field with its label, hint and error, shown only while its condition holds. */
function fieldJsx(form: Form, field: FormField): string {
  const wrapper = field.widget === 'checkbox' ? 'CheckField' : field.widget === 'radio' ? 'ChoiceField' : 'Field'
  const props = [
    `id={\`\${id}-${field.key}\`}`,
    prop('label', field.label || field.key),
    ...(field.required ? ['required'] : []),
    ...(field.help ? [prop('help', field.help)] : []),
    `error={${errorOf(field.key)}?.message}`,
  ]
  const jsx = `<${wrapper} ${props.join(' ')}>\n${indent(inputJsx(field), 2)}\n</${wrapper}>`
  return usableCondition(form, field) ? `{${showName(field.key)} ? (\n${indent(jsx, 2)}\n) : null}` : jsx
}

/* ---------- helpers in the file ---------- */

const BLANK = `/** Empty inputs hold '' (text), NaN (number) or null (radio); the schema reads "not filled in" as undefined. */
function blank(value: unknown): unknown {
  if (value === '' || value === null || Number.isNaN(value)) return undefined
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, blank(v)]))
  return value
}`

const DESCRIBED = `/** The id, aria-invalid and aria-describedby for an input, so screen readers read its hint and error with it. */
function described(id: string, error: unknown, help = false) {
  const ids = [help ? \`\${id}-help\` : '', error ? \`\${id}-error\` : ''].filter(Boolean)
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': ids.join(' ') || undefined }
}`

const FIELD_PROPS = `interface FieldProps {
  id: string
  label: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
}

function Required() {
  return (
    <>
      <span aria-hidden="true" className="text-red-600 dark:text-red-400">
        {' '}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

/** The hint and the error under a field. */
function Messages({ id, help, error }: Pick<FieldProps, 'id' | 'help' | 'error'>) {
  return (
    <>
      {help ? (
        <p id={\`\${id}-help\`} className="text-sm text-zinc-500 dark:text-zinc-400">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={\`\${id}-error\`} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </>
  )
}`

const WRAPPERS: Record<'Field' | 'CheckField' | 'ChoiceField', string> = {
  Field: `/** A label with its input under it. */
function Field({ id, label, required, help, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label}
        {required ? <Required /> : null}
      </label>
      {children}
      <Messages id={id} help={help} error={error} />
    </div>
  )
}`,
  CheckField: `/** A checkbox with its label beside it. */
function CheckField({ id, label, required, help, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2.5">
        {children}
        <label htmlFor={id} className="text-sm text-zinc-900 dark:text-zinc-100">
          {label}
          {required ? <Required /> : null}
        </label>
      </div>
      <Messages id={id} help={help} error={error} />
    </div>
  )
}`,
  ChoiceField: `/** Radio buttons under a legend. */
function ChoiceField({ id, label, required, help, error, children }: FieldProps) {
  return (
    <fieldset aria-describedby={described(id, error, Boolean(help))['aria-describedby']} className="space-y-2">
      <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label}
        {required ? <Required /> : null}
      </legend>
      <div className="space-y-2">{children}</div>
      <Messages id={id} help={help} error={error} />
    </fieldset>
  )
}`,
}

/* ---------- the component ---------- */

/**
 * A React component for the form: React Hook Form with the form's Zod schema
 * (from `toFormZod`, in the file `formFileNames(form).schema`) as its
 * resolver, styled with Tailwind. It turns empty inputs into undefined
 * before validating, hides fields whose condition doesn't hold (and drops
 * their values), and walks through steps one at a time, checking each
 * step's fields before the next.
 */
export function toFormComponent(form: Form): string {
  const fields = usableFields(form)
  const name = formComponentName(form)
  const schema = formSchemaName(form)
  const values = formValuesName(form)
  const input = `${name}Input`
  const files = formFileNames(form)

  const steps = usableLayout(form)
  const multiStep = steps.length > 1
  const conditional = fields.filter((f) => usableCondition(form, f))
  const choices = fields.filter((f) => f.widget === 'select' || f.widget === 'radio')
  const wrappers = (['Field', 'CheckField', 'ChoiceField'] as const).filter((w) =>
    fields.some((f) => (w === 'CheckField' ? f.widget === 'checkbox' : w === 'ChoiceField' ? f.widget === 'radio' : f.widget !== 'checkbox' && f.widget !== 'radio')),
  )
  const classes = Object.entries(CLASSES).filter(([c]) =>
    fields.some((f) => (c === 'fileClass' ? f.widget === 'file' : c === 'checkClass' ? f.widget === 'checkbox' || f.widget === 'radio' : !['file', 'checkbox', 'radio'].includes(f.widget))),
  )

  /* imports */
  const lines: string[] = [
    '/**',
    ` * ${form.title ? `${form.title.replace(/\*\//g, '* /')}: the` : 'The'} ${name} form, made with Stacksketch.`,
    ' *',
    ' * Needs react-hook-form, @hookform/resolvers and zod (pnpm add react-hook-form @hookform/resolvers zod),',
    ` * Tailwind CSS for the styles, and ${files.schema} next to this file.`,
    ' */',
    ...(fields.length || multiStep ? [`import { ${[...(fields.length ? ['useId'] : []), ...(multiStep ? ['useState'] : [])].join(', ')} } from 'react'`] : []),
    ...(wrappers.length || multiStep ? [`import type { ${[...(multiStep ? ['FormEvent'] : []), ...(wrappers.length ? ['ReactNode'] : [])].join(', ')} } from 'react'`] : []),
    `import { ${conditional.length ? 'useForm, useWatch' : 'useForm'} } from 'react-hook-form'`,
    `import type { ${multiStep ? 'FieldPath, ' : ''}Resolver, UseFormProps } from 'react-hook-form'`,
    `import { zodResolver } from '@hookform/resolvers/zod'`,
    `import type { z } from 'zod'`,
    '',
    `import { ${schema} } from './${files.schema.replace(/\.ts$/, '')}'`,
    `import type { ${values} } from './${files.schema.replace(/\.ts$/, '')}'`,
  ]
  const blocks: string[] = [lines.join('\n')]

  blocks.push(`/** What the inputs hold before they're checked. */\ntype ${input} = z.input<typeof ${schema}>`)
  blocks.push(BLANK)
  blocks.push(
    `const validate = zodResolver(${schema})\nconst resolver: Resolver<${input}, unknown, ${values}> = (inputs, context, options) => validate(blank(inputs) as ${input}, context, options)`,
  )
  const buttons = Object.entries(BUTTONS).filter(([c]) => multiStep || c === 'buttonClass')
  blocks.push([...classes, ...buttons].map(([c, v]) => `const ${c} =\n  ${str(v)}`).join('\n'))
  for (const f of choices)
    blocks.push(
      f.options?.length
        ? `const ${optionsName(f.key)} = [\n${f.options.map((o) => `  { value: ${str(o.value)}, label: ${str(o.label || o.value)} },`).join('\n')}\n]`
        : `const ${optionsName(f.key)}: { value: string; label: string }[] = []`,
    )
  if (multiStep) {
    const list = steps.map((s, i) => {
      const keys = s.sections.flatMap((sec) => sec.fields.map((f) => `'${f.key}'`))
      return `  { title: ${str(s.title || `Step ${i + 1}`)}, fields: [${keys.join(', ')}] },`
    })
    blocks.push(`const STEPS: { title: string; fields: FieldPath<${input}>[] }[] = [\n${list.join('\n')}\n]`)
  }

  blocks.push(
    `export interface ${name}Props {\n  /** called with the checked values; the submit button is disabled until it settles */\n  onSubmit: (values: ${values}) => void | Promise<void>\n  defaultValues?: UseFormProps<${input}, unknown, ${values}>['defaultValues']\n}`,
  )

  /* the body */
  const hooks = [...(fields.length ? ['register'] : []), 'handleSubmit', ...(multiStep ? ['trigger', 'getFieldState'] : []), ...(conditional.length ? ['control'] : [])]
  const body: string[] = [
    ...(fields.length ? [`const id = useId()`] : []),
    ...(multiStep ? [`const [step, setStep] = useState(0)`] : []),
    `const {`,
    `  ${hooks.join(',\n  ')},`,
    `  formState: { ${fields.length ? 'errors, ' : ''}isSubmitting },`,
    `} = useForm<${input}, unknown, ${values}>({`,
    `  resolver,`,
    `  defaultValues,`,
    `  // a field hidden by its condition drops out of the values${multiStep ? '; steps stay mounted, so theirs are kept' : ''}`,
    `  shouldUnregister: true,`,
    `})`,
  ]
  if (conditional.length) {
    body.push('', `// fields that only show sometimes`, `const values = blank(useWatch({ control })) as ${input}`)
    for (const f of conditional) {
      const c = usableCondition(form, f)!
      const source = fields.find((s) => s.key === c.field)!
      body.push(`const ${showName(f.key)} = ${shownWhen(c, source, 'values', str)}`)
    }
  }
  if (multiStep)
    body.push(
      '',
      `const last = step === STEPS.length - 1`,
      `const next = async () => {`,
      `  const fields = STEPS[step].fields`,
      `  if (!fields.length || (await trigger(fields, { shouldFocus: true }))) setStep(step + 1)`,
      `}`,
      `// if something's still wrong when it's sent, go back to the first step with an error`,
      `const submit = handleSubmit(onSubmit, () => {`,
      `  const first = STEPS.findIndex((s) => s.fields.some((field) => getFieldState(field).invalid))`,
      `  if (first >= 0) setStep(first)`,
      `})`,
      `// Enter on an earlier step moves on rather than sending a half-filled form`,
      `const onFormSubmit = (e: FormEvent<HTMLFormElement>) => {`,
      `  e.preventDefault()`,
      `  void (last ? submit() : next())`,
      `}`,
    )

  /* the markup */
  const sectionJsx = (s: (typeof steps)[number]['sections'][number]) => {
    const inner = s.fields.map((f) => fieldJsx(form, f))
    if (!s.title && !s.description) return inner.join('\n')
    const heading = [
      ...(s.title ? [`<h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">${text(s.title)}</h3>`] : []),
      ...(s.description ? [`<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">${text(s.description)}</p>`] : []),
    ]
    return `<section className="space-y-5 border-t border-zinc-200 pt-6 dark:border-zinc-800">\n  <div>\n${indent(heading.join('\n'), 4)}\n  </div>\n${indent(inner.join('\n'), 2)}\n</section>`
  }
  const stepJsx = (s: (typeof steps)[number]) => s.sections.map(sectionJsx).filter(Boolean).join('\n')

  const header = [
    `<h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">${text(form.title || name)}</h2>`,
    ...(form.description ? [`<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">${text(form.description)}</p>`] : []),
  ]
  const markup: string[] = [`<header>\n${indent(header.join('\n'), 2)}\n</header>`]
  if (multiStep) {
    markup.push(
      [
        `<ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm">`,
        `  {STEPS.map((s, i) => (`,
        `    <li`,
        `      key={i}`,
        `      aria-current={i === step ? 'step' : undefined}`,
        `      className={i === step ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`,
        `    >`,
        `      {i + 1}. {s.title}`,
        `    </li>`,
        `  ))}`,
        `</ol>`,
      ].join('\n'),
    )
    steps.forEach((s, i) => markup.push(`<div hidden={step !== ${i}} className="space-y-5">\n${indent(stepJsx(s), 2)}\n</div>`))
  } else if (steps[0]) markup.push(stepJsx(steps[0]))

  const submitLabel = form.submitLabel || 'Submit'
  markup.push(
    [
      `<footer className="flex items-center justify-end gap-3">`,
      ...(multiStep
        ? [
            `  {step > 0 ? (`,
            `    <button type="button" onClick={() => setStep(step - 1)} className={backButtonClass}>`,
            `      Back`,
            `    </button>`,
            `  ) : null}`,
          ]
        : []),
      `  <button type="submit" disabled={isSubmitting} className={buttonClass}>`,
      `    ${multiStep ? `{last ? ${str(submitLabel)} : 'Next'}` : text(submitLabel)}`,
      `  </button>`,
      `</footer>`,
    ].join('\n'),
  )

  const component = [
    `export function ${name}({ onSubmit, defaultValues }: ${name}Props) {`,
    indent(body.join('\n'), 2),
    '',
    '  return (',
    `    <form noValidate onSubmit={${multiStep ? 'onFormSubmit' : 'handleSubmit(onSubmit)'}} className="mx-auto max-w-xl space-y-6">`,
    indent(markup.join('\n'), 6),
    '    </form>',
    '  )',
    '}',
  ]
  blocks.push(component.join('\n'))

  if (fields.length) blocks.push(DESCRIBED)
  if (wrappers.length) blocks.push(FIELD_PROPS, ...wrappers.map((w) => WRAPPERS[w]))
  return blocks.join('\n\n') + '\n'
}
