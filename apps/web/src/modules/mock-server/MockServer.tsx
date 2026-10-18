import { useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, Check, Copy, Download, LoaderCircle, RotateCcw, Send, Server, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { createMockApi, hasRequestBody, statusText, toMock, usableContract } from '@stacksketch/core'
import type { ContractEndpoint, HttpMethod, MockResponse, Shape } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import { Method } from '@/components/Method'
import { Button, Checkbox, IconButton, Labeled, Pane, Segmented, Select, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { RunOutside } from '@/modules/RunOutside'
import { useContract } from '@/store/contract'
import { useMock } from '@/store/mock'
import type { MockMobilePane } from '@/store/mock'
import { useUi } from '@/store/ui'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const CLI_ORIGIN = 'http://localhost:4010'
/** a delay longer than this is cut short here, so the page never hangs */
const MAX_WAIT = 15000

interface Exchange {
  id: number
  method: string
  url: string
  body?: unknown
  response: MockResponse
  /** how long it took, delay included */
  ms: number
  at: Date
}

/** A value that fits a path param: 1 for numbers, a UUID for UUIDs, a word otherwise. */
function sampleParam(shape: Shape | undefined): string {
  const s = shape?.kind === 'union' ? shape.options.find((o) => o.kind !== 'null') : shape
  if (s?.kind === 'number') return '1'
  if (s?.kind === 'enum') return String(s.values[0] ?? 'value')
  if (s?.kind === 'string' && s.format === 'uuid') return '3f2b8a6e-6d1c-4c2e-9a57-0d4b1e2c7a10'
  return 'abc123'
}

const statusTone = (status: number) => (status < 300 ? 'text-ok' : status < 400 ? 'text-t-number' : status < 500 ? 'text-warn' : 'text-danger')

function curlFor(x: { method: string; url: string; body?: unknown }) {
  const parts = [`curl -i -X ${x.method} '${CLI_ORIGIN}${x.url}'`]
  if (x.body !== undefined) parts.push(`-H 'Content-Type: application/json'`, `-d '${JSON.stringify(x.body).replace(/'/g, "'\\''")}'`)
  return parts.join(' \\\n  ')
}

export default function MockServer() {
  const contract = useContract((s) => s.contract)
  const method = useMock((s) => s.method)
  const url = useMock((s) => s.url)
  const bodyText = useMock((s) => s.body)
  const status = useMock((s) => s.status)
  const delay = useMock((s) => s.delay)
  const seed = useMock((s) => s.seed)
  const crud = useMock((s) => s.crud)
  const mobilePane = useMock((s) => s.mobilePane)
  const set = useMock((s) => s.set)
  const setModule = useUi((s) => s.setModule)

  const usable = useMemo(() => usableContract(contract).contract, [contract])
  // the fake API keeps what POST creates, so it lives as long as the contract and options do
  const api = useMemo(() => createMockApi(contract, { seed, crud }), [contract, seed, crud])
  const endpoints = useMemo(() => new Map(usable.endpoints.map((e) => [e.id, e])), [usable])
  const [log, setLog] = useState<Exchange[]>([])
  const [shown, setShown] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const current = log.find((x) => x.id === shown) ?? log[0]
  const takesBody = hasRequestBody(method as HttpMethod)
  const curl = curlFor({ method, url: url.trim().startsWith('/') ? url.trim() : `/${url.trim()}`, body: takesBody && bodyText.trim() ? safeJson(bodyText) : undefined })

  const pickRoute = (path: string, e: ContractEndpoint | undefined) => {
    const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => sampleParam(e?.params.find((p) => p.in === 'path' && p.name === name)?.shape))
    const body = e?.body ? JSON.stringify(toMock({ version: 2, rootName: e.resource || 'body', root: e.body.shape, types: usable.types }, { seed, rootCount: 2 }), null, 2) : ''
    set({ method: e?.method ?? 'GET', url: filled, body, mobilePane: 'request' })
  }

  const send = async () => {
    if (pending) return
    if (!url.trim()) {
      toast.error('Pick an endpoint first', { description: 'Click a route on the left, or type a path like /orders.' })
      return
    }
    let body: unknown
    if (takesBody && bodyText.trim()) {
      try {
        body = JSON.parse(bodyText)
      } catch (err) {
        toast.error('The body isn’t valid JSON', { description: err instanceof Error ? err.message : String(err) })
        return
      }
    }
    const headers: Record<string, string> = {}
    if (status) headers['x-mock-status'] = status
    if (delay.trim() !== '') headers['x-mock-delay'] = delay.trim()
    const path = url.trim().startsWith('/') ? url.trim() : `/${url.trim()}`
    const started = performance.now()
    setPending(true)
    const response = api.handle({ method, url: path, body, headers })
    await new Promise((r) => setTimeout(r, Math.min(response.delay, MAX_WAIT)))
    const id = (log[0]?.id ?? 0) + 1
    setLog((l) => [{ id, method, url: path, body, response, ms: Math.round(performance.now() - started), at: new Date() }, ...l].slice(0, 40))
    setShown(id)
    setPending(false)
    set({ mobilePane: 'response' })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement)) {
      e.preventDefault()
      void send()
    }
  }

  const copy = async (what: string, text: string) => {
    try {
      await copyText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 1400)
      toast.success(`Copied ${what}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the text and copy it by hand.' })
    }
  }

  const show = (pane: MockMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')
  const resetData = () => {
    api.reset()
    toast.success('Cleared what POST, PUT and PATCH stored', { description: 'Lists answer with made-up data again.' })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'routes', label: 'Routes' },
            { value: 'request', label: 'Request' },
            { value: 'response', label: 'Response' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------- routes ---------- */}
        <Pane
          title="Routes"
          meta={`${api.routes.length} from ${contract.title || 'the contract'}`}
          className={cx(show('routes'), 'xl:flex')}
          actions={
            <>
              <IconButton label="Forget what POST created" onClick={resetData}>
                <RotateCcw size={15} />
              </IconButton>
              <IconButton label="Download contract.json for the CLI" onClick={() => downloadText('contract.json', JSON.stringify(contract, null, 2) + '\n', 'application/json')}>
                <Download size={15} />
              </IconButton>
            </>
          }
          toolbar={
            <>
              <Checkbox label="Remember what POST creates" checked={crud} onChange={(v) => set({ crud: v })} />
              <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-ink-2">
                Seed
                <input
                  type="number"
                  min={1}
                  value={seed}
                  onChange={(e) => set({ seed: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  className={cx(inputClass, 'w-16 font-mono')}
                  title="Same seed, same data. Change it for different made-up values."
                />
              </label>
            </>
          }
        >
          <div className="absolute inset-0 overflow-y-auto p-2 scrollbar-thin">
            {api.routes.length ? (
              <ul className="space-y-px">
                {api.routes.map((r) => {
                  const e = endpoints.get(r.id)
                  const active = method === r.method && url.split('?')[0] === r.path.replace(/\{(\w+)\}/g, (_, n: string) => sampleParam(e?.params.find((p) => p.in === 'path' && p.name === n)?.shape))
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => pickRoute(r.path, e)}
                        aria-current={active ? 'true' : undefined}
                        className={cx('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left', active ? 'bg-accent-soft' : 'hover:bg-hover')}
                      >
                        <Method method={r.method} className="mt-[3px] w-12" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px] text-ink">{r.path}</span>
                          {r.summary ? <span className="block truncate text-[11.5px] text-ink-3">{r.summary}</span> : null}
                        </span>
                        {e?.mock?.status || e?.mock?.delay ? (
                          <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-warn" title="Set in the endpoint’s mock settings">
                            {[e.mock.status, e.mock.delay ? `${e.mock.delay}ms` : null].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="px-3 py-8 text-center text-[13px] text-ink-3">
                <p>The contract has no endpoints yet, so there’s nothing to serve.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setModule('contract')}>
                  Open the API contract
                  <ArrowRight size={13} />
                </Button>
              </div>
            )}
            <p className="mt-3 border-t border-line px-2 pt-3 text-[12px] leading-relaxed text-ink-3">
              Every route answers with made-up data shaped like its success response, from the same generator as the API explorer’s mock tab. Change the routes in the{' '}
              <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setModule('contract')}>
                API contract
              </button>
              .
            </p>
          </div>
        </Pane>

        {/* ---------- request ---------- */}
        <Pane title="Request" className={cx(show('request'), 'xl:flex')} actions={<RunOutside id="mock-server" label="Run it as a server" />}>
          <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto p-3 scrollbar-thin" onKeyDown={onKeyDown}>
            <div className="flex gap-2">
              <Select aria-label="Method" value={method} onChange={(e) => set({ method: e.target.value })} className="h-8 w-24 font-mono">
                {METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <TextInput aria-label="Path and query" placeholder="/orders?status=open" value={url} onChange={(e) => set({ url: e.target.value })} className="h-8 min-w-0 flex-1 font-mono" />
              <Button variant="primary" onClick={() => void send()} disabled={pending} title="Send it (Enter, or Ctrl+Enter in the body)">
                {pending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Labeled label="Answer with" hint="Build error states before the backend exists.">
                <Select value={status} onChange={(e) => set({ status: e.target.value })} className="h-8 w-full">
                  <option value="">What the contract says</option>
                  {[400, 401, 403, 404, 409, 422, 429, 500, 503].map((s) => (
                    <option key={s} value={String(s)}>
                      {s} {statusText(s)}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <Labeled label="Delay (ms)" hint="Empty uses the endpoint’s own delay.">
                <input type="number" min={0} step={100} placeholder="0" value={delay} onChange={(e) => set({ delay: e.target.value })} className={cx(inputClass, 'h-8 w-full font-mono')} />
              </Labeled>
            </div>
            {takesBody ? (
              <div className="flex min-h-48 flex-1 flex-col gap-1">
                <span className="text-[11.5px] font-medium text-ink-3">JSON body</span>
                <textarea
                  aria-label="JSON body"
                  value={bodyText}
                  spellCheck={false}
                  wrap="off"
                  placeholder='{ "name": "…" }'
                  onChange={(e) => set({ body: e.target.value })}
                  className={cx(inputClass, 'h-auto min-h-0 w-full flex-1 resize-none py-2 font-mono text-[12px] leading-relaxed')}
                />
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">{method} requests don’t send a body.</p>
            )}
            <div className="rounded-md border border-line bg-raised p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Server size={13} className="text-accent" />
                <span className="text-[12px] font-semibold text-ink-2">The same request against the CLI</span>
                <IconButton label="Copy the curl command" className="ml-auto size-7" onClick={() => void copy('the curl command', curl)}>
                  {copied === 'the curl command' ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                </IconButton>
              </div>
              <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink-2 scrollbar-thin">
                {curl}
              </pre>
            </div>
          </div>
        </Pane>

        {/* ---------- response ---------- */}
        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('response'), 'xl:flex')} aria-label="Response">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3.5">
            <h2 className="text-[13px] font-semibold tracking-[-0.005em]">Response</h2>
            {current ? (
              <span className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className={cx('font-mono font-semibold', statusTone(current.response.status))}>
                  {current.response.status} {statusText(current.response.status)}
                </span>
                <span className="text-ink-3">{current.ms} ms</span>
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-0.5">
              {current?.response.body !== undefined ? (
                <IconButton label="Copy the response body" onClick={() => void copy('the response body', JSON.stringify(current?.response.body, null, 2))}>
                  {copied === 'the response body' ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
                </IconButton>
              ) : null}
              {log.length ? (
                <IconButton label="Clear the history" onClick={() => setLog([])}>
                  <Trash2 size={15} />
                </IconButton>
              ) : null}
            </div>
          </header>
          {current ? (
            <>
              <div className="shrink-0 border-b border-line px-3 py-2">
                <p className="truncate font-mono text-[12px] text-ink-2">
                  <Method method={current.method} className="mr-2" />
                  {current.url}
                </p>
                <details className="mt-1 text-[12px]">
                  <summary className="cursor-pointer text-ink-3 hover:text-ink">{Object.keys(current.response.headers).length} headers</summary>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
                    {Object.entries(current.response.headers).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-ink-3">{k}</dt>
                        <dd className="truncate text-ink-2" title={v}>
                          {v}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
              <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0">
                  {current.response.body === undefined ? (
                    <p className="p-4 text-[13px] text-ink-3">No body: {current.response.status} {statusText(current.response.status)}.</p>
                  ) : (
                    <CodeView code={JSON.stringify(current.response.body, null, 2)} lang="json" label="Response body" />
                  )}
                </div>
              </div>
              {log.length > 1 ? (
                <div className="max-h-40 shrink-0 overflow-y-auto border-t border-line p-1.5 scrollbar-thin">
                  <p className="px-2 pb-1 text-[11.5px] font-medium text-ink-3">History</p>
                  <ul className="space-y-px">
                    {log.map((x) => (
                      <li key={x.id}>
                        <button
                          type="button"
                          onClick={() => setShown(x.id)}
                          aria-current={x === current ? 'true' : undefined}
                          className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px]', x === current ? 'bg-accent-soft' : 'hover:bg-hover')}
                        >
                          <Method method={x.method} className="w-12" />
                          <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{x.url}</span>
                          <span className={cx('font-mono', statusTone(x.response.status))}>{x.response.status}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div className="paper-grid flex flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-xs text-[13px] text-ink-3">
                <Send size={20} className="mx-auto mb-2 text-accent" />
                Pick a route and send it. The answer comes from your contract, right here in the browser.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
