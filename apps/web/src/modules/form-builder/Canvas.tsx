import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar, ChevronDown, Copy, Eye, GripVertical, MousePointerClick, Paperclip, StepForward, Trash2, TriangleAlert } from 'lucide-react'

import { layoutOf } from '@stacksketch/core'
import type { Form, FormField, FormItem } from '@stacksketch/core'
import { cx } from '@/lib/cx'
import { showsWhen } from './widgets'

export const CANVAS_ID = 'canvas'

const box = 'flex h-9 w-full items-center rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-ink-3'

const TEXT_PLACEHOLDER: Record<string, string> = { email: 'name@example.com', url: 'https://', tel: '+91', password: '••••••••' }

/** What the field will look like, drawn but not usable. */
function FieldPreview({ field }: { field: FormField }) {
  switch (field.widget) {
    case 'text':
      return <div className={box}>{field.placeholder || TEXT_PLACEHOLDER[field.inputType ?? ''] || ''}</div>
    case 'textarea':
      return <div className={cx(box, 'h-16 items-start pt-2')}>{field.placeholder}</div>
    case 'number':
      return <div className={cx(box, 'font-mono')}>{field.placeholder || (field.integer ? '0' : '0.00')}</div>
    case 'select':
      return (
        <div className={cx(box, 'justify-between')}>
          <span className="truncate">{field.placeholder || 'Choose…'}</span>
          <ChevronDown size={15} className="shrink-0" />
        </div>
      )
    case 'radio': {
      const options = field.options ?? []
      return (
        <div className="space-y-1.5 pt-0.5">
          {options.slice(0, 5).map((o) => (
            <div key={o.value} className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="size-3.5 shrink-0 rounded-full border border-line-strong bg-panel" />
              <span className="truncate">{o.label || o.value}</span>
            </div>
          ))}
          {options.length > 5 ? <div className="pl-5.5 text-[12px] text-ink-3">and {options.length - 5} more</div> : null}
        </div>
      )
    }
    case 'checkbox':
      return null // drawn with its label, see FieldCard
    case 'date':
      return (
        <div className={cx(box, 'justify-between font-mono text-[12.5px]')}>
          {field.withTime ? 'dd / mm / yyyy, --:--' : 'dd / mm / yyyy'}
          <Calendar size={15} className="shrink-0" />
        </div>
      )
    case 'file':
      return (
        <div className="flex h-12 items-center justify-center gap-2 rounded-md border border-dashed border-line-strong bg-panel text-[13px] text-ink-3">
          <Paperclip size={14} />
          {field.multiple ? 'Choose files' : 'Choose a file'}
          {field.accept ? <span className="font-mono text-[11.5px]">{field.accept}</span> : null}
        </div>
      )
  }
}

function FieldCard({ field, form }: { field: FormField; form: Form }) {
  const condition = showsWhen(form, field)
  const label = (
    <span className="min-w-0 text-[13px] font-medium text-ink">
      {field.label || <span className="text-ink-3 italic">No label</span>}
      {field.required ? (
        <span className="text-danger" aria-label="required">
          {' '}
          *
        </span>
      ) : null}
    </span>
  )
  return (
    <>
      {field.widget === 'checkbox' ? (
        <div className="flex items-center gap-2 pr-16">
          <span className="size-4 shrink-0 rounded border border-line-strong bg-panel" />
          {label}
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 pr-16">{label}</div>
          <div className="mt-1.5">
            <FieldPreview field={field} />
          </div>
        </>
      )}
      {field.help ? <p className="mt-1 text-[12px] text-ink-3">{field.help}</p> : null}
      {condition ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-accent">
          <Eye size={12} className="shrink-0" />
          {condition}
        </p>
      ) : null}
    </>
  )
}

interface ItemProps {
  item: FormItem
  form: Form
  stepNumber: number
  selected: boolean
  problems: string[]
  onSelect: () => void
  onKeyDown: (e: KeyboardEvent) => void
  onDuplicate: () => void
  onRemove: () => void
}

