import { Trash2 } from 'lucide-react'

import type { KeyValue } from '@stacksketch/core'
import { IconButton, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'

/**
 * Rows of key and value with a tick to send them. There's always an empty row
 * at the end: typing in it adds a row.
 */
export function KeyValueTable({
  rows,
  onChange,
  keyLabel = 'Key',
  valueLabel = 'Value',
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  suggestions,
  secret,
}: {
  rows: KeyValue[]
  onChange: (rows: KeyValue[]) => void
  keyLabel?: string
  valueLabel?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** for header names: a datalist of the common ones */
  suggestions?: string[]
  /** hide values whose key looks like a secret until focused */
  secret?: boolean
}) {
  const all = [...rows, { key: '', value: '', enabled: true }]
  const listId = suggestions ? `kv-suggest-${keyLabel.replace(/\W/g, '')}` : undefined
  const edit = (i: number, patch: Partial<KeyValue>) => {
    if (i === rows.length) onChange([...rows, { key: '', value: '', enabled: true, ...patch }])
    else onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }
  return (
    <div role="table" aria-label={`${keyLabel}s and ${valueLabel.toLowerCase()}s`} className="text-[12.5px]">
      <div role="row" className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1.4fr)_32px] items-center gap-1.5 px-0.5 pb-1 text-[11.5px] font-medium text-ink-3">
        <span role="columnheader" className="sr-only">
          Send
        </span>
        <span role="columnheader">{keyLabel}</span>
        <span role="columnheader">{valueLabel}</span>
        <span role="columnheader" className="sr-only">
          Remove
        </span>
      </div>
      {all.map((r, i) => {
        const last = i === rows.length
        const hidden = secret && /token|secret|password|key|auth/i.test(r.key)
        return (
          <div role="row" key={i} className="grid grid-cols-[22px_minmax(0,1fr)_minmax(0,1.4fr)_32px] items-center gap-1.5 py-0.5">
            <span role="cell" className="flex justify-center">
              {last ? null : (
                <input
                  type="checkbox"
                  aria-label={`Send ${r.key || 'this row'}`}
                  checked={r.enabled}
                  onChange={(e) => edit(i, { enabled: e.target.checked })}
                  className="size-3.5 accent-[var(--c-accent)]"
                />
              )}
            </span>
            <span role="cell">
              <input
                aria-label={`${keyLabel} ${i + 1}`}
                value={r.key}
                list={listId}
                placeholder={last ? `Add ${keyLabel.toLowerCase()}` : keyPlaceholder}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => edit(i, { key: e.target.value })}
                className={cx(inputClass, 'w-full font-mono', !r.enabled && !last && 'text-ink-3 line-through')}
              />
            </span>
            <span role="cell">
              <input
                aria-label={`${valueLabel} ${i + 1}`}
                value={r.value}
                type={hidden ? 'password' : 'text'}
                placeholder={last ? '' : valuePlaceholder}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => hidden && (e.currentTarget.type = 'text')}
                onBlur={(e) => hidden && (e.currentTarget.type = 'password')}
                onChange={(e) => edit(i, { value: e.target.value })}
                className={cx(inputClass, 'w-full font-mono', !r.enabled && !last && 'text-ink-3')}
              />
            </span>
            <span role="cell">
              {last ? null : (
                <IconButton label={`Remove ${r.key || 'this row'}`} className="size-7" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </IconButton>
              )}
            </span>
          </div>
        )
      })}
      {listId ? (
        <datalist id={listId}>
          {suggestions?.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}
