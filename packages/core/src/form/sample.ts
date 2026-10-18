import { fieldsOf, humanize } from './model'
import type { Form, FormField } from './types'

/**
 * Values that fill a form in believably and pass its own rules, for the
 * "filled" and "submitting" states of the variant canvas. Files can't be
 * filled in from code, and a pattern is only met when the placeholder (or a
 * common shape) matches it.
 */

const fit = (text: string, f: FormField) => {
  const { min, max } = f.rules
  let out = text
  while (min !== undefined && out.length < min) out += ` ${text}`
  if (max !== undefined && out.length > max) out = out.slice(0, max).trimEnd()
  if (min !== undefined && out.length < min) out = out.padEnd(min, 'x')
  return out
}

const matches = (pattern: string | undefined, value: string) => {
  if (!pattern) return true
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return true
  }
}

function textValue(f: FormField): string {
  const key = `${f.key} ${f.label}`.toLowerCase()
  const base =
    f.inputType === 'email' || key.includes('email')
      ? 'diya@example.in'
      : f.inputType === 'url' || /website|url|link/.test(key)
        ? 'https://example.in'
        : f.inputType === 'tel' || /phone|mobile/.test(key)
          ? '+91 98250 11223'
          : f.inputType === 'password'
            ? 'Correct-Horse-9'
            : /first.?name/.test(key)
              ? 'Diya'
              : /last.?name|surname/.test(key)
                ? 'Shah'
                : /name/.test(key)
                  ? 'Diya Shah'
                  : /city/.test(key)
                    ? 'Rajkot'
                    : /company|business/.test(key)
                      ? 'Shah Traders'
                      : f.widget === 'textarea'
                        ? 'Please deliver after 11 am. Ring the bell at the side gate.'
                        : humanize(f.key.split('.').at(-1) ?? f.key)
  const candidates = [fit(base, f), ...(f.placeholder ? [f.placeholder] : []), '24ABCDE1234F1Z5', '123456', 'ABC123', 'abc']
  return candidates.find((c) => matches(f.rules.pattern, c)) ?? fit(base, f)
}

function valueOf(f: FormField): unknown {
  switch (f.widget) {
    case 'text':
    case 'textarea':
      return textValue(f)
    case 'number': {
      const { min, max } = f.rules
      let v = min ?? (max !== undefined ? Math.min(max, 10) : 10)
      if (max !== undefined) v = Math.min(v, max)
      return f.integer ? Math.ceil(v) : v
    }
    case 'select':
    case 'radio':
      return f.options?.[0]?.value
    case 'checkbox':
      return true
    case 'date':
      return f.withTime ? '2026-10-18T09:30' : '2026-10-18'
    case 'file':
      return undefined
  }
}

/** Values for every field, nested by dotted keys (`address.city`). */
export function sampleFormValues(form: Form): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fieldsOf(form)) {
    const v = valueOf(f)
    if (v === undefined) continue
    const parts = f.key.split('.')
    let at = out
    for (const p of parts.slice(0, -1)) at = (at[p] ??= {}) as Record<string, unknown>
    at[parts[parts.length - 1]] = v
  }
  return out
}
