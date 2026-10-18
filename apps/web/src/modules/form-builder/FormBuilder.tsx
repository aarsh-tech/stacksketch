import { Suspense, lazy, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, CollisionDetection, DragEndEvent, DragMoveEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Check, Copy, Download, Eye, LayoutGrid, PencilRuler, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { createField, emptyForm, fieldsOf, formFileNames, formProblems, insertItem, moveItem, removeItem, toFormComponent, toFormZod, uniqueKey, usableFields } from '@stacksketch/core'
import type { Form, FormField, FormItem } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import { IconButton, Segmented, Tabs } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { activeFormOf, uid, useForms } from '@/store/forms'
import type { FormMobilePane, FormPanel, FormView } from '@/store/forms'
import { Canvas, CANVAS_ID } from './Canvas'
import { Inspector } from './Inspector'
import { Palette } from './Palette'
import type { NewItem } from './Palette'
import { widgetInfo } from './widgets'

// React Hook Form and Zod only load when the preview opens
const Preview = lazy(() => import('./Preview'))
const FormStates = lazy(() => import('./Preview').then((m) => ({ default: m.FormStates })))

/** A new item for a palette tile. Adding the first step also marks everything above it as step 1. */
function addItem(form: Form, n: NewItem, index: number): { form: Form; id: string } {
  const id = uid()
  if (n.kind === 'field') return { form: insertItem(form, createField(n.widget, id, form), index), id }
  if (n.kind === 'section') return { form: insertItem(form, { kind: 'section', id, title: 'New section' }, index), id }
  const steps = form.items.filter((i) => i.kind === 'step').length
  if (steps === 0 && index > 0 && form.items[0]?.kind !== 'step') {
    const withFirst = insertItem(form, { kind: 'step', id: uid(), title: 'Step 1' }, 0)
    return { form: insertItem(withFirst, { kind: 'step', id, title: 'Step 2' }, index + 1), id }
  }
  return { form: insertItem(form, { kind: 'step', id, title: `Step ${steps + 1}` }, index), id }
}

const itemName = (item: FormItem | undefined) => (!item ? 'item' : item.kind === 'field' ? item.label || item.key : item.title || item.kind)

/* ---------- code ---------- */

function CodePanel({ form, kind, code }: { form: Form; kind: 'zod' | 'react'; code: string }) {
  const left = fieldsOf(form).length - usableFields(form).length
  const files = formFileNames(form)
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[12.5px] text-ink-3">
        {left ? (
          <span className="flex items-center gap-1.5 text-warn">
            <TriangleAlert size={13} />
            {left} {left === 1 ? 'field is' : 'fields are'} left out until {left === 1 ? 'its key is' : 'their keys are'} fixed.
          </span>
        ) : kind === 'zod' ? (
          'Zod 4. Values not filled in are undefined; fields that only show sometimes are checked when they show.'
        ) : (
          <span>
            React Hook Form and Tailwind. Save it next to <span className="font-mono text-ink-2">{files.schema}</span>, then{' '}
            <span className="font-mono text-ink-2">pnpm add react-hook-form @hookform/resolvers zod</span>.
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <CodeView code={code} lang={kind === 'zod' ? 'ts' : 'tsx'} label={kind === 'zod' ? 'Generated Zod schema for the form' : 'Generated React component for the form'} />
        </div>
      </div>
    </div>
  )
}

/* ---------- the module ---------- */

export default function FormBuilder() {
  const form = useForms(activeFormOf)
  const forms = useForms((s) => s.forms)
  const selectedId = useForms((s) => s.selected)
  const panel = useForms((s) => s.panel)
  const view = useForms((s) => s.view)
  const mobilePane = useForms((s) => s.mobilePane)
  const set = useForms((s) => s.set)
  const update = useForms((s) => s.update)
  const addForm = useForms((s) => s.addForm)
  const removeForm = useForms((s) => s.removeForm)
  const restoreForm = useForms((s) => s.restoreForm)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState<{ id: UniqueIdentifier; label: string } | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const selected = form.items.find((i) => i.id === selectedId) ?? null
  const problems = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of formProblems(form)) map.set(p.itemId, [...(map.get(p.itemId) ?? []), p.message])
    return map
  }, [form])
  const zod = useMemo(() => toFormZod(form), [form])
  const component = useMemo(() => toFormComponent(form), [form])

  const select = (id: string | null) => set({ selected: id, panel: 'settings' })

  /* ----- editing ----- */

  const add = (n: NewItem, index?: number) => {
    const at = index ?? (selected ? form.items.indexOf(selected) + 1 : form.items.length)
    const { form: next, id } = addItem(form, n, at)
    update(() => next)
    set({ selected: id, panel: 'settings', view: 'edit', mobilePane: mobilePane === 'add' ? 'canvas' : mobilePane })
  }

  const duplicate = (id: string) => {
    const i = form.items.findIndex((x) => x.id === id)
    const item = form.items[i]
    if (item?.kind !== 'field') return
    const copy: FormField = { ...structuredClone(item), id: uid(), key: uniqueKey(item.key, fieldsOf(form).map((f) => f.key)) }
    update((f) => insertItem(f, copy, i + 1))
    select(copy.id)
  }

  const remove = (id: string) => {
    const before = form
    const item = form.items.find((x) => x.id === id)
    const i = form.items.indexOf(item!)
    update((f) => removeItem(f, id))
    set({ selected: selected?.id === id ? (form.items[i + 1]?.id ?? form.items[i - 1]?.id ?? null) : selectedId })
    toast.success(`Deleted ${itemName(item)}`, { action: { label: 'Undo', onClick: () => update(() => before) } })
  }

  const move = (id: string, by: number) => {
    const from = form.items.findIndex((x) => x.id === id)
    const to = Math.max(0, Math.min(form.items.length - 1, from + by))
    if (from !== to) update((f) => moveItem(f, from, to))
  }

  const onItemKey = (id: string, e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(id, e.key === 'ArrowUp' ? -1 : 1)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      remove(id)
    }
  }

  const newForm = () => {
    const names = forms.map((f) => f.name)
    addForm(emptyForm(uid(), uniqueKey('NewForm', names)))
    set({ mobilePane: 'canvas' })
  }

  const deleteForm = () => {
    const index = forms.findIndex((f) => f.id === form.id)
    const gone = form
    removeForm(form.id)
    toast.success(`Deleted ${gone.title || gone.name}`, { action: { label: 'Undo', onClick: () => restoreForm(gone, index) } })
  }

  /* ----- dragging ----- */

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const isNew = (id: UniqueIdentifier) => String(id).startsWith('new:')

  // palette drags land between items while the pointer is over the form; reorders snap to the nearest item
  const collision: CollisionDetection = (args) => {
    const items = args.droppableContainers.filter((c) => c.id !== CANVAS_ID)
    if (!isNew(args.active.id)) return closestCenter({ ...args, droppableContainers: items })
    const inCanvas = pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id === CANVAS_ID) })
    if (!inCanvas.length) return []
    return items.length ? closestCenter({ ...args, droppableContainers: items }) : inCanvas
  }

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { label?: string } | undefined
    setDragging({ id: e.active.id, label: data?.label ?? itemName(form.items.find((i) => i.id === e.active.id)) })
  }

  const onDragMove = (e: DragMoveEvent) => {
    if (!isNew(e.active.id)) return
    const over = e.over
    let index: number | null = null
    if (over?.id === CANVAS_ID) index = form.items.length
    else if (over) {
      const i = form.items.findIndex((x) => x.id === over.id)
      const rect = e.active.rect.current.translated
      const below = rect ? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2 : false
      index = i < 0 ? null : below ? i + 1 : i
    }
    if (index !== dropIndex) setDropIndex(index)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (isNew(active.id)) {
      const n = (active.data.current as { item: NewItem }).item
      if (dropIndex !== null) add(n, dropIndex)
    } else if (over && over.id !== active.id) {
      const from = form.items.findIndex((x) => x.id === active.id)
      const to = form.items.findIndex((x) => x.id === over.id)
      if (from >= 0 && to >= 0) update((f) => moveItem(f, from, to))
    }
    setDragging(null)
    setDropIndex(null)
  }

  const nameOf = (id: UniqueIdentifier) => (isNew(id) ? `a new ${String(id).slice(4)}` : itemName(form.items.find((i) => i.id === id)))
  const positionOf = (id: UniqueIdentifier) => `position ${form.items.findIndex((i) => i.id === id) + 1} of ${form.items.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over && over.id !== CANVAS_ID ? `${nameOf(active.id)} is over ${positionOf(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${nameOf(active.id)} at ${over.id === CANVAS_ID ? 'the end' : positionOf(over.id)}.` : `Put ${nameOf(active.id)} back.`),
    onDragCancel: ({ active }) => `Put ${nameOf(active.id)} back where it was.`,
  }

  /* ----- code ----- */

  const files = formFileNames(form)
  const output = panel === 'react' ? { code: component, file: files.component, what: 'the React component' } : { code: zod, file: files.schema, what: 'the Zod schema' }
  const copy = async () => {
    try {
      await copyText(output.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success(`Copied ${output.what}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the code and copy it by hand.' })
    }
  }

  const show = (pane: FormMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')
  const panelTabs: { value: FormPanel; label: string }[] = [
    { value: 'settings', label: selected ? (selected.kind === 'field' ? `${widgetInfo(selected.widget).label} field` : selected.kind === 'section' ? 'Section' : 'Step') : 'Form settings' },
    { value: 'zod', label: 'Zod' },
    { value: 'react', label: 'React' },
  ]
  const issueCount = [...problems.values()].reduce((n, p) => n + p.length, 0)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null)
        setDropIndex(null)
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
          <Segmented
            label="Pane"
            className="w-full max-w-md"
            value={mobilePane}
            onChange={(p) => set({ mobilePane: p })}
            options={[
              { value: 'add', label: 'Add' },
              { value: 'canvas', label: 'Form' },
              { value: 'panel', label: 'Settings' },
            ]}
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[16rem_minmax(0,1fr)_minmax(0,26rem)]">
          <section className={cx('relative min-h-0 min-w-0 flex-col bg-panel', show('add'), 'xl:flex')} aria-label="Forms and fields">
            <Palette onAdd={(n) => add(n)} onNewForm={newForm} />
          </section>

          <section className={cx('min-h-0 min-w-0 flex-col bg-canvas', show('canvas'), 'xl:flex')} aria-label="Form canvas">
            <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
              <Segmented<FormView>
                label="Canvas"
                value={view}
                onChange={(v) => set({ view: v })}
                options={[
                  { value: 'edit', label: <span className="flex items-center gap-1.5"><PencilRuler size={13} />Edit</span>, title: 'Arrange and set up the fields' },
                  { value: 'preview', label: <span className="flex items-center gap-1.5"><Eye size={13} />Preview</span>, title: 'Fill the form in to try its validation' },
                  { value: 'states', label: <span className="flex items-center gap-1.5"><LayoutGrid size={13} />States</span>, title: 'The form empty, filled in, with errors and submitting' },
                ]}
              />
              <span className="truncate text-[12px] text-ink-3 max-sm:hidden">
                {view === 'preview' ? 'Fill it in to try the checks. Nothing is sent anywhere.' : view === 'states' ? 'Empty, filled in, with errors and submitting.' : `${fieldsOf(form).length} ${fieldsOf(form).length === 1 ? 'field' : 'fields'}`}
              </span>
            </header>
            <div className="relative min-h-0 flex-1">
              {view === 'preview' ? (
                <Suspense fallback={<div className="paper-grid absolute inset-0" />}>
                  <Preview key={form.id} form={form} />
                </Suspense>
              ) : view === 'states' ? (
                <Suspense fallback={<div className="paper-grid absolute inset-0" />}>
                  <FormStates form={form} />
                </Suspense>
              ) : (
                <Canvas
                  form={form}
                  selected={selectedId}
                  dropIndex={dragging && isNew(dragging.id) ? dropIndex : null}
                  problems={problems}
                  onSelect={select}
                  onKeyDown={onItemKey}
                  onDuplicate={duplicate}
                  onRemove={remove}
                />
              )}
            </div>
          </section>

          <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('panel'), 'xl:flex')}>
            <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
              <div className="min-w-0 flex-1">
                <Tabs label="Panel" value={panel} onChange={(p) => set({ panel: p })} options={panelTabs} />
              </div>
              {issueCount ? (
                <span title={`${issueCount} ${issueCount === 1 ? 'problem' : 'problems'} to fix; they're marked on the form`} className="mr-1 flex items-center gap-1 text-[12px] text-warn">
                  <TriangleAlert size={13} />
                  {issueCount}
                </span>
              ) : null}
              <IconButton label={`Copy ${output.what}`} onClick={copy}>
                {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
              </IconButton>
              <IconButton label={`Download ${output.file}`} onClick={() => downloadText(output.file, output.code)}>
                <Download size={15} />
              </IconButton>
            </header>
            <div className="relative min-h-0 flex-1">
              {panel !== 'settings' ? (
                <CodePanel form={form} kind={panel} code={output.code} />
              ) : (
                <Inspector
                  form={form}
                  item={selected}
                  problems={selected ? (problems.get(selected.id) ?? []) : []}
                  change={update}
                  onDuplicate={duplicate}
                  onRemove={remove}
                  onDeleteForm={deleteForm}
                />
              )}
            </div>
          </section>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="inline-flex h-9 items-center rounded-md border border-accent bg-raised px-3 text-[12.5px] font-medium text-ink shadow-pop">{dragging.label}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
