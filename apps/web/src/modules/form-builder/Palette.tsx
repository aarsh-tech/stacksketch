import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Braces, FileText, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { useForms } from '@/store/forms'
import { FromSchemaDialog } from './FromSchemaDialog'
import { LAYOUT_ITEMS, WIDGETS } from './widgets'

/** What a palette tile adds: a kind of field, or a section or step marker. */
export type NewItem = { kind: 'field'; widget: (typeof WIDGETS)[number]['widget'] } | { kind: 'section' | 'step' }

const newItemId = (n: NewItem) => `new:${n.kind === 'field' ? n.widget : n.kind}`

function Tile({ item, label, hint, icon: Icon, onAdd }: { item: NewItem; label: string; hint: string; icon: LucideIcon; onAdd: (n: NewItem) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: newItemId(item), data: { item, label } })
  // Enter and Space add the field rather than start a keyboard drag: keyboard users reorder on the canvas instead
  const { onKeyDown: _keyboardDrag, ...pointer } = listeners ?? {}
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...pointer}
      aria-roledescription={undefined}
      aria-describedby={undefined}
      title={`${hint}. Click to add, or drag onto the form.`}
      onClick={() => onAdd(item)}
      className={cx(
        'flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-raised px-2.5 text-left text-[12.5px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover',
        isDragging && 'opacity-50',
      )}
    >
      <Icon size={14} className="shrink-0 text-accent" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function FormList() {
  const forms = useForms((s) => s.forms)
  const active = useForms((s) => s.activeForm)
  const set = useForms((s) => s.set)
  return (
    <ul className="space-y-px" aria-label="Your forms">
      {forms.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            aria-current={f.id === active ? 'true' : undefined}
            onClick={() => set({ activeForm: f.id, selected: null })}
            className={cx(
              'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]',
              f.id === active ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            <FileText size={14} className={cx('shrink-0', f.id === active ? 'text-accent' : 'text-ink-3')} />
            <span className="flex-1 truncate">{f.title || f.name}</span>
            <span className="font-mono text-[10.5px] text-ink-3">{f.items.filter((i) => i.kind === 'field').length}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function Palette({ onAdd, onNewForm }: { onAdd: (n: NewItem) => void; onNewForm: () => void }) {
  const [fromSchema, setFromSchema] = useState(false)
  return (
    <div className="absolute inset-0 overflow-y-auto px-3 py-3 scrollbar-thin">
      <p className="px-1 pb-1.5 text-[11.5px] font-medium text-ink-3">Forms</p>
      <FormList />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={onNewForm}>
          <Plus size={13} />
          Blank form
        </Button>
        <Button variant="outline" size="sm" onClick={() => setFromSchema(true)} title="Start from a type in the API explorer, with its fields filled in">
          <Braces size={13} />
          From a type
        </Button>
      </div>
      {fromSchema ? <FromSchemaDialog onClose={() => setFromSchema(false)} /> : null}

      <p className="mt-5 px-1 pb-1.5 text-[11.5px] font-medium text-ink-3">Fields</p>
      <div className="grid grid-cols-2 gap-1.5">
        {WIDGETS.map((w) => (
          <Tile key={w.widget} item={{ kind: 'field', widget: w.widget }} label={w.label} hint={w.hint} icon={w.icon} onAdd={onAdd} />
        ))}
      </div>

      <p className="mt-5 px-1 pb-1.5 text-[11.5px] font-medium text-ink-3">Layout</p>
      <div className="grid grid-cols-2 gap-1.5">
        {LAYOUT_ITEMS.map((l) => (
          <Tile key={l.kind} item={{ kind: l.kind }} label={l.label} hint={l.hint} icon={l.icon} onAdd={onAdd} />
        ))}
      </div>
      <p className="mt-4 px-1 text-[11.5px] leading-snug text-ink-3">Click to add below the selected item, or drag onto the form. On the form, drag the handle or press Alt + ↑ / ↓ to move an item.</p>
    </div>
  )
}
