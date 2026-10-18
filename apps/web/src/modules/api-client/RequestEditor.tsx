import { useMemo } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LoaderCircle, Plus, Send, Trash2, TriangleAlert, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'

import { assertionLabel, OPS_FOR, opWords, REQUEST_METHODS, requestFromCurl, requestFromEndpoint, sendsBody, splitQuery, variablesUsed } from '@stacksketch/core'
import type { ApiRequest, Assertion, AssertionTarget, BodyKind, Capture, Contract, RequestAuth } from '@stacksketch/core'
import { Button, IconButton, Labeled, Segmented, Select, Tabs, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { clientId } from '@/store/client'
import type { RequestTab } from '@/store/client'
import { KeyValueTable } from './KeyValueTable'
import { COMMON_HEADERS } from './lib'

const count = (n: number) => (n ? ` (${n})` : '')

export function RequestEditor({
  request,
  onChange,
  onSend,
  pending,
  vars,
  envName,
  contract,
  tab,
  setTab,
}: {
  request: ApiRequest
  onChange: (change: (r: ApiRequest) => ApiRequest) => void
  onSend: () => void
  pending: boolean
  vars: Record<string, string>
  envName: string | null
  contract: Contract
  tab: RequestTab
  setTab: (t: RequestTab) => void
}) {
  const patch = (p: Partial<ApiRequest>) => onChange((r) => ({ ...r, ...p }))
  const missing = useMemo(() => variablesUsed(request).filter((v) => !Object.hasOwn(vars, v)), [request, vars])
  const endpoint = contract.endpoints.find((e) => e.id === request.endpointId)

  // a pasted URL with a query string: move the query into Params; a pasted cURL command: take all of it
  const onPasteUrl = (e: ReactClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').trim()
    if (/^curl(\.exe)?\s/i.test(text)) {
      e.preventDefault()
      try {
        const from = requestFromCurl(text, request.id)
        onChange((r) => ({ ...from, id: r.id, name: r.name === 'New request' ? from.name : r.name, folder: r.folder, assertions: r.assertions, captures: r.captures, endpointId: r.endpointId }))
        toast.success('Read the cURL command', { description: 'Method, URL, headers, auth and body are filled in.' })
      } catch (err) {
        toast.error('Couldn’t read that cURL command', { description: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    const input = e.currentTarget
    if (text.includes('?') && input.selectionStart === 0 && input.selectionEnd === input.value.length) {
      e.preventDefault()
      const { url, params } = splitQuery(text)
      patch({ url, params: [...request.params, ...params] })
    }
  }
  const onBlurUrl = () => {
    if (!request.url.includes('?')) return
    const { url, params } = splitQuery(request.url)
    patch({ url, params: [...request.params, ...params] })
  }
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (e.target instanceof HTMLInputElement && e.target.dataset.sendOnEnter))) {
      e.preventDefault()
      if (e.target instanceof HTMLInputElement && e.target.dataset.sendOnEnter) onBlurUrl()
      onSend()
    }
  }

  const enabledCount = (rows: { enabled: boolean; key: string }[]) => rows.filter((r) => r.enabled && r.key.trim()).length

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <input
          aria-label="Request name"
          value={request.name}
          onChange={(e) => patch({ name: e.target.value })}
          spellCheck={false}
          className="w-full rounded-md bg-transparent px-1 text-[14px] font-semibold text-ink outline-none hover:bg-hover focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-accent/25"
        />
        <div className="flex gap-2">
          <Select aria-label="Method" value={request.method} onChange={(e) => patch({ method: e.target.value })} className="h-8 w-[5.5rem] shrink-0 font-mono">
            {REQUEST_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <TextInput
            aria-label="URL"
            data-send-on-enter="1"
            placeholder="{{baseUrl}}/orders, or paste a cURL command"
            value={request.url}
            onChange={(e) => patch({ url: e.target.value })}
            onPaste={onPasteUrl}
            onBlur={onBlurUrl}
            className="h-8 min-w-0 flex-1 font-mono"
          />
          <Button variant="primary" onClick={onSend} disabled={pending} title="Send it (Enter in the URL, or Ctrl+Enter anywhere)">
            {pending ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
            <span className="max-sm:hidden">Send</span>
          </Button>
        </div>
        {missing.length ? (
          <p className="flex items-start gap-1.5 text-[12px] text-warn">
            <TriangleAlert size={13} className="mt-px shrink-0" />
            <span>
              {missing.map((m) => `{{${m}}}`).join(', ')} {missing.length > 1 ? 'have' : 'has'} no value in {envName ? `“${envName}”` : 'any environment (none is picked)'}. Add {missing.length > 1 ? 'them' : 'it'} with the environment button, or capture {missing.length > 1 ? 'them' : 'it'} from another request’s response.
            </span>
          </p>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-line px-2">
        <Tabs
          label="Request parts"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'params', label: `Params${count(enabledCount(request.params))}` },
            { value: 'headers', label: `Headers${count(enabledCount(request.headers))}` },
            { value: 'auth', label: request.auth.kind === 'none' ? 'Auth' : 'Auth ●' },
            { value: 'body', label: request.body.kind === 'none' || !sendsBody(request.method) ? 'Body' : 'Body ●' },
            { value: 'tests', label: `Tests${count(request.assertions.filter((a) => a.enabled).length + request.captures.filter((c) => c.enabled).length)}` },
            { value: 'notes', label: 'Notes' },
          ]}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 overflow-y-auto p-3 scrollbar-thin">
          {tab === 'params' ? (
            <>
              <KeyValueTable rows={request.params} onChange={(params) => patch({ params })} keyPlaceholder="status" valuePlaceholder="open or {{status}}" />
              <p className="mt-3 text-[12px] text-ink-3">Query params go after the ? in the URL, encoded for you. Paste a whole URL into the URL box and its query lands here.</p>
            </>
          ) : null}
          {tab === 'headers' ? (
            <>
              <KeyValueTable rows={request.headers} onChange={(headers) => patch({ headers })} suggestions={COMMON_HEADERS} keyPlaceholder="X-Request-Id" secret />
              <p className="mt-3 text-[12px] text-ink-3">Content-Type is set from the body and Authorization from the Auth tab, unless you set them here. Sent from the browser, some headers (Cookie, Origin, Host) are dropped; the proxy sends every one.</p>
            </>
          ) : null}
          {tab === 'auth' ? <AuthEditor auth={request.auth} onChange={(auth) => patch({ auth })} /> : null}
          {tab === 'body' ? <BodyEditor request={request} contract={contract} onChange={onChange} /> : null}
          {tab === 'tests' ? <TestsEditor request={request} onChange={onChange} hasEndpoint={Boolean(endpoint)} /> : null}
          {tab === 'notes' ? (
            <div className="space-y-3">
              <Labeled label="Folder" hint="Requests with the same folder are listed together. Use “Orders / Admin” for a folder inside a folder.">
                <TextInput value={request.folder} onChange={(e) => patch({ folder: e.target.value })} placeholder="Orders" className="h-8 w-full" />
              </Labeled>
              <Labeled label="Check against" hint="The contract endpoint whose responses this request should match. Without one, the URL picks it.">
                <Select value={request.endpointId ?? ''} onChange={(e) => patch({ endpointId: e.target.value || undefined })} className="h-8 w-full font-mono">
                  <option value="">Find it from the URL</option>
                  {contract.endpoints.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.method} {e.path} {e.summary ? `· ${e.summary}` : ''}
                    </option>
                  ))}
                </Select>
              </Labeled>
              <Labeled label="Notes" hint="For whoever opens this next: what it’s for, which user to log in as.">
                <textarea
                  value={request.description ?? ''}
                  onChange={(e) => patch({ description: e.target.value || undefined })}
                  rows={6}
                  className={cx(inputClass, 'h-auto w-full resize-y py-2 leading-relaxed')}
                />
              </Labeled>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------- auth ---------- */

function AuthEditor({ auth, onChange }: { auth: RequestAuth; onChange: (a: RequestAuth) => void }) {
  const pick = (kind: RequestAuth['kind']) => {
    if (kind === auth.kind) return
    if (kind === 'none') onChange({ kind })
    else if (kind === 'bearer') onChange({ kind, token: '' })
    else if (kind === 'basic') onChange({ kind, username: '', password: '' })
    else onChange({ kind, name: 'X-API-Key', value: '', in: 'header' })
  }
  return (
    <div className="space-y-3">
      <Segmented
        label="Auth type"
        value={auth.kind}
        onChange={pick}
        className="w-full max-w-md"
        options={[
          { value: 'none', label: 'None' },
          { value: 'bearer', label: 'Bearer' },
          { value: 'basic', label: 'Basic' },
          { value: 'apiKey', label: 'API key' },
        ]}
      />
      {auth.kind === 'none' ? <p className="text-[12.5px] text-ink-3">No Authorization header is added. Pick a type, or set the header yourself on the Headers tab.</p> : null}
      {auth.kind === 'bearer' ? (
        <Labeled label="Token" hint="Sent as Authorization: Bearer …. Use {{token}} and capture it from your login request’s response on its Tests tab.">
          <TextInput value={auth.token} onChange={(e) => onChange({ ...auth, token: e.target.value })} placeholder="{{token}}" className="h-8 w-full font-mono" />
        </Labeled>
      ) : null}
      {auth.kind === 'basic' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Username">
            <TextInput value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} className="h-8 w-full font-mono" />
          </Labeled>
          <Labeled label="Password">
            <input type="password" autoComplete="off" value={auth.password} onChange={(e) => onChange({ ...auth, password: e.target.value })} className={cx(inputClass, 'h-8 w-full font-mono')} />
          </Labeled>
        </div>
      ) : null}
      {auth.kind === 'apiKey' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
          <Labeled label="Name">
            <TextInput value={auth.name} onChange={(e) => onChange({ ...auth, name: e.target.value })} className="h-8 w-full font-mono" />
          </Labeled>
          <Labeled label="Value">
            <TextInput value={auth.value} onChange={(e) => onChange({ ...auth, value: e.target.value })} placeholder="{{apiKey}}" className="h-8 w-full font-mono" />
          </Labeled>
          <Labeled label="Send in">
            <Select value={auth.in} onChange={(e) => onChange({ ...auth, in: e.target.value as 'header' | 'query' })} className="h-8">
              <option value="header">A header</option>
              <option value="query">The query</option>
            </Select>
          </Labeled>
        </div>
      ) : null}
      <p className="text-[12px] text-ink-3">Requests are saved in this browser only. Prefer {'{{variables}}'} for secrets, so the request can be shared without them.</p>
    </div>
  )
}

