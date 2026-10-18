import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { refsOf, rootTypeName } from '@stacksketch/core'
import type { Field, ObjectType, Schema, Shape } from '@stacksketch/core'
import { cx } from '@/lib/cx'

/** A shape as coloured text: `Order[]`, `string | null`, `integer`. */
export function ShapeLabel({ shape }: { shape: Shape }): ReactNode {
  switch (shape.kind) {
    case 'string':
      return <span className="text-t-string">string</span>
    case 'number':
      return <span className="text-t-number">{shape.integer ? 'integer' : 'number'}</span>
    case 'boolean':
      return <span className="text-t-boolean">boolean</span>
    case 'null':
      return <span className="text-t-null">null</span>
    case 'unknown':
      return <span className="text-t-null">unknown</span>
    case 'ref':
      return <span className="font-medium text-t-ref">{shape.name}</span>
    case 'array':
      return (
        <>
          {shape.items.kind === 'union' ? <span className="text-ink-3">(</span> : null}
          <ShapeLabel shape={shape.items} />
          {shape.items.kind === 'union' ? <span className="text-ink-3">)</span> : null}
          <span className="text-ink-3">[]</span>
        </>
      )
    case 'union':
      return shape.options.map((o, i) => (
        <span key={i}>
          {i > 0 ? <span className="text-ink-3"> | </span> : null}
          <ShapeLabel shape={o} />
        </span>
      ))
  }
}

function formatOf(shape: Shape): string | undefined {
  if (shape.kind === 'string') return shape.format
  if (shape.kind === 'union' || shape.kind === 'array') return (shape.kind === 'array' ? [shape.items] : shape.options).map(formatOf).find(Boolean)
  return undefined
}

function examplesOf(shape: Shape): string | undefined {
  if (shape.kind === 'string' && shape.examples?.length) return `e.g. ${shape.examples.slice(0, 4).join(', ')}`
  if (shape.kind === 'number' && shape.min !== undefined && shape.max !== undefined)
    return shape.min === shape.max ? `e.g. ${shape.min}` : `from ${shape.min} to ${shape.max}`
  if (shape.kind === 'union') return shape.options.map(examplesOf).find(Boolean)
  return undefined
}

function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <span
      className={cx(
        'rounded px-1 py-px font-mono text-[10.5px] leading-none',
        tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-hover text-ink-3',
      )}
    >
      {children}
    </span>
  )
}

interface TreeCtx {
  types: Map<string, ObjectType>
  /** default open state below the first level */
  openAll: boolean
}

function FieldRow({ field, depth, ctx, trail }: { field: Field; depth: number; ctx: TreeCtx; trail: string[] }) {
  const refs = refsOf(field.shape).filter((r) => !trail.includes(r))
  const [open, setOpen] = useState(ctx.openAll || depth < 2)
  const nullable = field.shape.kind === 'union' && field.shape.options.some((o) => o.kind === 'null')
  const format = formatOf(field.shape)
  const hint = examplesOf(field.shape)
  const expandable = refs.length > 0

  const row = (
    <>
      <span className="flex w-3.5 shrink-0 justify-center text-ink-3">
        {expandable ? <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} /> : null}
      </span>
      <span className="font-mono text-[12.5px] text-ink">
        {field.key}
        {field.optional ? <span className="text-warn">?</span> : null}
      </span>
      <span className="font-mono text-[12px]">
        <ShapeLabel shape={field.shape} />
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
        {format ? <Chip>{format}</Chip> : null}
        {field.optional ? <Chip tone="warn">optional</Chip> : null}
        {nullable ? <Chip>nullable</Chip> : null}
      </span>
    </>
  )

  return (
    <li>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          title={hint}
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left hover:bg-hover"
          style={{ paddingLeft: depth * 16 + 4 }}
        >
          {row}
        </button>
      ) : (
        <div title={hint} className="flex h-7 min-w-0 items-center gap-2 rounded-md pr-2" style={{ paddingLeft: depth * 16 + 4 }}>
          {row}
        </div>
      )}
      {expandable && open
        ? refs.map((r) => {
            const type = ctx.types.get(r)
            return type ? <Fields key={r} type={type} depth={depth + 1} ctx={ctx} trail={[...trail, r]} /> : null
          })
        : null}
    </li>
  )
}

function Fields({ type, depth, ctx, trail }: { type: ObjectType; depth: number; ctx: TreeCtx; trail: string[] }) {
  if (!type.fields.length)
    return (
      <p className="h-7 font-mono text-[12px] leading-7 text-ink-3" style={{ paddingLeft: depth * 16 + 26 }}>
        empty object
      </p>
    )
  return (
    <ul className="relative">
      {depth > 0 ? <span aria-hidden className="absolute top-0 bottom-1 w-px bg-line" style={{ left: depth * 16 - 2 }} /> : null}
      {type.fields.map((f) => (
        <FieldRow key={f.key} field={f} depth={depth} ctx={ctx} trail={trail} />
      ))}
    </ul>
  )
}

export function StructureTree({ schema, openAll }: { schema: Schema; openAll: boolean }) {
  const ctx: TreeCtx = { types: new Map(schema.types.map((t) => [t.name, t])), openAll }
  const rootRefs = refsOf(schema.root)
  return (
    <div className="px-2 py-2">
      <div className="mb-1 flex h-7 items-center gap-2 px-1">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent">root</span>
        <span className="font-mono text-[12.5px] font-medium">{rootTypeName(schema)}</span>
        {schema.root.kind !== 'ref' ? (
          <span className="font-mono text-[12px]">
            <span className="text-ink-3">= </span>
            <ShapeLabel shape={schema.root} />
          </span>
        ) : null}
      </div>
      {rootRefs.map((r) => {
        const type = ctx.types.get(r)
        return type ? <Fields key={r} type={type} depth={0} ctx={ctx} trail={[r]} /> : null
      })}
    </div>
  )
}