function SortableItem({ item, form, stepNumber, selected, problems, onSelect, onKeyDown, onDuplicate, onRemove }: ItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const node = useRef<HTMLDivElement | null>(null)
  const name = item.kind === 'field' ? item.label || item.key || 'field' : item.title || item.kind

  // keep the picked item in view, e.g. right after it's added
  useEffect(() => {
    if (selected) node.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  const tools = 'inline-flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-line hover:text-ink'
  const reveal = selected ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100'

  let body: ReactNode
  if (item.kind === 'field') body = <FieldCard field={item} form={form} />
  else if (item.kind === 'section')
    body = (
      <div className="border-t border-line pt-3">
        <h3 className="pr-16 text-[15px] font-semibold tracking-[-0.01em] text-ink">{item.title || <span className="text-ink-3 italic">Untitled section</span>}</h3>
        {item.description ? <p className="mt-0.5 text-[12.5px] text-ink-2">{item.description}</p> : null}
      </div>
    )
  else
    body = (
      <div className="flex items-center gap-2.5 pr-16">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink">
          <StepForward size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Step {stepNumber}</p>
          <p className="truncate text-[14px] font-semibold text-ink">{item.title || 'Untitled step'}</p>
        </div>
      </div>
    )

  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        node.current = el
      }}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx(
        'group relative rounded-lg border py-2.5 pr-2 pl-8',
        item.kind === 'step' ? 'mt-3 bg-hover first:mt-0' : item.kind === 'section' ? 'mt-2' : '',
        selected ? 'border-accent bg-accent-soft/40' : 'border-transparent hover:border-line',
        isDragging && 'z-20 opacity-60 shadow-pop',
      )}
    >
      {/* the whole card picks the item; the handle and tools sit above it */}
      <button
        type="button"
        aria-label={`Edit ${name}`}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className="absolute inset-0 rounded-lg focus-visible:outline-offset-0"
      />
      <div className="pointer-events-none relative">{body}</div>
      {problems.length ? (
        <p className="pointer-events-none relative mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warn">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {problems[0]}
          {problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}
        </p>
      ) : null}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Move ${name}: press space, then the arrow keys`}
        title="Drag to move"
        className={cx('absolute top-2 left-1 z-10 inline-flex h-7 w-6 cursor-grab touch-none items-center justify-center rounded-md text-ink-3 hover:bg-line hover:text-ink active:cursor-grabbing', reveal)}
      >
        <GripVertical size={15} />
      </button>
      <div className={cx('absolute top-1.5 right-1.5 z-10 flex items-center', reveal)}>
        {item.kind === 'field' ? (
          <button type="button" className={tools} aria-label={`Duplicate ${name}`} title="Duplicate" onClick={onDuplicate}>
            <Copy size={14} />
          </button>
        ) : null}
        <button type="button" className={tools} aria-label={`Delete ${name}`} title="Delete" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

/** Where a field dragged in from the palette would land. */
function DropLine() {
  return <div aria-hidden className="mx-2 my-0.5 h-0.5 rounded-full bg-accent" />
}

export function Canvas({
  form,
  selected,
  dropIndex,
  problems,
  onSelect,
  onKeyDown,
  onDuplicate,
  onRemove,
}: {
  form: Form
  selected: string | null
  /** where a palette drag would insert, or null */
  dropIndex: number | null
  problems: Map<string, string[]>
  onSelect: (id: string | null) => void
  onKeyDown: (id: string, e: KeyboardEvent) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_ID })
  const steps = layoutOf(form)
  const multiStep = steps.length > 1
  // step numbers as the preview will count them: an untitled leading step is step 1
  let stepNo = steps[0]?.id === null ? 1 : 0

  return (
    <div className="paper-grid absolute inset-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-xl px-3 py-5 md:px-6 md:py-8">
        <div className="rounded-xl border border-line bg-raised shadow-pop">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={selected === null}
            className={cx('block w-full rounded-t-xl border-b px-5 pt-4 pb-3.5 text-left', selected === null ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-hover/60')}
          >
            <span className="block text-[18px] font-semibold tracking-[-0.02em] text-ink">{form.title || <span className="text-ink-3 italic">Untitled form</span>}</span>
            {form.description ? <span className="mt-1 block text-[13px] text-ink-2">{form.description}</span> : null}
            <span className="mt-1.5 block font-mono text-[11px] text-ink-3">
              {'<'}
              {form.name}
              {' />'}
              {multiStep ? ` · ${steps.length} steps` : ''}
            </span>
          </button>

          <div ref={setNodeRef} className={cx('min-h-40 p-3', isOver && dropIndex === null && 'bg-accent-soft/30')}>
            <SortableContext items={form.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {form.items.map((item, i) => {
                if (item.kind === 'step') stepNo++
                return (
                  <div key={item.id}>
                    {dropIndex === i ? <DropLine /> : null}
                    <SortableItem
                      item={item}
                      form={form}
                      stepNumber={stepNo}
                      selected={selected === item.id}
                      problems={problems.get(item.id) ?? []}
                      onSelect={() => onSelect(item.id)}
                      onKeyDown={(e) => onKeyDown(item.id, e)}
                      onDuplicate={() => onDuplicate(item.id)}
                      onRemove={() => onRemove(item.id)}
                    />
                  </div>
                )
              })}
            </SortableContext>
            {dropIndex !== null && dropIndex >= form.items.length && form.items.length ? <DropLine /> : null}
            {!form.items.length ? (
              <div
                className={cx(
                  'flex h-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-center text-[13px]',
                  dropIndex !== null ? 'border-accent bg-accent-soft/40 text-ink' : 'border-line-strong text-ink-3',
                )}
              >
                <MousePointerClick size={18} />
                Drag a field here, or click one in the list.
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            <span className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[13px] font-medium text-accent-ink">{form.submitLabel || 'Submit'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
