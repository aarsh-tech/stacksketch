/**
 * A form: the fields someone fills in, in order, with their validation and
 * when they show. This is a layout on top of data, not a second schema
 * format: each field's value is a shared-schema `Shape` (see `formToSchema`),
 * and forms made from the API explorer start from its `Schema`.
 *
 * Sections and steps are markers in one flat list, the way a long form reads
 * top to bottom: a section marker starts a titled group, a step marker starts
 * a new page. That keeps reordering to a single list.
 */

export type Widget = 'text' | 'textarea' | 'number' | 'select' | 'radio' | 'checkbox' | 'date' | 'file'

/** what a text field holds; email and url are checked, tel and password only change the keyboard and masking */
export type TextKind = 'text' | 'email' | 'url' | 'tel' | 'password'

export interface ChoiceOption {
  value: string
  label: string
}

/**
 * What a field must satisfy beyond its type. `min` and `max` mean characters
 * for text, the value for numbers, and megabytes per file (`max` only) for files.
 */
export interface FieldRules {
  min?: number
  max?: number
  /** a regular expression the value must match, without slashes; use ^ and $ to match all of it */
  pattern?: string
}

/** Custom error messages; each falls back to a plain-English default built from the label. */
export interface FieldMessages {
  required?: string
  min?: string
  max?: string
  pattern?: string
  /** not a valid email, URL, date or whole number */
  format?: string
}

export type ConditionOp = 'equals' | 'not-equals' | 'filled' | 'empty'

/** Show a field only when another field has (or doesn't have) a value. */
export interface Condition {
  /** the key of the field it depends on */
  field: string
  op: ConditionOp
  /** for equals / not-equals; "true" or "false" when the other field is a checkbox */
  value?: string
}

export interface FormField {
  kind: 'field'
  id: string
  widget: Widget
  /** where the value goes, e.g. `email` or `shippingAddress.city` */
  key: string
  label: string
  placeholder?: string
  /** a hint under the field */
  help?: string
  required: boolean
  /** text only */
  inputType?: TextKind
  /** number only: whole numbers */
  integer?: boolean
  /** date only: a date and a time */
  withTime?: boolean
  /** select and radio */
  options?: ChoiceOption[]
  /** file only: allowed types, as in `<input accept>` */
  accept?: string
  /** file only */
  multiple?: boolean
  rules: FieldRules
  messages: FieldMessages
  showWhen?: Condition
}

export interface SectionBreak {
  kind: 'section'
  id: string
  title: string
  description?: string
}

export interface StepBreak {
  kind: 'step'
  id: string
  title: string
}

export type FormItem = FormField | SectionBreak | StepBreak

export interface Form {
  version: 1
  id: string
  /** the component name in exported code, e.g. `SignupForm` */
  name: string
  /** the heading shown above the form */
  title: string
  description?: string
  submitLabel: string
  items: FormItem[]
  /** the API explorer type this form was made from, if any */
  source?: string
}
