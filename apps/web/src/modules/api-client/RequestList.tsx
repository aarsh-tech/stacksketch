import { useMemo, useState } from 'react'
import { ChevronRight, Copy, Search, SlidersHorizontal, Trash2 } from 'lucide-react'

import type { ApiRequest, Environment } from '@stacksketch/core'
import { Method } from '@/components/Method'
import { IconButton, Select, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import type { Exchange } from '@/store/client'
import { statusTone } from './lib'

/** The saved requests, grouped by folder, with the environment picker on top. */
export function RequestList({
  requests,
  selected,
  onSelect,
  onDuplicate,
  onRemove,
  environments,
  envId,
  onPickEnv,
  onEditEnvs,
  lastByRequest,
}: {
  requests: ApiRequest[]
  selected: string | null
  onSelect: (id: string) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  environments: Environment[]
  envId: string | null
  onPickEnv: (id: string | null) => void
  onEditEnvs: () => void
  lastByRequest: Map<string, Exchange>
}) {
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const shown = q ? requests.filter((r) => `${r.method} ${r.name} ${r.url} ${r.folder}`.toLowerCase().includes(q)) : requests
    const map = new Map<string, ApiRequest[]>()
    for (const r of shown) map.set(r.folder, [...(map.get(r.folder) ?? []), r])
    // loose requests first, then folders by name
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [requests, query])

  const toggle = (folder: string) =>
    setClosed((s) => {
      const next = new Set(s)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line p-2.5">
        <div className="flex items-center gap-1">
          <Select aria-label="Environment" value={envId ?? ''} onChange={(e) => onPickEnv(e.target.value || null)} className="h-8 min-w-0 flex-1">
            <option value="">No environment</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <IconButton label="Edit environments and variables" onClick={onEditEnvs}>
            <SlidersHorizontal size={15} />
          </IconButton>
        </div>
        <label className="relative block">
          <span className="sr-only">Find a request</span>
          <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a request" className={cx(inputClass, 'h-8 w-full pl-7')} />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-thin">
        {groups.length === 0 ? <p className="px-3 py-6 text-center text-[12.5px] text-ink-3">{requests.length ? 'Nothing matches.' : 'No requests yet.'}</p> : null}
        {groups.map(([folder, list]) => {
          const open = !closed.has(folder) || Boolean(query.trim())
          return (
            <div key={folder || '(none)'} className="mb-1">
              {folder ? (
                <button
                  type="button"
                  onClick={() => toggle(folder)}
                  aria-expanded={open}
                  className="flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left text-[12px] font-semibold text-ink-2 hover:bg-hover"
                >
                  <ChevronRight size={13} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{folder}</span>
                  <span className="font-normal text-ink-3">{list.length}</span>
                </button>
              ) : null}
              {open ? (
                <ul className={cx('space-y-px', folder && 'ml-2')}>
                  {list.map((r) => {
                    const last = lastByRequest.get(r.id)
                    const active = r.id === selected
                    return (
                      <li key={r.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => onSelect(r.id)}
                          aria-current={active ? 'true' : undefined}
                          className={cx('flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left', active ? 'bg-accent-soft' : 'hover:bg-hover')}
                        >
                          <Method method={r.method} className="w-12" />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.name || r.url || 'Untitled'}</span>
                          {last ? (
                            // the duplicate and delete buttons take this spot on hover
                            <span className="group-focus-within:invisible group-hover:invisible">
                            {last.result.ok ? (
                              <span
                                className={cx('font-mono text-[10.5px]', last.assertions.some((a) => !a.pass) ? 'text-danger' : statusTone(last.result.status))}
                                title={last.assertions.length ? `${last.assertions.filter((a) => a.pass).length} of ${last.assertions.length} checks passed` : undefined}
                              >
                                {last.result.status}
                              </span>
                            ) : (
                              <span className="font-mono text-[10.5px] text-danger">err</span>
                            )}
                            </span>
                          ) : null}
                        </button>
                        <span className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center group-focus-within:flex group-hover:flex">
                          <IconButton label={`Duplicate ${r.name}`} className="size-6" onClick={() => onDuplicate(r.id)}>
                            <Copy size={12} />
                          </IconButton>
                          <IconButton label={`Delete ${r.name}`} className="size-6" onClick={() => onRemove(r.id)}>
                            <Trash2 size={12} />
                          </IconButton>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