/* ---------- body ---------- */

function BodyEditor({ request, contract, onChange }: { request: ApiRequest; contract: Contract; onChange: (change: (r: ApiRequest) => ApiRequest) => void }) {
  const body = request.body
  const setBody = (b: Partial<ApiRequest['body']>) => onChange((r) => ({ ...r, body: { ...r.body, ...b } }))
  const endpoint = contract.endpoints.find((e) => e.id === request.endpointId)
  if (!sendsBody(request.method)) return <p className="text-[12.5px] text-ink-3">{request.method} requests don’t send a body.</p>
  const format = () => {
    try {
      setBody({ text: JSON.stringify(JSON.parse(body.text), null, 2) })
    } catch (e) {
      toast.error('Can’t format it: the JSON isn’t valid', { description: e instanceof Error ? e.message : String(e) })
    }
  }
  const fromContract = () => {
    if (!endpoint?.body) return
    const made = requestFromEndpoint(contract, endpoint, request.id, Math.floor(Math.random() * 1000) + 1)
    setBody({ kind: 'json', text: made.body.text })
  }
  return (
    <div className="flex h-full min-h-56 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Body type"
          value={body.kind}
          onChange={(kind: BodyKind) => setBody({ kind })}
          options={[
            { value: 'none', label: 'None' },
            { value: 'json', label: 'JSON' },
            { value: 'text', label: 'Text' },
            { value: 'form', label: 'Form', title: 'application/x-www-form-urlencoded' },
          ]}
        />
        {body.kind === 'json' ? (
          <Button variant="ghost" size="sm" onClick={format}>
            Format
          </Button>
        ) : null}
        {body.kind === 'json' && endpoint?.body ? (
          <Button variant="ghost" size="sm" onClick={fromContract} title="Fill the body with made-up data of the type the contract expects">
            <WandSparkles size={13} />
            Fill from the contract
          </Button>
        ) : null}
      </div>
      {body.kind === 'json' || body.kind === 'text' ? (
        <textarea
          aria-label={body.kind === 'json' ? 'JSON body' : 'Text body'}
          value={body.text}
          spellCheck={false}
          wrap="off"
          placeholder={body.kind === 'json' ? '{ "name": "{{name}}" }' : 'Plain text'}
          onChange={(e) => setBody({ text: e.target.value })}
          className={cx(inputClass, 'h-auto min-h-48 w-full flex-1 resize-none py-2 font-mono text-[12px] leading-relaxed')}
        />
      ) : null}
      {body.kind === 'form' ? <KeyValueTable rows={body.form} onChange={(form) => setBody({ form })} keyLabel="Field" /> : null}
      {body.kind === 'none' ? <p className="text-[12.5px] text-ink-3">No body is sent.</p> : null}
    </div>
  )
}

