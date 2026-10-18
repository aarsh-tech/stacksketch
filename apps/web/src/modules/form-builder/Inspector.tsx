import { Copy, Plus, Trash2, TriangleAlert, X } from 'lucide-react'

import { fieldsOf, isValidKey, keyFromLabel, messagesOf, pascalCase, renameKey, ruleUnit, uniqueKey, updateItem, usableFields, withWidget } from '@stacksketch/core'
import type { ChoiceOption, Condition, FieldMessages, FieldRules, Form, FormField, FormItem, SectionBreak, StepBreak, TextKind, Widget } from '@stacksketch/core'
import { Button, Checkbox, Group, Labeled, Segmented, Select, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { conditionText, TEXT_KINDS, WIDGETS } from './widgets'

type Change = (change: (form: Form) => Form) => void

/* ---------- small pieces ---------- */

function NumberInput({ value, onChange, label, min }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; min?: number }) {
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' || !Number.isFinite(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)}
      className={cx(inputClass, 'w-full font-mono')}
    />
  )
}

/** `Registered company` → `registered-company` */
const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/* ---------- form, section and step ---------- */

function FormSettings({ form, change, onDeleteForm }: { form: Form; change: Change; onDeleteForm: () => void }) {
  const set = (patch: Partial<Form>) => change((f) => ({ ...f, ...patch }))
  return (
    <>
      <Group title="Form">
        <Labeled label="Title" hint="The heading above the form.">
          <TextInput value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Labeled>
        <Labeled label="Description">
          <TextInput value={form.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
        </Labeled>
        <Labeled label="Submit button">
          <TextInput value={form.submitLabel} onChange={(e) => set({ submitLabel: e.target.value })} placeholder="Submit" />
        </Labeled>
      </Group>
      <Group title="Code">
        <Labeled label="Component name" hint={<>The schema is called <span className="font-mono">{pascalCase(form.name).replace(/^./, (c) => c.toLowerCase())}Schema</span>.</>}>
          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} onBlur={() => set({ name: pascalCase(form.name || 'Form') })} className="font-mono" />
        </Labeled>
        {form.source ? (
          <p className="text-[12px] text-ink-3">
            Made from <span className="font-mono text-t-ref">{form.source}</span> in the API explorer.
          </p>
        ) : null}
      </Group>
      <Group title="Danger zone">
        <Button variant="outline" size="sm" onClick={onDeleteForm}>
          <Trash2 size={13} />
          Delete this form
        </Button>
      </Group>
    </>
  )
}

