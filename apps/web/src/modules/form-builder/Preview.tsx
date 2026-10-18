import { Fragment, useCallback, useId, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { FieldError, FieldValues, Resolver, UseFormRegister } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { boolean, custom, email, enum as enumOf, iso, literal, number, object, string, url } from 'zod'
import type { ZodType } from 'zod'
import { RotateCcw, Send } from 'lucide-react'

import { blankValues, fieldShown, formZodRuntime, usableLayout, valueAt } from '@stacksketch/core'
import type { FORM_ZOD_FUNCTIONS, Form, FormField } from '@stacksketch/core'
import { Button } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'

/** Just the Zod functions form schemas call, so the rest of Zod (its locales above all) stays out of the bundle. */
const z = { boolean, custom, email, enum: enumOf, iso, literal, number, object, string, url } satisfies Record<(typeof FORM_ZOD_FUNCTIONS)[number], unknown>

/**
 * The form, working: React Hook Form with the very Zod schema the builder
 * exports (run from `formZodRuntime`), and the same rules as the exported
 * component for empty inputs, hidden fields and steps.
 */
function useResolver(form: Form): Resolver<FieldValues> | undefined {
  return useMemo(() => {
    try {
      const schema = new Function('z', formZodRuntime(form))(z) as ZodType<FieldValues, FieldValues>
      const validate = zodResolver(schema)
      return (values, context, options) => validate(blankValues(values) as FieldValues, context, options)
    } catch {
      // the generated code always runs; if it somehow doesn't, the preview fills in without checks
      return undefined
    }
  }, [form])
}

const control = 'w-full rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-ink placeholder:text-ink-3 outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 aria-invalid:border-danger'
const box = 'mt-0.5 size-4 shrink-0 accent-[var(--c-accent)]'

/** id, aria-invalid and aria-describedby, as in the exported component. */
function described(id: string, error: FieldError | undefined, help: boolean) {
  const ids = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean)
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': ids.join(' ') || undefined }
}

function Required() {
  return (
    <>
      <span aria-hidden className="text-danger">
        {' '}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

function Messages({ id, help, error }: { id: string; help?: string; error?: FieldError }) {
  return (
    <>
      {help ? (
        <p id={`${id}-help`} className="text-[12px] text-ink-3">
          {help}
        </p>
      ) : null}
      {error?.message ? (
        <p id={`${id}-error`} className="text-[12px] font-medium text-danger">
          {error.message}
        </p>
      ) : null}
    </>
  )
}

function PreviewField({ field, id, error, register }: { field: FormField; id: string; error: FieldError | undefined; register: UseFormRegister<FieldValues> }) {
  const a11y = described(id, error, Boolean(field.help))
  const label = (
    <>
      {field.label || field.key}
      {field.required ? <Required /> : null}
    </>
  )

  if (field.widget === 'checkbox')
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2.5">
          <input type="checkbox" className={box} {...a11y} {...register(field.key)} />
          <label htmlFor={id} className="text-[13px] text-ink">
            {label}
          </label>
        </div>
        <Messages id={id} help={field.help} error={error} />
      </div>
    )

  if (field.widget === 'radio')
    return (
      <fieldset aria-describedby={a11y['aria-describedby']} className="space-y-1.5">
        <legend className="text-[13px] font-medium text-ink">{label}</legend>
        <div className="space-y-1.5 pt-0.5">
          {(field.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2.5 text-[13px] text-ink-2">
              <input type="radio" value={o.value} className={box} {...register(field.key)} />
              {o.label || o.value}
            </label>
          ))}
        </div>
        <Messages id={id} help={field.help} error={error} />
      </fieldset>
    )

  let input: ReactNode
  switch (field.widget) {
    case 'text':
      input = <input type={field.inputType ?? 'text'} placeholder={field.placeholder} className={cx(control, 'h-9')} {...a11y} {...register(field.key)} />
      break
    case 'textarea':
      input = <textarea rows={4} placeholder={field.placeholder} className={cx(control, 'py-2')} {...a11y} {...register(field.key)} />
      break
    case 'number':
      input = (
        <input
          type="number"
          inputMode={field.integer ? 'numeric' : 'decimal'}
          step={field.integer ? 1 : 'any'}
          placeholder={field.placeholder}
          className={cx(control, 'h-9 font-mono')}
          {...a11y}
          {...register(field.key, { valueAsNumber: true })}
        />
      )
      break
    case 'date':
      input = <input type={field.withTime ? 'datetime-local' : 'date'} className={cx(control, 'h-9 font-mono')} {...a11y} {...register(field.key)} />
      break
    case 'file':
      input = (
        <input
          type="file"
          accept={field.accept}
          multiple={field.multiple}
          className="block w-full text-[13px] text-ink-2 file:mr-3 file:h-8 file:rounded-md file:border file:border-line-strong file:bg-raised file:px-3 file:text-[12.5px] file:font-medium file:text-ink hover:file:bg-hover"
          {...a11y}
          {...register(field.key)}
        />
      )
      break
    case 'select':
      input = (
        <select className={cx(control, 'h-9')} {...a11y} {...register(field.key)}>
          <option value="">{field.placeholder || 'Choose one'}</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label || o.value}
            </option>
          ))}
        </select>
      )
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {input}
      <Messages id={id} help={field.help} error={error} />
    </div>
  )
}

