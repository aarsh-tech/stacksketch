import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { toast } from 'sonner'

import { parseCurl, parseHar, pascalCase } from '@stacksketch/core'
import type { HarEntry, HttpMethod } from '@stacksketch/core'
import { Button, Checkbox, Dialog, Segmented } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { newSampleId, useExplorer } from '@/store/explorer'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('?')[0]
  }
}
const withoutQuery = (url: string) => url.split(/[?#]/)[0]
/** the path and query, which is what tells two calls to one endpoint apart */
const pathAndQuery = (url: string) => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

/** "OrdersResponse" from ".../v1/orders/:id": the last word of the path that isn't an id. */
function rootNameFor(url: string) {
  const words = pathOf(url)
    .split('/')
    .filter((p) => p && !/^\d+$|^[0-9a-f-]{16,}$|^v\d+$|^api$/i.test(p))
  return words.length ? `${pascalCase(words[words.length - 1])}Response` : null
}

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ---------- HAR ---------- */

function HarImport({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [har, setHar] = useState<{ name: string; entries: HarEntry[]; skipped: number } | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = async (f: File | undefined) => {
    if (!f) return
    try {
      const all = parseHar(await f.text())
      const entries = all.filter((e) => e.json)
      setHar({ name: f.name, entries, skipped: all.length - entries.length })
      // start with the successful responses of the endpoint that shows up most
      const counts = new Map<string, number>()
      for (const e of entries) if (e.status < 300) counts.set(pathOf(e.url), (counts.get(pathOf(e.url)) ?? 0) + 1)
      const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
      setPicked(new Set(entries.flatMap((e, i) => (pathOf(e.url) === top && e.status < 300 ? [i] : [])).slice(0, 10)))
      setError(entries.length ? null : 'This HAR file has no JSON responses in it. Was it saved with content? In DevTools, use Network → “Save all as HAR with content”.')
    } catch (e) {
      setHar(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const add = () => {
    if (!har) return
    const chosen = har.entries.filter((_, i) => picked.has(i))
    if (!chosen.length) return
    const fresh = chosen.map((e) => ({ id: newSampleId(), name: `${e.method} ${pathOf(e.url)}`, text: JSON.stringify(JSON.parse(e.text ?? 'null'), null, 2) }))
    const s = useExplorer.getState()
    const first = chosen[0]
    const sameEndpoint = chosen.every((e) => pathOf(e.url) === pathOf(first.url))
    s.set({
      samples: keep ? [...s.samples, ...fresh] : fresh,
      activeSample: fresh[0].id,
      ...(METHODS.includes(first.method as HttpMethod) ? { method: first.method as HttpMethod, url: withoutQuery(first.url) } : {}),
      ...(sameEndpoint && rootNameFor(first.url) ? { rootName: rootNameFor(first.url) as string } : {}),
    })
    toast.success(`Added ${fresh.length} ${fresh.length === 1 ? 'response' : 'responses'} from ${har.name}`, {
      description: fresh.length > 1 ? 'They’re merged into one schema, so keys missing from some become optional.' : undefined,
    })
    onDone()
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        In your browser’s DevTools, open Network, right-click a request and choose <span className="font-medium text-ink">Save all as HAR with content</span>. The file is read here, in your browser.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => file.current?.click()}>
          <FileUp size={14} />
          {har ? 'Choose another .har file' : 'Choose a .har file'}
        </Button>
        {har ? <span className="truncate text-[12.5px] text-ink-3">{har.name}</span> : null}
        <input
          ref={file}
          type="file"
          accept=".har,application/json"
          className="hidden"
          onChange={(e) => {
            void open(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
      {har?.entries.length ? (
        <>
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span>
              {har.entries.length} JSON {har.entries.length === 1 ? 'response' : 'responses'}
              {har.skipped ? ` · ${har.skipped} other ${har.skipped === 1 ? 'request' : 'requests'} hidden` : ''}
            </span>
            <button type="button" className="ml-auto font-medium text-accent hover:underline" onClick={() => setPicked(new Set(picked.size ? [] : har.entries.map((_, i) => i)))}>
              {picked.size ? 'Pick none' : 'Pick all'}
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line scrollbar-thin">
            {har.entries.map((e, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-hover">
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-[var(--c-accent)]"
                    checked={picked.has(i)}
                    onChange={(ev) => {
                      const next = new Set(picked)
                      if (ev.target.checked) next.add(i)
                      else next.delete(i)
                      setPicked(next)
                    }}
                  />
                  <span className="w-14 shrink-0 font-mono text-[11.5px] font-semibold text-ink-2">{e.method}</span>
                  <span className="min-w-0 flex-1 truncate font-mono" title={e.url}>
                    {pathAndQuery(e.url)}
                  </span>
                  <span className={cx('shrink-0 font-mono text-[11.5px]', e.status >= 400 ? 'text-danger' : 'text-ink-3')}>{e.status}</span>
                  <span className="w-16 shrink-0 text-right text-[11.5px] text-ink-3">{formatBytes(e.text?.length ?? 0)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox label="Keep the samples I already have" checked={keep} onChange={setKeep} />
            <Button variant="primary" className="ml-auto" disabled={!picked.size} onClick={add}>
              Add {picked.size || ''} {picked.size === 1 ? 'response' : 'responses'} as samples
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/* ---------- cURL ---------- */

function CurlImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const use = () => {
    try {
      const req = parseCurl(text)
      const method = METHODS.includes(req.method as HttpMethod) ? (req.method as HttpMethod) : 'GET'
      useExplorer.getState().set({ method, url: req.url, output: 'client' })
      toast.success(`Set up the client code for ${method} ${pathOf(req.url)}`, {
        description: 'A cURL command doesn’t include the response, so paste the response on the left. Nothing was sent.',
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-2">
        In DevTools, right-click a request and choose <span className="font-medium text-ink">Copy as cURL</span>. Stacksketch reads the method and URL for the fetch, Axios and TanStack Query code. It never sends the request.
      </p>
      <textarea
        aria-label="cURL command"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && use()}
        rows={7}
        spellCheck={false}
        placeholder={`curl 'https://api.example.com/v1/orders/42' \\\n  -H 'accept: application/json'`}
        className="w-full resize-y rounded-md border border-line-strong bg-raised px-2.5 py-2 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
      />
      {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!text.trim()} onClick={use}>
          Use this request
        </Button>
      </div>
    </div>
  )
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'har' | 'curl'>('har')
  return (
    <Dialog title="Import from your browser" onClose={onClose}>
      <Segmented
        label="What to import"
        className="mb-4 w-full max-w-sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'har', label: 'HAR file', title: 'Responses saved from DevTools' },
          { value: 'curl', label: 'cURL command', title: 'A request copied from DevTools' },
        ]}
      />
      {mode === 'har' ? <HarImport onDone={onClose} /> : <CurlImport onDone={onClose} />}
    </Dialog>
  )
}
