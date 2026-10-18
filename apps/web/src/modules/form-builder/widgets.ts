import { AlignLeft, Calendar, ChevronDown, CircleDot, Hash, Heading, Paperclip, SquareCheck, StepForward, Type } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { Condition, Form, FormField, TextKind, Widget } from '@stacksketch/core'

export interface WidgetInfo {
  widget: Widget
  label: string
  icon: LucideIcon
  hint: string
}

export const WIDGETS: WidgetInfo[] = [
  { widget: 'text', label: 'Text', icon: Type, hint: 'One line: a name, an email, a URL' },
  { widget: 'textarea', label: 'Paragraph', icon: AlignLeft, hint: 'Several lines of text' },
  { widget: 'number', label: 'Number', icon: Hash, hint: 'A quantity, an amount, an age' },
  { widget: 'select', label: 'Dropdown', icon: ChevronDown, hint: 'Pick one from a list' },
  { widget: 'radio', label: 'Radio', icon: CircleDot, hint: 'Pick one, all options in view' },
  { widget: 'checkbox', label: 'Checkbox', icon: SquareCheck, hint: 'Yes or no, like agreeing to terms' },
  { widget: 'date', label: 'Date', icon: Calendar, hint: 'A day, or a day and a time' },
  { widget: 'file', label: 'File', icon: Paperclip, hint: 'An upload: a logo, a PDF' },
]

export const widgetInfo = (w: Widget) => WIDGETS.find((x) => x.widget === w) ?? WIDGETS[0]

export const LAYOUT_ITEMS = [
  { kind: 'section' as const, label: 'Section', icon: Heading, hint: 'A titled group of fields' },
  { kind: 'step' as const, label: 'Step', icon: StepForward, hint: 'Starts a new page of a multi-step form' },
]

export const TEXT_KINDS: { value: TextKind; label: string }[] = [
  { value: 'text', label: 'Plain text' },
  { value: 'email', label: 'Email' },
  { value: 'url', label: 'URL' },
  { value: 'tel', label: 'Phone' },
  { value: 'password', label: 'Password' },
]

/** "is Registered company", "is ticked", "is filled in" */
export function conditionText(c: Condition, source: FormField | undefined): string {
  if (c.op === 'filled') return 'is filled in'
  if (c.op === 'empty') return 'is empty'
  const is = c.op === 'equals'
  if (source?.widget === 'checkbox') return (c.value === 'true') === is ? 'is ticked' : 'isn’t ticked'
  const label = source?.options?.find((o) => o.value === c.value)?.label ?? c.value ?? ''
  return `${is ? 'is' : 'isn’t'} ${label ? `“${label}”` : 'empty'}`
}

/** "Shows when Business type is “Registered company”" */
export function showsWhen(form: Form, field: FormField): string | null {
  const c = field.showWhen
  if (!c) return null
  const source = form.items.find((i): i is FormField => i.kind === 'field' && i.key === c.field)
  return `Shows when ${source?.label || c.field || 'another field'} ${conditionText(c, source)}`
}