/** Values as JSON, with each file list as its files' names and sizes. */
const asJson = (values: unknown) =>
  JSON.stringify(values, (_key, v: unknown) => (typeof FileList !== 'undefined' && v instanceof FileList ? Array.from(v, (f) => `${f.name} (${f.size} bytes)`) : v), 2)

export default function Preview({ form }: { form: Form }) {
  const resolver = useResolver(form)
  const uid = useId()
  const steps = usableLayout(form)
  const [step, setStep] = useState(0)
  const [sent, setSent] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    trigger,
    getFieldState,
    reset,
    control: formControl,
    formState: { errors, isSubmitting },
  } = useForm<FieldValues>({ resolver, shouldUnregister: true })
  const values = blankValues(useWatch({ control: formControl }))

  // the form can lose steps while it's being edited
  const current = Math.min(step, steps.length - 1)
  const last = current === steps.length - 1
  const keysOf = (i: number) => steps[i].sections.flatMap((s) => s.fields.map((f) => f.key))
  const fieldCount = steps.reduce((n, s) => n + s.sections.reduce((m, x) => m + x.fields.length, 0), 0)

  const submit = handleSubmit(
    (data) => setSent(asJson(data)),
    () => {
      const first = steps.findIndex((_, i) => keysOf(i).some((key) => getFieldState(key).invalid))
      if (first >= 0) setStep(first)
    },
  )
  const next = async () => {
    const keys = keysOf(current)
    if (!keys.length || (await trigger(keys, { shouldFocus: true }))) setStep(current + 1)
  }
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void (last ? submit() : next())
  }
  // bring each new set of values into view (the section remounts per submit, keyed by them)
  const reveal = useCallback((el: HTMLElement | null) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [])
  const startOver = () => {
    reset()
    setStep(0)
    setSent(null)
  }

  return (
    <div className="paper-grid absolute inset-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-xl space-y-4 px-3 py-5 md:px-6 md:py-8">
        <form noValidate onSubmit={onSubmit} className="rounded-xl border border-line bg-raised shadow-pop" aria-label={`Preview of ${form.title || form.name}`}>
          <header className="border-b border-line px-5 pt-4 pb-3.5">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">{form.title || form.name}</h2>
            {form.description ? <p className="mt-1 text-[13px] text-ink-2">{form.description}</p> : null}
            {steps.length > 1 ? (
              <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                {steps.map((s, i) => (
                  <li key={s.id ?? i} aria-current={i === current ? 'step' : undefined} className={i === current ? 'font-medium text-accent' : 'text-ink-3'}>
                    {i + 1}. {s.title || `Step ${i + 1}`}
                  </li>
                ))}
              </ol>
            ) : null}
          </header>

          <div className="px-5 py-4">
            {fieldCount ? null : <p className="py-6 text-center text-[13px] text-ink-3">Add a field to try the form here.</p>}
            {steps.map((s, i) => (
              <div key={s.id ?? i} hidden={i !== current} className="space-y-4">
                {s.sections.map((section, j) => {
                  const fields = section.fields
                    .filter((f) => fieldShown(form, f, values))
                    .map((f) => <PreviewField key={f.id} field={f} id={`${uid}-${f.key}`} error={valueAt(errors, f.key) as FieldError | undefined} register={register} />)
                  if (!section.title && !section.description) return <Fragment key={section.id ?? j}>{fields}</Fragment>
                  return (
                    <section key={section.id ?? j} className="space-y-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
                      <div>
                        {section.title ? <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{section.title}</h3> : null}
                        {section.description ? <p className="mt-0.5 text-[12.5px] text-ink-2">{section.description}</p> : null}
                      </div>
                      {fields}
                    </section>
                  )
                })}
              </div>
            ))}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            {current > 0 ? (
              <Button variant="outline" onClick={() => setStep(current - 1)} className="h-9 px-4">
                Back
              </Button>
            ) : null}
            <Button type="submit" variant="primary" disabled={isSubmitting} className="h-9 px-4">
              {last ? form.submitLabel || 'Submit' : 'Next'}
            </Button>
          </footer>
        </form>

        {sent !== null ? (
          <section key={sent} ref={reveal} aria-live="polite" className="rounded-xl border border-line bg-raised">
            <header className="flex items-center gap-2 border-b border-line py-2 pr-2 pl-4">
              <Send size={14} className="text-ok" />
              <h3 className="text-[13px] font-semibold text-ink">The values onSubmit gets</h3>
              <Button size="sm" className="ml-auto" onClick={startOver}>
                <RotateCcw size={13} />
                Fill in again
              </Button>
            </header>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-2 scrollbar-thin">{sent}</pre>
          </section>
        ) : null}
      </div>
    </div>
  )
}