/* ---------- tests and captures ---------- */

const TARGETS: { value: AssertionTarget; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'body', label: 'Body value' },
  { value: 'header', label: 'Header' },
  { value: 'time', label: 'Time (ms)' },
  { value: 'contract', label: 'Contract' },
]

function TestsEditor({ request, onChange, hasEndpoint }: { request: ApiRequest; onChange: (change: (r: ApiRequest) => ApiRequest) => void; hasEndpoint: boolean }) {
  const setAssertions = (f: (a: Assertion[]) => Assertion[]) => onChange((r) => ({ ...r, assertions: f(r.assertions) }))
  const setCaptures = (f: (c: Capture[]) => Capture[]) => onChange((r) => ({ ...r, captures: f(r.captures) }))
  const add = (a: Omit<Assertion, 'id' | 'enabled'>) => setAssertions((list) => [...list, { ...a, id: clientId(), enabled: true }])
  const edit = (id: string, p: Partial<Assertion>) =>
    setAssertions((list) =>
      list.map((a) => {
        if (a.id !== id) return a
        const next = { ...a, ...p }
        if (!OPS_FOR[next.target].includes(next.op)) next.op = OPS_FOR[next.target][0]
        return next
      }),
    )
  const hasContract = request.assertions.some((a) => a.target === 'contract')
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-[12.5px] font-semibold text-ink-2">Checks</h3>
        <p className="mb-2 text-[12px] text-ink-3">Run on every response, and by the collection runner. Paths read JSON like data.items[0].id.</p>
        <ul className="space-y-1.5">
          {request.assertions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-raised p-1.5">
              <input type="checkbox" aria-label={`Run: ${assertionLabel(a)}`} checked={a.enabled} onChange={(e) => edit(a.id, { enabled: e.target.checked })} className="mx-1 size-3.5 accent-[var(--c-accent)]" />
              <Select aria-label="What to check" value={a.target} onChange={(e) => edit(a.id, { target: e.target.value as AssertionTarget })} className="w-28">
                {TARGETS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              {a.target === 'contract' ? (
                <span className="flex-1 text-[12px] text-ink-2">{hasEndpoint ? 'matches the linked endpoint’s responses' : 'matches the endpoint the URL hits'}</span>
              ) : (
                <>
                  {a.target === 'body' || a.target === 'header' ? (
                    <TextInput
                      aria-label={a.target === 'body' ? 'Path in the body' : 'Header name'}
                      value={a.path}
                      onChange={(e) => edit(a.id, { path: e.target.value })}
                      placeholder={a.target === 'body' ? 'data.id' : 'content-type'}
                      className="w-32 min-w-24 flex-1 font-mono"
                    />
                  ) : null}
                  <Select aria-label="How" value={a.op} onChange={(e) => edit(a.id, { op: e.target.value as Assertion['op'] })} className="w-28">
                    {OPS_FOR[a.target].map((op) => (
                      <option key={op} value={op}>
                        {opWords(op)}
                      </option>
                    ))}
                  </Select>
                  {a.op === 'exists' || a.op === 'missing' ? null : (
                    <TextInput
                      aria-label="Expected value"
                      value={a.value}
                      onChange={(e) => edit(a.id, { value: e.target.value })}
                      placeholder={a.op === 'matches' ? '^ord_' : a.target === 'status' ? '200' : a.target === 'time' ? '500' : 'value'}
                      className="w-24 min-w-20 flex-1 font-mono"
                    />
                  )}
                </>
              )}
              <IconButton label="Remove this check" className="ml-auto size-7" onClick={() => setAssertions((list) => list.filter((x) => x.id !== a.id))}>
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => add({ target: 'status', path: '', op: 'equals', value: '200' })}>
            <Plus size={13} /> Status is 200
          </Button>
          {hasContract ? null : (
            <Button variant="outline" size="sm" onClick={() => add({ target: 'contract', path: '', op: 'matches', value: '' })}>
              <Plus size={13} /> Matches the contract
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => add({ target: 'body', path: 'id', op: 'exists', value: '' })}>
            <Plus size={13} /> Body value
          </Button>
          <Button variant="outline" size="sm" onClick={() => add({ target: 'time', path: '', op: 'lessThan', value: '1000' })}>
            <Plus size={13} /> Faster than 1 s
          </Button>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-[12.5px] font-semibold text-ink-2">Save to the environment</h3>
        <p className="mb-2 text-[12px] text-ink-3">After a response, copy a value into a variable for the next requests: a login’s token, the id of what was just created.</p>
        <ul className="space-y-1.5">
          {request.captures.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-raised p-1.5">
              <input
                type="checkbox"
                aria-label={`Save ${c.variable || 'this value'}`}
                checked={c.enabled}
                onChange={(e) => setCaptures((list) => list.map((x) => (x.id === c.id ? { ...x, enabled: e.target.checked } : x)))}
                className="mx-1 size-3.5 accent-[var(--c-accent)]"
              />
              <Select aria-label="From" value={c.from} onChange={(e) => setCaptures((list) => list.map((x) => (x.id === c.id ? { ...x, from: e.target.value as Capture['from'] } : x)))} className="w-24">
                <option value="body">Body</option>
                <option value="header">Header</option>
                <option value="status">Status</option>
              </Select>
              {c.from === 'status' ? null : (
                <TextInput
                  aria-label={c.from === 'body' ? 'Path in the body' : 'Header name'}
                  value={c.path}
                  onChange={(e) => setCaptures((list) => list.map((x) => (x.id === c.id ? { ...x, path: e.target.value } : x)))}
                  placeholder={c.from === 'body' ? 'token' : 'x-request-id'}
                  className="w-28 min-w-24 flex-1 font-mono"
                />
              )}
              <span className="text-[12px] text-ink-3">into</span>
              <TextInput
                aria-label="Variable"
                value={c.variable}
                onChange={(e) => setCaptures((list) => list.map((x) => (x.id === c.id ? { ...x, variable: e.target.value.replace(/[^\w.-]/g, '') } : x)))}
                placeholder="token"
                className="w-28 min-w-24 flex-1 font-mono"
              />
              <IconButton label="Remove" className="ml-auto size-7" onClick={() => setCaptures((list) => list.filter((x) => x.id !== c.id))}>
                <Trash2 size={13} />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setCaptures((list) => [...list, { id: clientId(), from: 'body', path: '', variable: '', enabled: true }])}>
          <Plus size={13} /> Save a value
        </Button>
      </section>
    </div>
  )
}
