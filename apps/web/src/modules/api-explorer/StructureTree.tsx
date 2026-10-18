import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Pencil, Sparkles } from 'lucide-react'

import { editField, enumCandidate, fieldFormat, fieldNullable, fieldType, inferredName, pascalCase, refsOf, renameProblem, renameType, rootTypeName, sampleValues } from '@stacksketch/core'
import type { Field, FieldOverride, FieldType, ObjectType, Overrides, Schema, Shape, StringFormat } from '@stacksketch/core'
import { Button, Checkbox, Select, TextInput } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { useExplorer } from '@/store/explorer'

/** A shape as coloured text: `Order[]`, `string | null`, `integer`. */
export function ShapeLabel({ shape }: { shape: Shape }): ReactNode {
  switch (shape.kind) {
    case 'string':
      return <span className="text-t-string">string</span>
    case 'number':
      return <span className="text-t-number">{shape.integer ? 'integer' : 'number'}</span>
    case 'boolean':
      return <span className="text-t-boolean">boolean</span>
    case 'enum':
      return (
        <span className="text-t-string" title={shape.values.join(', ')}>
          enum
        </span>
      )
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
  if (shape.kind === 'enum') return `one of ${shape.values.join(', ')}`
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
  /** the schema as inferred, before edits: edits that match it are dropped */
  inferred: Schema
  /** the schema with edits applied: what the tree shows */
  schema: Schema
  types: Map<string, ObjectType>
  overrides: Overrides
  setOverrides: (o: Overrides) => void
  /** default open state below the first level */
  openAll: boolean
}

const TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'string', label: 'string' },
  { value: 'enum', label: 'enum' },
  { value: 'integer', label: 'integer' },
  { value: 'number', label: 'number (decimal)' },
  { value: 'boolean', label: 'boolean' },
  { value: 'unknown', label: 'unknown' },
]
const FORMATS: StringFormat[] = ['date-time', 'date', 'email', 'uuid', 'uri']

const splitValues = (text: string) => [...new Set(text.split(',').map((v) => v.trim()).filter(Boolean))]

/** The inline editor under a field row. Every control writes straight to the overrides. */
function FieldEditor({ typeName, field, ctx, onClose }: { typeName: string; field: Field; ctx: TreeCtx; onClose: () => void }) {
  const origin = inferredName(ctx.overrides, typeName)
  const base = ctx.inferred.types.find((t) => t.name === origin)?.fields.find((f) => f.key === field.key) ?? field
  const edited = Boolean(ctx.overrides.types[origin]?.fields?.[field.key])
  const type = fieldType(field.shape)
  const enumValues = field.shape.kind === 'enum' ? field.shape.values : field.shape.kind === 'union' ? (field.shape.options.find((o) => o.kind === 'enum')?.values ?? []) : []
  const refs = [...new Set(refsOf(field.shape))]
  const [valuesText, setValuesText] = useState(enumValues.join(', '))
  const [rename, setRename] = useState(refs[0] ?? '')
  const [renameError, setRenameError] = useState<string | null>(null)
  const id = `edit-${typeName}-${field.key}`.replace(/[^\w-]/g, '_')

  // an edit that puts a field back the way it was inferred is not an edit
  const patch = (p: FieldOverride) => {
    const clean: FieldOverride = { ...p }
    if ('optional' in p && p.optional === base.optional) clean.optional = undefined
    if ('nullable' in p && p.nullable === fieldNullable(base.shape)) clean.nullable = undefined
    if ('type' in p && p.type === fieldType(base.shape) && p.type !== 'enum') clean.type = undefined
    if ('format' in p && (p.format ?? undefined) === fieldFormat(base.shape)) clean.format = undefined
    ctx.setOverrides(editField(ctx.overrides, origin, field.key, clean))
  }

  const commitValues = () => {
    const values = splitValues(valuesText)
    if (!values.length) return setValuesText(enumValues.join(', '))
    patch({ type: 'enum', values })
    setValuesText(values.join(', '))
  }

  const commitRename = () => {
    const ref = refs[0]
    if (!ref || rename === ref) return setRenameError(null)
    const refOrigin = inferredName(ctx.overrides, ref)
    const problem = renameProblem(ctx.schema, ctx.overrides, refOrigin, rename)
    setRenameError(problem)
    if (problem) return
    const name = pascalCase(rename)
    setRename(name)
    ctx.setOverrides(renameType(ctx.overrides, refOrigin, name))
  }

  const label = 'flex flex-col gap-1 text-[11.5px] font-medium text-ink-3'
  return (
    <div
      role="group"
      aria-label={`Edit ${field.key}`}
      className="my-1 mr-1 rounded-lg border border-line-strong bg-raised p-3 shadow-pop"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          Type
          <Select
            value={type ?? ''}
            disabled={type === null}
            onChange={(e) => {
              const t = e.target.value as FieldType
              if (t === 'enum') {
                const values = enumValues.length ? enumValues : sampleValues(field.shape)
                setValuesText(values.join(', '))
                patch({ type: 'enum', values: values.length ? values : undefined })
              } else patch({ type: t, values: undefined })
            }}
            className="font-mono"
          >
            {type === null ? <option value="">{refs.length ? 'object' : 'mixed'}</option> : null}
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        {type === 'string' ? (
          <label className={label}>
            Format
            <Select value={fieldFormat(field.shape) ?? ''} onChange={(e) => patch({ format: (e.target.value || null) as StringFormat | null })} className="font-mono">
              <option value="">none</option>
              {FORMATS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </Select>
          </label>
        ) : null}
        <Checkbox label="Optional" checked={field.optional} onChange={(optional) => patch({ optional })} />
        <Checkbox label="Nullable" checked={fieldNullable(field.shape)} onChange={(nullable) => patch({ nullable })} />
      </div>

      {type === 'enum' ? (
        <label className={cx(label, 'mt-3')} htmlFor={`${id}-values`}>
          Values, separated by commas
          <TextInput
            id={`${id}-values`}
            value={valuesText}
            onChange={(e) => setValuesText(e.target.value)}
            onBlur={commitValues}
            onKeyDown={(e) => e.key === 'Enter' && commitValues()}
            className="w-full font-mono"
          />
        </label>
      ) : null}

      {refs.length === 1 ? (
        <label className={cx(label, 'mt-3')} htmlFor={`${id}-rename`}>
          Name of the type it holds
          <TextInput
            id={`${id}-rename`}
            value={rename}
            aria-invalid={renameError ? true : undefined}
            onChange={(e) => setRename(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => e.key === 'Enter' && commitRename()}
            className={cx('w-full max-w-64 font-mono', renameError && 'border-danger')}
          />
          {renameError ? <span className="font-normal text-danger">{renameError}</span> : null}
        </label>
      ) : null}
      {type === null && refs.length !== 1 ? (
        <p className="mt-2 text-[12px] text-ink-3">This field holds {refs.length ? 'several object types' : 'a mix of types'}, so its type can’t be changed here.</p>
      ) : null}

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5">
        {edited ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              ctx.setOverrides(editField(ctx.overrides, origin, field.key, null))
              setValuesText(sampleValues(base.shape).join(', '))
            }}
          >
            Undo my edits to {field.key}
          </Button>
        ) : (
          <span className="text-[11.5px] text-ink-3">Edits stay when you paste a new sample.</span>
        )}
        <Button size="sm" variant="outline" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}

