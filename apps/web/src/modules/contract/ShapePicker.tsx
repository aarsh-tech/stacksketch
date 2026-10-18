import { useState } from 'react'

import { shapeFromParts, shapeLabel, shapeParts } from '@stacksketch/core'
import type { ScalarKind, Shape, ShapeParts } from '@stacksketch/core'
import { Button, Checkbox, Select, TextInput } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'

const SCALARS: { value: ScalarKind; label: string }[] = [
  { value: 'string', label: 'string' },
  { value: 'email', label: 'string · email' },
  { value: 'uuid', label: 'string · uuid' },
  { value: 'uri', label: 'string · uri' },
  { value: 'date-time', label: 'string · date-time' },
  { value: 'date', label: 'string · date' },
  { value: 'enum', label: 'enum' },
  { value: 'integer', label: 'integer' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'unknown', label: 'any value' },
]

const NONE = 'none'
const encode = (base: ShapeParts['base']) => (typeof base === 'string' ? base : `type:${base.ref}`)
const decode = (value: string): ShapeParts['base'] => (value.startsWith('type:') ? { ref: value.slice(5) } : (value as ScalarKind))

/** The values a new enum starts with: the samples a string had, or one to replace. */
function enumSeed(shape: Shape | undefined): string[] {
  const leaf = shape?.kind === 'array' ? shape.items : shape
  const examples = leaf?.kind === 'string' ? [...new Set(leaf.examples ?? [])].slice(0, 12) : []
  return examples.length ? examples : ['value']
}

/** Comma-separated enum values. Keeps its own text so a trailing comma can be typed. */
function EnumValues({ values, onChange, label }: { values: string[]; onChange: (v: string[]) => void; label: string }) {
  const [text, setText] = useState(values.join(', '))
  return (
    <TextInput
      aria-label={label}
      value={text}
      placeholder="pending, shipped, delivered"
      onChange={(e) => {
        setText(e.target.value)
        const next = [...new Set(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))]
        // an enum needs a value: while the box is empty, keep the last ones
        if (next.length) onChange(next)
      }}
      className="w-full font-mono"
    />
  )
}

/**
 * Pick a shape: a value kind or one of the contract's types, optionally a
 * list and optionally null. With `noneLabel` it can also be nothing (no body).
 */
export function ShapePicker({
  shape,
  onChange,
  types,
  label,
  allowTypes = true,
  allowList = true,
  allowNull = true,
  noneLabel,
  className,
}: {
  shape: Shape | undefined
  onChange: (s: Shape | undefined) => void
  types: string[]
  label: string
  allowTypes?: boolean
  allowList?: boolean
  allowNull?: boolean
  noneLabel?: string
  className?: string
}) {
  const parts = shape ? shapeParts(shape) : null
  if (shape && !parts)
    return (
      <div className={cx('flex min-w-0 items-center gap-2', className)}>
        <span className="truncate font-mono text-[12px] text-ink-2" title={shapeLabel(shape)}>
          {shapeLabel(shape)}
        </span>
        <Button variant="outline" size="sm" onClick={() => onChange({ kind: 'string' })} title="This mix of kinds can't be edited here. Start again from a string.">
          Change
        </Button>
      </div>
    )

  const current = parts ? encode(parts.base) : NONE
  const missing = parts && typeof parts.base !== 'string' && !types.includes(parts.base.ref) ? parts.base.ref : null
  const change = (patch: Partial<ShapeParts>) => {
    const base: ShapeParts = parts ?? { base: 'string', list: false, nullable: false, values: [] }
    onChange(shapeFromParts({ ...base, ...patch }, shape))
  }

  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Select
          aria-label={label}
          value={current}
          onChange={(e) => {
            if (e.target.value === NONE) return onChange(undefined)
            const base = decode(e.target.value)
            change({ base, values: base === 'enum' ? enumSeed(shape) : [] })
          }}
          className={cx('min-w-0 flex-1 font-mono', parts && typeof parts.base !== 'string' ? 'text-t-ref' : 'text-ink')}
        >
          {noneLabel ? <option value={NONE}>{noneLabel}</option> : null}
          <optgroup label="Values">
            {SCALARS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
          {allowTypes && (types.length || missing) ? (
            <optgroup label="Types">
              {types.map((t) => (
                <option key={t} value={`type:${t}`}>
                  {t}
                </option>
              ))}
              {missing ? <option value={`type:${missing}`}>{missing} (missing)</option> : null}
            </optgroup>
          ) : null}
        </Select>
        {parts && allowList ? <Checkbox label="List" checked={parts.list} onChange={(list) => change({ list })} /> : null}
        {parts && allowNull && parts.base !== 'unknown' ? <Checkbox label="Can be null" checked={parts.nullable} onChange={(nullable) => change({ nullable })} /> : null}
      </div>
      {parts?.base === 'enum' ? <EnumValues values={parts.values} onChange={(values) => change({ values })} label={`Values of ${label.toLowerCase()}`} /> : null}
    </div>
  )
}