function MarkerSettings({ item, change, onRemove }: { item: SectionBreak | StepBreak; change: Change; onRemove: () => void }) {
  const set = (patch: Partial<SectionBreak>) => change((f) => updateItem(f, item.id, patch))
  return (
    <Group title={item.kind === 'section' ? 'Section' : 'Step'}>
      <Labeled label="Title" hint={item.kind === 'step' ? 'Shown at the top of the step.' : undefined}>
        <TextInput value={item.title} onChange={(e) => set({ title: e.target.value })} />
      </Labeled>
      {item.kind === 'section' ? (
        <Labeled label="Description">
          <TextInput value={item.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
        </Labeled>
      ) : null}
      <p className="text-[12px] text-ink-3">
        {item.kind === 'section' ? 'Fields below this, up to the next section or step, are in this section.' : 'Fields below this, up to the next step, are on this page.'}
      </p>
      <Button variant="outline" size="sm" onClick={onRemove}>
        <Trash2 size={13} />
        Delete this {item.kind}
      </Button>
    </Group>
  )
}

/* ---------- field ---------- */

function OptionsEditor({ options, onChange }: { options: ChoiceOption[]; onChange: (o: ChoiceOption[]) => void }) {
  const edit = (i: number, patch: Partial<ChoiceOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] gap-x-1.5 gap-y-1.5 text-[11.5px] font-medium text-ink-3">
        <span>Label</span>
        <span>Value</span>
        <span className="w-7" />
        {options.map((o, i) => (
          <div key={i} className="contents">
            <TextInput
              aria-label={`Label of option ${i + 1}`}
              value={o.label}
              // the value follows the label until it's edited by hand
              onChange={(e) => edit(i, o.value === slug(o.label) ? { label: e.target.value, value: slug(e.target.value) } : { label: e.target.value })}
            />
            <TextInput aria-label={`Value of option ${i + 1}`} value={o.value} onChange={(e) => edit(i, { value: e.target.value })} className="font-mono" />
            <button
              type="button"
              aria-label={`Remove option ${o.label || i + 1}`}
              title="Remove"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1.5 -ml-2"
        onClick={() => {
          let n = options.length + 1
          while (options.some((o) => o.value === `option-${n}`)) n++
          onChange([...options, { label: `Option ${n}`, value: `option-${n}` }])
        }}
      >
        <Plus size={13} />
        Add an option
      </Button>
    </div>
  )
}

/** One rule: its value and the message shown when it fails. */
function RuleRow({ label, value, onValue, message, placeholder, onMessage, min }: {
  label: string
  value: number | undefined
  onValue: (v: number | undefined) => void
  message: string | undefined
  placeholder: string
  onMessage: (m: string | undefined) => void
  min?: number
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-end gap-1.5">
      <Labeled label={label}>
        <NumberInput label={label} value={value} onChange={onValue} min={min} />
      </Labeled>
      <TextInput aria-label={`Message when ${label.toLowerCase()} fails`} value={message ?? ''} placeholder={value === undefined ? 'Set a value first' : placeholder} disabled={value === undefined} onChange={(e) => onMessage(e.target.value || undefined)} />
    </div>
  )
}

const OP_LABEL = (source: FormField | undefined) =>
  source?.widget === 'checkbox'
    ? [
        { value: 'equals:true', label: 'is ticked' },
        { value: 'equals:false', label: 'isn’t ticked' },
      ]
    : source?.widget === 'file'
      ? [
          { value: 'filled', label: 'has a file' },
          { value: 'empty', label: 'has no file' },
        ]
      : [
          { value: 'equals', label: 'is' },
          { value: 'not-equals', label: 'isn’t' },
          { value: 'filled', label: 'is filled in' },
          { value: 'empty', label: 'is empty' },
        ]

/** A sensible first condition on `source`: its first option, or "is ticked", or "is filled in". */
function startCondition(source: FormField): Condition {
  if (source.widget === 'checkbox') return { field: source.key, op: 'equals', value: 'true' }
  if (source.options?.length) return { field: source.key, op: 'equals', value: source.options[0].value }
  return { field: source.key, op: 'filled' }
}

function Visibility({ form, field, set }: { form: Form; field: FormField; set: (patch: Partial<FormField>) => void }) {
  const others = usableFields(form).filter((f) => f.id !== field.id)
  const c = field.showWhen
  const source = c ? others.find((f) => f.key === c.field) : undefined
  // prefer a choice to depend on: that's what conditions usually hang off
  const first = others.find((f) => f.widget === 'radio' || f.widget === 'select' || f.widget === 'checkbox') ?? others[0]
  const opValue = c ? (source?.widget === 'checkbox' && c.op === 'equals' ? `equals:${c.value}` : c.op) : ''

  return (
    <Group title="When it shows">
      <Segmented
        label="When it shows"
        value={c ? 'when' : 'always'}
        onChange={(v) => set({ showWhen: v === 'when' && first ? startCondition(first) : undefined })}
        options={[
          { value: 'always', label: 'Always' },
          { value: 'when', label: 'Only when…', title: others.length ? undefined : 'Add another field first' },
        ]}
        className="w-full"
      />
      {!others.length ? <p className="text-[12px] text-ink-3">Add another field for this one to depend on.</p> : null}
      {c && others.length ? (
        <>
          <Labeled label="Field">
            <Select value={c.field} onChange={(e) => set({ showWhen: startCondition(others.find((f) => f.key === e.target.value)!) })}>
              {source ? null : <option value={c.field}>{c.field || 'Pick a field'} (missing)</option>}
              {others.map((f) => (
                <option key={f.id} value={f.key}>
                  {f.label || f.key}
                </option>
              ))}
            </Select>
          </Labeled>
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-1.5">
            <Labeled label="Condition">
              <Select
                value={opValue}
                onChange={(e) => {
                  const [op, value] = e.target.value.split(':') as [Condition['op'], string | undefined]
                  const keep = c.op === 'equals' || c.op === 'not-equals' ? c.value : undefined
                  set({ showWhen: { field: c.field, op, value: value ?? (op === 'equals' || op === 'not-equals' ? (keep ?? source?.options?.[0]?.value ?? '') : undefined) } })
                }}
              >
                {OP_LABEL(source).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Labeled>
            {(c.op === 'equals' || c.op === 'not-equals') && source?.widget !== 'checkbox' ? (
              <Labeled label="Value">
                {source?.options ? (
                  <Select value={c.value ?? ''} onChange={(e) => set({ showWhen: { ...c, value: e.target.value } })}>
                    {source.options.some((o) => o.value === c.value) ? null : <option value={c.value ?? ''}>{c.value || 'Pick one'}</option>}
                    {source.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label || o.value}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput value={c.value ?? ''} onChange={(e) => set({ showWhen: { ...c, value: e.target.value } })} inputMode={source?.widget === 'number' ? 'decimal' : undefined} />
                )}
              </Labeled>
            ) : null}
          </div>
          <p className="text-[12px] text-ink-3">
            Shows when {source?.label || c.field} {conditionText(c, source)}. While it’s hidden it isn’t checked or sent{field.required ? ', and it’s only required when it shows' : ''}.
          </p>
        </>
      ) : null}
    </Group>
  )
}

function FieldSettings({ form, field, change, problems, onDuplicate, onRemove }: { form: Form; field: FormField; change: Change; problems: string[]; onDuplicate: () => void; onRemove: () => void }) {
  const set = (patch: Partial<FormField>) => change((f) => updateItem(f, field.id, patch))
  const otherKeys = fieldsOf(form)
    .filter((f) => f.id !== field.id)
    .map((f) => f.key)
  const m = messagesOf(field)
  const unit = ruleUnit(field.widget)
  const setRules = (patch: Partial<FieldRules>) => set({ rules: { ...field.rules, ...patch } })
  const setMessages = (patch: Partial<FieldMessages>) => set({ messages: { ...field.messages, ...patch } })
  // the key follows the label while it still matches it (`gstNumber` for "GST number")
  const keyFollows = !field.key.includes('.') && (field.key === keyFromLabel(field.label) || field.key.replace(/\d+$/, '') === keyFromLabel(field.label))
  const hasFormat = (field.widget === 'text' && (field.inputType === 'email' || field.inputType === 'url')) || field.widget === 'date' || (field.widget === 'number' && field.integer)

  return (
    <>
      {problems.length ? (
        <div role="alert" className="m-3 mb-0 space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          {problems.map((p) => (
            <p key={p} className="flex gap-1.5">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              {p}
            </p>
          ))}
        </div>
      ) : null}

      <Group
        title="Field"
        aside={
          <div className="flex items-center gap-0.5">
            <Button size="sm" onClick={onDuplicate}>
              <Copy size={13} />
              Duplicate
            </Button>
            <Button size="sm" onClick={onRemove}>
              <Trash2 size={13} />
              Delete
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <Labeled label="Kind">
            <Select value={field.widget} onChange={(e) => change((f) => updateItem(f, field.id, withWidget(field, e.target.value as Widget)))}>
              {WIDGETS.map((w) => (
                <option key={w.widget} value={w.widget}>
                  {w.label}
                </option>
              ))}
            </Select>
          </Labeled>
          {field.widget === 'text' ? (
            <Labeled label="Holds">
              <Select value={field.inputType ?? 'text'} onChange={(e) => set({ inputType: e.target.value === 'text' ? undefined : (e.target.value as TextKind) })}>
                {TEXT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Labeled>
          ) : null}
        </div>
        <Labeled label="Label">
          <TextInput
            value={field.label}
            onChange={(e) => {
              const label = e.target.value
              change((f) => {
                const next = updateItem(f, field.id, { label })
                return keyFollows && label.trim() ? renameKey(next, field.id, uniqueKey(keyFromLabel(label), otherKeys)) : next
              })
            }}
          />
        </Labeled>
        <Labeled label="Key" hint={keyFollows ? 'Follows the label until you change it. Use dots to nest: address.city.' : 'Use dots to nest: address.city.'}>
          <TextInput
            value={field.key}
            aria-invalid={isValidKey(field.key) ? undefined : true}
            onChange={(e) => change((f) => renameKey(f, field.id, e.target.value.trim()))}
            className={cx('font-mono', !isValidKey(field.key) && 'border-danger')}
          />
        </Labeled>
        {field.widget === 'text' || field.widget === 'textarea' || field.widget === 'number' || field.widget === 'select' ? (
          <Labeled label={field.widget === 'select' ? 'Text before a choice is made' : 'Placeholder'}>
            <TextInput value={field.placeholder ?? ''} onChange={(e) => set({ placeholder: e.target.value || undefined })} placeholder={field.widget === 'select' ? 'Choose…' : undefined} />
          </Labeled>
        ) : null}
        <Labeled label="Help text" hint="A hint shown under the field.">
          <TextInput value={field.help ?? ''} onChange={(e) => set({ help: e.target.value || undefined })} />
        </Labeled>
        {field.widget === 'number' ? <Checkbox label="Whole numbers only" checked={Boolean(field.integer)} onChange={(v) => set({ integer: v || undefined })} /> : null}
        {field.widget === 'date' ? <Checkbox label="Include a time" checked={Boolean(field.withTime)} onChange={(v) => set({ withTime: v || undefined })} /> : null}
        {field.widget === 'file' ? (
          <>
            <Labeled label="Accepted types" hint="As in the accept attribute: image/*, .pdf">
              <TextInput value={field.accept ?? ''} onChange={(e) => set({ accept: e.target.value || undefined })} placeholder="Any file" className="font-mono" />
            </Labeled>
            <Checkbox label="Allow several files" checked={Boolean(field.multiple)} onChange={(v) => set({ multiple: v || undefined })} />
          </>
        ) : null}
      </Group>

      {field.widget === 'select' || field.widget === 'radio' ? (
        <Group title="Options">
          <OptionsEditor options={field.options ?? []} onChange={(options) => set({ options })} />
        </Group>
      ) : null}

      <Group title="Validation">
        <div className="space-y-1.5">
          <Checkbox label={field.widget === 'checkbox' ? 'Must be ticked' : 'Required'} checked={field.required} onChange={(required) => set({ required })} />
          {field.required ? (
            <TextInput aria-label="Message when it’s left empty" value={field.messages.required ?? ''} placeholder={m.required} onChange={(e) => setMessages({ required: e.target.value || undefined })} className="w-full" />
          ) : null}
        </div>
        {unit === 'characters' || unit === 'value' ? (
          <>
            <RuleRow
              label={unit === 'characters' ? 'Min length' : 'Min'}
              value={field.rules.min}
              onValue={(min) => setRules({ min })}
              message={field.messages.min}
              placeholder={m.min}
              onMessage={(min) => setMessages({ min })}
              min={unit === 'characters' ? 0 : undefined}
            />
            <RuleRow
              label={unit === 'characters' ? 'Max length' : 'Max'}
              value={field.rules.max}
              onValue={(max) => setRules({ max })}
              message={field.messages.max}
              placeholder={m.max}
              onMessage={(max) => setMessages({ max })}
              min={unit === 'characters' ? 1 : undefined}
            />
          </>
        ) : null}
        {unit === 'megabytes' ? (
          <RuleRow label="Max MB" value={field.rules.max} onValue={(max) => setRules({ max })} message={field.messages.max} placeholder={m.max} onMessage={(max) => setMessages({ max })} min={0} />
        ) : null}
        {unit === 'characters' ? (
          <div className="space-y-1.5">
            <Labeled label="Pattern" hint="A regular expression. Add ^ and $ to match the whole value.">
              <TextInput value={field.rules.pattern ?? ''} onChange={(e) => setRules({ pattern: e.target.value || undefined })} placeholder="^\d{6}$" className="font-mono" />
            </Labeled>
            {field.rules.pattern ? (
              <TextInput aria-label="Message when the pattern doesn’t match" value={field.messages.pattern ?? ''} placeholder={m.pattern} onChange={(e) => setMessages({ pattern: e.target.value || undefined })} className="w-full" />
            ) : null}
          </div>
        ) : null}
        {hasFormat ? (
          <Labeled label={field.widget === 'number' ? 'Message for a decimal' : 'Message for an invalid value'}>
            <TextInput value={field.messages.format ?? ''} placeholder={m.format} onChange={(e) => setMessages({ format: e.target.value || undefined })} />
          </Labeled>
        ) : null}
      </Group>

      <Visibility form={form} field={field} set={set} />
    </>
  )
}

/* ---------- the panel ---------- */

export function Inspector({
  form,
  item,
  problems,
  change,
  onDuplicate,
  onRemove,
  onDeleteForm,
}: {
  form: Form
  item: FormItem | null
  problems: string[]
  change: Change
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onDeleteForm: () => void
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
      {!item ? (
        <FormSettings form={form} change={change} onDeleteForm={onDeleteForm} />
      ) : item.kind === 'field' ? (
        <FieldSettings key={item.id} form={form} field={item} change={change} problems={problems} onDuplicate={() => onDuplicate(item.id)} onRemove={() => onRemove(item.id)} />
      ) : (
        <MarkerSettings key={item.id} item={item} change={change} onRemove={() => onRemove(item.id)} />
      )}
    </div>
  )
}