function FieldRow({ typeName, field, depth, ctx, trail }: { typeName: string; field: Field; depth: number; ctx: TreeCtx; trail: string[] }) {
  const refs = refsOf(field.shape).filter((r) => !trail.includes(r))
  const [open, setOpen] = useState(ctx.openAll || depth < 2)
  const [editing, setEditing] = useState(false)
  const nullable = fieldNullable(field.shape) && field.shape.kind !== 'null'
  const format = formatOf(field.shape)
  const hint = examplesOf(field.shape)
  const expandable = refs.length > 0
  const origin = inferredName(ctx.overrides, typeName)
  const edited = Boolean(ctx.overrides.types[origin]?.fields?.[field.key])
  const candidate = field.shape.kind === 'enum' ? null : enumCandidate(field.key, field.shape)
  const indent = { paddingLeft: depth * 16 + 4 }

  const label = (
    <>
      <span className="flex w-3.5 shrink-0 justify-center text-ink-3">
        {expandable ? <ChevronRight size={13} className={cx('transition-transform', open && 'rotate-90')} /> : null}
      </span>
      <span className="font-mono text-[12.5px] text-ink">
        {field.key}
        {field.optional ? <span className="text-warn">?</span> : null}
      </span>
      <span className="truncate font-mono text-[12px]">
        <ShapeLabel shape={field.shape} />
      </span>
      {edited ? <span aria-label="edited" title="You edited this field" className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
    </>
  )

  return (
    <li>
      <div className="group flex h-7 min-w-0 items-center rounded-md pr-1 hover:bg-hover" title={hint}>
        {expandable ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left" style={indent}>
            {label}
          </button>
        ) : (
          <div className="flex h-full min-w-0 flex-1 items-center gap-2" style={indent}>
            {label}
          </div>
        )}
        <span className="flex shrink-0 items-center gap-1 pl-2">
          {candidate ? (
            <button
              type="button"
              title={`Make ${field.key} an enum of ${candidate.join(', ')}`}
              aria-label={`Make ${field.key} an enum of ${candidate.join(', ')}`}
              onClick={() => ctx.setOverrides(editField(ctx.overrides, origin, field.key, { type: 'enum', values: candidate }))}
              className="inline-flex items-center gap-0.5 rounded bg-accent-soft px-1 py-px font-mono text-[10.5px] leading-none text-accent hover:brightness-95"
            >
              <Sparkles size={10} />
              enum?
            </button>
          ) : null}
          {format ? <Chip>{format}</Chip> : null}
          {field.shape.kind === 'enum' ? <Chip>{field.shape.values.length} values</Chip> : null}
          {field.optional ? <Chip tone="warn">optional</Chip> : null}
          {nullable ? <Chip>nullable</Chip> : null}
          <button
            type="button"
            aria-label={`Edit ${field.key}`}
            aria-expanded={editing}
            title={`Edit ${field.key}`}
            onClick={() => setEditing((e) => !e)}
            className={cx(
              'inline-flex size-6 items-center justify-center rounded text-ink-3 hover:bg-line hover:text-ink focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
              editing && 'bg-line text-ink [@media(hover:hover)]:opacity-100',
            )}
          >
            <Pencil size={12} />
          </button>
        </span>
      </div>
      {editing ? (
        <div style={{ paddingLeft: depth * 16 + 22 }}>
          <FieldEditor typeName={typeName} field={field} ctx={ctx} onClose={() => setEditing(false)} />
        </div>
      ) : null}
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
        <FieldRow key={f.key} typeName={type.name} field={f} depth={depth} ctx={ctx} trail={trail} />
      ))}
    </ul>
  )
}

export function StructureTree({ inferred, schema, openAll }: { inferred: Schema; schema: Schema; openAll: boolean }) {
  const overrides = useExplorer((s) => s.overrides)
  const set = useExplorer((s) => s.set)
  const ctx: TreeCtx = {
    inferred,
    schema,
    types: new Map(schema.types.map((t) => [t.name, t])),
    overrides,
    setOverrides: (o) => set({ overrides: o }),
    openAll,
  }
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
