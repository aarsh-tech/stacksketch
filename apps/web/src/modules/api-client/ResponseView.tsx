import { useMemo, useState } from 'react'
import { ArrowRight, Braces, Check, CircleCheck, CircleX, Copy, FilePlus2, Send, ShieldAlert, Trash2, TriangleAlert, Unplug } from 'lucide-react'
import { toast } from 'sonner'

import { checkContract, findEndpoint, formatBytes, openApiPath, responseJson, statusText, toCurl, toFetchSnippet } from '@stacksketch/core'
import type { ApiRequest, Contract, SuccessfulResult } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import { Method } from '@/components/Method'
import { Button, IconButton, Tabs } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText } from '@/lib/download'
import type { Exchange, ResponseTab } from '@/store/client'
import type { Transport } from './transport'
import { statusTone } from './lib'
import { TRANSPORTS } from './transport'

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
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
  return { copied, copy }
}

export function ResponseView({
  request,
  exchange,
  history,
  onShow,
  onClear,
  contract,
  tab,
  setTab,
  transport,
  onSwitchTransport,
  onGrant,
  onAddToContract,
  onOpenInExplorer,
  onHelp,
}: {
  request: ApiRequest
  exchange: Exchange | undefined
  history: Exchange[]
  onShow: (id: number) => void
  onClear: () => void
  contract: Contract
  tab: ResponseTab
  setTab: (t: ResponseTab) => void
  transport: Transport
  onSwitchTransport: (t: Transport) => void
  onGrant: (origin: string) => void
  onAddToContract: (x: Exchange & { result: SuccessfulResult }) => void
  onOpenInExplorer: (x: Exchange & { result: SuccessfulResult }) => void
  onHelp: () => void
}) {
  const { copied, copy } = useCopy()
  const result = exchange?.result
  const okResult = result?.ok ? result : undefined
  const json = useMemo(() => (okResult ? responseJson(okResult) : undefined), [okResult])
  const pretty = useMemo(() => (json === undefined ? null : JSON.stringify(json, null, 2)), [json])
  const passed = exchange?.assertions.filter((a) => a.pass).length ?? 0
  const total = exchange?.assertions.length ?? 0

  const endpoint = useMemo(() => {
    if (!exchange) return undefined
    return contract.endpoints.find((e) => e.id === request.endpointId) ?? findEndpoint(contract, exchange.sent.method, exchange.sent.url)
  }, [contract, exchange, request.endpointId])
  const check = useMemo(() => (okResult && endpoint ? checkContract(contract, endpoint, okResult.status, json, okResult.body) : undefined), [contract, endpoint, okResult, json])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label="Response">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3.5">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em]">Response</h2>
        {okResult ? (
          <span className="flex min-w-0 items-center gap-2 text-[12px]">
            <span className={cx('font-mono font-semibold', statusTone(okResult.status))}>
              {okResult.status} {okResult.statusText || statusText(okResult.status)}
            </span>
            <span className="text-ink-3">{okResult.ms} ms</span>
            <span className="text-ink-3 max-sm:hidden">{formatBytes(okResult.size)}</span>
            {total ? (
              <span className={cx('font-medium', passed === total ? 'text-ok' : 'text-danger')}>
                {passed}/{total} passed
              </span>
            ) : null}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {okResult ? (
            <>
              <IconButton label="Copy the response body" onClick={() => void copy('the response body', pretty ?? okResult.body)}>
                {copied === 'the response body' ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
              </IconButton>
              {json !== undefined ? (
                <IconButton label="Open in the API explorer: types, Zod and mock data" onClick={() => onOpenInExplorer({ ...exchange!, result: okResult })}>
                  <Braces size={15} />
                </IconButton>
              ) : null}
            </>
          ) : null}
          {history.length ? (
            <IconButton label="Clear this request’s history" onClick={onClear}>
              <Trash2 size={15} />
            </IconButton>
          ) : null}
        </div>
      </header>

      {!exchange ? (
        <div className="paper-grid flex flex-1 items-center justify-center p-6 text-center">
          <div className="max-w-xs text-[13px] text-ink-3">
            <Send size={20} className="mx-auto mb-2 text-accent" />
            Send the request to see what comes back, with its checks and how it matches the API contract.
          </div>
        </div>
      ) : !result?.ok ? (
        <SendError exchange={exchange} transport={transport} onSwitchTransport={onSwitchTransport} onGrant={onGrant} onHelp={onHelp} />
      ) : (
        <>
          <div className="shrink-0 border-b border-line px-2">
            <Tabs
              label="Response parts"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'body', label: 'Body' },
                { value: 'headers', label: `Headers (${okResult!.headers.length})` },
                { value: 'tests', label: total ? `Tests ${passed}/${total}` : 'Tests' },
                { value: 'contract', label: check ? (check.ok ? 'Contract ✓' : `Contract (${check.issues.filter((i) => i.severity === 'error').length})`) : 'Contract' },
                { value: 'code', label: 'Code' },
              ]}
            />
          </div>
          <div className="relative min-h-0 flex-1">
            {tab === 'body' ? (
              <div className="absolute inset-0">
                {!okResult!.body ? (
                  <p className="p-4 text-[13px] text-ink-3">
                    No body: {okResult!.status} {okResult!.statusText || statusText(okResult!.status)}.
                  </p>
                ) : pretty !== null ? (
                  <CodeView code={pretty} lang="json" label="Response body" />
                ) : (
                  <pre className="h-full overflow-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin">{okResult!.body}</pre>
                )}
              </div>
            ) : null}
            {tab === 'headers' ? (
              <div className="absolute inset-0 overflow-y-auto p-3 scrollbar-thin">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
                  {okResult!.headers.map(([k, v], i) => (
                    <div key={`${k}-${i}`} className="contents">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="break-all text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-[12px] text-ink-3">
                  Sent to <span className="font-mono break-all">{okResult!.url}</span> with {TRANSPORTS.find((t) => t.value === exchange.transport)?.label.toLowerCase()}.
                  {exchange.transport === 'browser' ? ' A page only sees the headers the API exposes (Access-Control-Expose-Headers); the extension and the proxy see them all.' : ''}
                </p>
              </div>
            ) : null}
            {tab === 'tests' ? (
              <div className="absolute inset-0 overflow-y-auto p-3 scrollbar-thin">
                {exchange.assertions.length ? (
                  <ul className="space-y-1.5">
                    {exchange.assertions.map((a) => (
                      <li key={a.id} className={cx('flex gap-2 rounded-md border px-2.5 py-2 text-[12.5px]', a.pass ? 'border-line bg-raised' : 'border-danger/40 bg-danger-soft')}>
                        {a.pass ? <CircleCheck size={15} className="mt-px shrink-0 text-ok" /> : <CircleX size={15} className="mt-px shrink-0 text-danger" />}
                        <span className="min-w-0">
                          <span className="block text-ink">{a.label}</span>
                          {a.detail ? <span className="block break-words text-ink-2">{a.detail}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-3">No checks on this request yet. Add some on the request’s Tests tab: a status, a value in the body, or a match with the contract.</p>
                )}
                {exchange.captured.length || exchange.captureFailed.length ? (
                  <div className="mt-4">
                    <h3 className="mb-1.5 text-[12px] font-semibold text-ink-2">Saved to the environment</h3>
                    <ul className="space-y-1 font-mono text-[12px]">
                      {exchange.captured.map((c) => (
                        <li key={c.variable} className="truncate text-ink-2">
                          <span className="text-ok">{c.variable}</span> = {c.value}
                        </li>
                      ))}
                      {exchange.captureFailed.map((f) => (
                        <li key={f} className="text-warn">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === 'contract' ? (
              <div className="absolute inset-0 overflow-y-auto p-3 scrollbar-thin">
                {endpoint && check ? (
                  <>
                    <p className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-2">
                      Checked against <Method method={endpoint.method} /> <span className="font-mono">{openApiPath(endpoint.path)}</span>
                      {check.response ? <span className="text-ink-3">· {String(check.response.status)} response</span> : null}
                    </p>
                    {check.issues.length === 0 ? (
                      <p className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-2.5 text-[13px] text-ink">
                        <CircleCheck size={16} className="text-ok" />
                        The response matches the contract: the status is listed and every field has the promised type.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {check.issues.map((i, n) => (
                          <li key={n} className={cx('rounded-md border px-2.5 py-2 text-[12.5px]', i.severity === 'error' ? 'border-danger/40 bg-danger-soft' : 'border-warn/40 bg-warn-soft')}>
                            <span className="font-mono text-[11.5px] text-ink-2">{i.path}</span>
                            <span className="block text-ink">{i.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 text-[12px] text-ink-3">
                      {check.ok ? 'Warnings are worth a look but don’t break the contract.' : 'Either the API or the contract is wrong. Fix one, and both sides stay in step.'}
                    </p>
                  </>
                ) : (
                  <div className="text-[13px] text-ink-2">
                    <p>
                      No endpoint in the API contract matches <span className="font-mono">{exchange.sent.method} {pathOf(exchange.sent.url)}</span>.
                    </p>
                    {json !== undefined ? (
                      <>
                        <p className="mt-2 text-ink-3">Add it, with this response as its {okResult!.status} body, so the frontend gets types for it and the mock server can serve it.</p>
                        <Button variant="outline" className="mt-3" onClick={() => onAddToContract({ ...exchange, result: okResult! })}>
                          <FilePlus2 size={14} />
                          Add it to the API contract
                        </Button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
            {tab === 'code' ? <CodeTab exchange={exchange} copy={copy} copied={copied} /> : null}
          </div>
        </>
      )}

      {history.length > 1 ? (
        <div className="max-h-36 shrink-0 overflow-y-auto border-t border-line p-1.5 scrollbar-thin">
          <p className="px-2 pb-1 text-[11.5px] font-medium text-ink-3">History</p>
          <ul className="space-y-px">
            {history.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => onShow(x.id)}
                  aria-current={x === exchange ? 'true' : undefined}
                  className={cx('flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px]', x === exchange ? 'bg-accent-soft' : 'hover:bg-hover')}
                >
                  <Method method={x.sent.method} className="w-12" />
                  <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{pathOf(x.sent.url)}</span>
                  <span className="text-ink-3 max-sm:hidden">{x.at.toLocaleTimeString()}</span>
                  {x.result.ok ? <span className={cx('font-mono', statusTone(x.result.status))}>{x.result.status}</span> : <span className="font-mono text-danger">failed</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function CodeTab({ exchange, copy, copied }: { exchange: Exchange; copy: (what: string, text: string) => Promise<void>; copied: string | null }) {
  const curl = toCurl(exchange.sent)
  const fetchCode = toFetchSnippet(exchange.sent)
  return (
    <div className="absolute inset-0 space-y-4 overflow-y-auto p-3 scrollbar-thin">
      {[
        { what: 'the cURL command', title: 'cURL', code: curl },
        { what: 'the fetch call', title: 'fetch', code: fetchCode },
      ].map((s) => (
        <div key={s.title} className="rounded-md border border-line bg-raised p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[12px] font-semibold text-ink-2">{s.title}</span>
            <IconButton label={`Copy ${s.what}`} className="ml-auto size-7" onClick={() => void copy(s.what, s.code)}>
              {copied === s.what ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
            </IconButton>
          </div>
          <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed whitespace-pre text-ink-2 scrollbar-thin">{s.code}</pre>
        </div>
      ))}
      <p className="text-[12px] text-ink-3">Exactly what was sent, variables filled in. For a typed client for every endpoint, open the API contract’s Client tab.</p>
    </div>
  )
}

function SendError({
  exchange,
  transport,
  onSwitchTransport,
  onGrant,
  onHelp,
}: {
  exchange: Exchange
  transport: Transport
  onSwitchTransport: (t: Transport) => void
  onGrant: (origin: string) => void
  onHelp: () => void
}) {
  const r = exchange.result
  if (r.ok) return null
  const Icon = r.kind === 'permission' ? ShieldAlert : r.kind === 'cors' ? Unplug : TriangleAlert
  return (
    <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
      <div className="rounded-lg border border-danger/40 bg-danger-soft p-4">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
          <Icon size={16} className="text-danger" />
          {r.kind === 'cors' ? 'Blocked by the browser' : r.kind === 'permission' ? 'The extension needs your OK' : r.kind === 'timeout' ? 'No answer in time' : 'The request didn’t go through'}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{r.error}</p>
        <p className="mt-2 font-mono text-[11.5px] break-all text-ink-3">
          {exchange.sent.method} {exchange.sent.url}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {r.kind === 'permission' && r.origin ? (
            <Button variant="primary" onClick={() => onGrant(r.origin!)}>
              Allow {hostOf(r.origin)}
            </Button>
          ) : null}
          {r.kind === 'cors' || (r.kind === 'network' && transport === 'browser') ? (
            <>
              <Button variant="primary" onClick={() => onSwitchTransport('extension')}>
                Send with the extension
              </Button>
              <Button variant="outline" onClick={() => onSwitchTransport('proxy')}>
                Send with the proxy
              </Button>
            </>
          ) : null}
          {transport !== 'mock' ? (
            <Button variant="ghost" onClick={() => onSwitchTransport('mock')} title="Answer from the API contract instead, while the backend isn't ready">
              Try the mock
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onHelp}>
            How to send without CORS
            <ArrowRight size={13} />
          </Button>
        </div>
      </div>
    </div>
  )
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}
