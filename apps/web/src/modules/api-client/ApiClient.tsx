import { useMemo, useState } from 'react'
import { CircleHelp, Download, FileInput, Play, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'

import {
  addSchemaEndpoint,
  buildRequest,
  emptyOverrides,
  emptyRequest,
  HTTP_METHODS,
  inferSchema,
  pascalCase,
  requestProblem,
  runAssertions,
  runCaptures,
  setVariables,
  statusText,
  toPostmanCollection,
  variablesOf,
} from '@stacksketch/core'
import type { ApiRequest, Environment, HttpMethod, SendRequest, SuccessfulResult } from '@stacksketch/core'
import { Button, IconButton, Pane, Segmented } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { downloadText } from '@/lib/download'
import { clientId, useClient, useHistory } from '@/store/client'
import type { ClientMobilePane, Exchange } from '@/store/client'
import { uid, useContract } from '@/store/contract'
import { newSampleId, useExplorer } from '@/store/explorer'
import { useUi } from '@/store/ui'
import { EnvironmentsDialog, HelpDialog, ImportDialog, RunnerDialog } from './Dialogs'
import { RequestEditor } from './RequestEditor'
import { RequestList } from './RequestList'
import { ResponseView } from './ResponseView'
import { TRANSPORTS, grantThroughExtension, pingProxy, recheckExtension, send as sendWith, useExtension } from './transport'
import type { Transport } from './transport'

type Open = 'envs' | 'import' | 'run' | 'help' | null

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return url.split('?')[0]
  }
}

/** The last named part of a URL's path, to name its response type: `/v1/orders/42` → `orders`. */
const resourceName = (url: string) =>
  pathOf(url)
    .split('/')
    .filter((s) => s && !/^\d+$|^[0-9a-f-]{20,}$|^v\d+$/i.test(s))
    .at(-1) ?? 'Response'

export default function ApiClient() {
  const requests = useClient((s) => s.requests)
  const environments = useClient((s) => s.environments)
  const envId = useClient((s) => s.envId)
  const selected = useClient((s) => s.selected)
  const transport = useClient((s) => s.transport)
  const proxyPort = useClient((s) => s.proxyPort)
  const timeout = useClient((s) => s.timeout)
  const requestTab = useClient((s) => s.requestTab)
  const responseTab = useClient((s) => s.responseTab)
  const mobilePane = useClient((s) => s.mobilePane)
  const set = useClient((s) => s.set)
  const updateRequest = useClient((s) => s.updateRequest)
  const addRequests = useClient((s) => s.addRequests)
  const removeRequest = useClient((s) => s.removeRequest)
  const restore = useClient((s) => s.restore)
  const setEnvironments = useClient((s) => s.setEnvironments)
  const updateEnvironment = useClient((s) => s.updateEnvironment)
  const exchanges = useHistory((s) => s.exchanges)
  const shown = useHistory((s) => s.shown)
  const addExchange = useHistory((s) => s.add)
  const showExchange = useHistory((s) => s.show)
  const clearHistory = useHistory((s) => s.clear)
  const contract = useContract((s) => s.contract)
  const setModule = useUi((s) => s.setModule)
  const extension = useExtension()

  const [open, setOpen] = useState<Open>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [proxyUp, setProxyUp] = useState<boolean | null>(null)

  const request = requests.find((r) => r.id === selected) ?? requests[0]
  const env = environments.find((e) => e.id === envId)
  const vars = useMemo(() => variablesOf(env), [env])
  const history = useMemo(() => exchanges.filter((x) => x.requestId === request?.id), [exchanges, request?.id])
  const exchange = history.find((x) => x.id === shown[request?.id ?? '']) ?? history[0]
  const lastByRequest = useMemo(() => {
    const m = new Map<string, Exchange>()
    for (const x of exchanges) if (!m.has(x.requestId)) m.set(x.requestId, x)
    return m
  }, [exchanges])

  const transmit = (r: SendRequest, via: Transport = transport) => sendWith(via, { ...r, timeout: timeout * 1000 }, { contract, proxyPort })

  const send = async (via: Transport = transport) => {
    if (!request || pending) return
    const built = buildRequest(request, vars)
    const problem = requestProblem(built, request.body.kind)
    if (problem) {
      toast.error('Can’t send it yet', { description: problem })
      return
    }
    setPending(request.id)
    const result = await transmit({ method: built.method, url: built.url, headers: built.headers, body: built.body }, via)
    setPending(null)
    const assertions = result.ok ? runAssertions(request, result, contract) : []
    const { set: captured, failed } = result.ok ? runCaptures(request.captures, result) : { set: [], failed: [] }
    if (captured.length) {
      if (env) updateEnvironment(env.id, (e) => setVariables(e, captured))
      else toast.warning('Nothing was saved', { description: `Pick an environment to keep ${captured.map((c) => c.variable).join(', ')} for the next requests.` })
    }
    addExchange({ requestId: request.id, at: new Date(), transport: via, sent: built, result, assertions, captured: env ? captured : [], captureFailed: failed })
    set({ mobilePane: 'response', ...(result.ok && responseTab === 'tests' && !assertions.length ? { responseTab: 'body' } : {}) })
  }

  const switchTransport = (t: Transport) => {
    set({ transport: t })
    if (t === 'proxy') void pingProxy(proxyPort).then(setProxyUp)
    if (t === 'extension') recheckExtension()
  }

  const newRequest = () => {
    const r = emptyRequest(clientId(), { folder: request?.folder ?? '', url: env && 'baseUrl' in vars ? '{{baseUrl}}/' : '' })
    addRequests([r])
    set({ requestTab: 'params' })
  }

  const duplicate = (id: string) => {
    const r = requests.find((x) => x.id === id)
    if (!r) return
    addRequests([{ ...structuredClone(r), id: clientId(), name: `${r.name} copy` }])
  }

  const remove = (id: string) => {
    const r = requests.find((x) => x.id === id)
    if (!r) return
    const before = { requests, environments, selected, envId }
    removeRequest(id)
    toast.success(`Deleted ${r.name}`, { action: { label: 'Undo', onClick: () => restore(before.requests, before.environments, before.selected, before.envId) } })
  }

  const imported = (added: ApiRequest[], envs: Environment[], message: string) => {
    const before = { requests, environments, selected, envId }
    if (envs.length) setEnvironments([...environments, ...envs], envs[0].id)
    addRequests(added)
    toast.success(message, { action: { label: 'Undo', onClick: () => restore(before.requests, before.environments, before.selected, before.envId) } })
  }

  const grant = (origin: string) => {
    if (!extension) {
      toast.error('The extension isn’t connected', { description: 'Reload this page with the extension installed, then try again.' })
      return
    }
    toast.message(`Allow ${origin} in the window that opened`)
    void grantThroughExtension(origin).then((granted) => {
      if (granted) {
        toast.success(`Allowed ${origin}`, { description: 'Sending it again.' })
        void send('extension')
      } else toast.error(`Not allowed`, { description: `The extension still can’t send to ${origin}.` })
    })
  }

  const addToContract = (x: Exchange & { result: SuccessfulResult }) => {
    if (!HTTP_METHODS.includes(x.sent.method as HttpMethod)) {
      toast.error(`The contract has no ${x.sent.method} endpoints`, { description: 'Only GET, POST, PUT, PATCH and DELETE can be added.' })
      return
    }
    const path = pathOf(x.sent.url)
    const schema = inferSchema([JSON.parse(x.result.body)], pascalCase(resourceName(x.sent.url)))
    const id = uid()
    const added = addSchemaEndpoint(contract, schema, { id, method: x.sent.method as HttpMethod, url: x.sent.url.split('?')[0] })
    // record the status that came back, not the one a new endpoint guesses (201 for every POST)
    const status = x.result.status
    const next = { ...added.contract, endpoints: added.contract.endpoints.map((e) => (e.id === id ? { ...e, responses: e.responses.map((r, i) => (i === 0 ? { ...r, status, description: statusText(status) } : r)) } : e)) }
    const before = contract
    useContract.getState().replace(next, { kind: 'endpoint', id })
    updateRequest(x.requestId, (r) => ({ ...r, endpointId: id }))
    toast.success(`Added ${x.sent.method} ${path} to the API contract`, {
      description: 'Its response is this one’s shape. Open the contract to name it and add the other statuses.',
      action: { label: 'Open it', onClick: () => setModule('contract') },
      cancel: { label: 'Undo', onClick: () => useContract.getState().replace(before) },
    })
  }

  const openInExplorer = (x: Exchange & { result: SuccessfulResult }) => {
    const before = useExplorer.getState()
    const sampleId = newSampleId()
    let text = x.result.body
    try {
      text = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      // already shown as it came
    }
    const method = HTTP_METHODS.includes(x.sent.method as HttpMethod) ? (x.sent.method as HttpMethod) : 'GET'
    // a new response: name its type from the URL, and drop the edits made to the last one's types
    useExplorer.getState().set({
      samples: [{ id: sampleId, name: request?.name || 'Response', text }],
      activeSample: sampleId,
      rootName: pascalCase(resourceName(x.sent.url)),
      overrides: emptyOverrides(),
      method,
      url: x.sent.url.split('?')[0],
    })
    setModule('api-explorer')
    const { samples, activeSample, rootName, overrides, url } = before
    toast.success('Opened the response in the API explorer', {
      description: 'Types, Zod, mock data and a fetch function for it.',
      action: { label: 'Undo', onClick: () => useExplorer.getState().set({ samples, activeSample, rootName, overrides, method: before.method, url }) },
    })
  }

  const exportPostman = () => {
    const name = contract.title || 'Stacksketch requests'
    downloadText(`${name.replace(/[^\w-]+/g, '-').toLowerCase()}.postman_collection.json`, JSON.stringify(toPostmanCollection(name, requests), null, 2) + '\n', 'application/json')
  }

  const showPane = (pane: ClientMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')

  const transportNote =
    transport === 'mock'
      ? `Answers from the API contract (${contract.endpoints.length} endpoints), in this tab`
      : transport === 'browser'
        ? 'Straight from this page: the API must allow it (CORS)'
        : transport === 'extension'
          ? extension
            ? `Extension v${extension.version} connected: no CORS`
            : extension === null
              ? 'Extension not found on this page'
              : 'Looking for the extension…'
          : proxyUp === true
            ? `Proxy running on localhost:${proxyPort}: no CORS`
            : proxyUp === false
              ? `Proxy not running on localhost:${proxyPort}`
              : `Proxy on localhost:${proxyPort}`
  const noteTone =
    (transport === 'extension' && extension === null) || (transport === 'proxy' && proxyUp === false) ? 'text-warn' : transport === 'extension' && extension ? 'text-ok' : transport === 'proxy' && proxyUp ? 'text-ok' : 'text-ink-3'

  return (
    <div className="flex h-full flex-col">
      {/* ---------- how requests are sent ---------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2">
        <span className="text-[12.5px] font-medium text-ink-2">Send with</span>
        <Segmented label="Send with" value={transport} onChange={switchTransport} options={TRANSPORTS} />
        <span className={cx('min-w-0 truncate text-[12px]', noteTone)} title={transportNote}>
          {transportNote}
        </span>
        {transport === 'proxy' ? (
          <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
            Port
            <input
              type="number"
              min={1}
              max={65535}
              value={proxyPort}
              onChange={(e) => {
                set({ proxyPort: Math.max(1, Math.min(65535, Math.round(Number(e.target.value) || 4011))) })
                setProxyUp(null)
              }}
              onBlur={() => void pingProxy(proxyPort).then(setProxyUp)}
              className="h-7 w-16 rounded-md border border-line-strong bg-raised px-2 font-mono text-[12px] text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
            />
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 text-[12px] text-ink-2 max-sm:hidden">
          Timeout (s)
          <input
            type="number"
            min={1}
            max={600}
            value={timeout}
            onChange={(e) => set({ timeout: Math.max(1, Math.min(600, Math.round(Number(e.target.value) || 30))) })}
            className="h-7 w-14 rounded-md border border-line-strong bg-raised px-2 font-mono text-[12px] text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen('help')}>
            <CircleHelp size={13} />
            <span className="max-sm:hidden">How to send without CORS</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen('run')} disabled={!requests.length}>
            <Play size={13} />
            Run all
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'list', label: 'Requests' },
            { value: 'request', label: 'Request' },
            { value: 'response', label: 'Response' },
          ]}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.1fr)_minmax(0,1.18fr)]">
        <Pane
          title="Requests"
          meta={String(requests.length)}
          className={cx(showPane('list'), 'xl:flex')}
          actions={
            <>
              <IconButton label="New request" onClick={newRequest}>
                <Plus size={16} />
              </IconButton>
              <IconButton label="Add requests from cURL, Postman or the API contract" onClick={() => setOpen('import')}>
                <FileInput size={15} />
              </IconButton>
              <IconButton label="Download them as a Postman collection" onClick={exportPostman} disabled={!requests.length}>
                <Download size={15} />
              </IconButton>
            </>
          }
        >
          <div className="absolute inset-0">
            <RequestList
              requests={requests}
              selected={request?.id ?? null}
              onSelect={(id) => set({ selected: id, mobilePane: 'request' })}
              onDuplicate={duplicate}
              onRemove={remove}
              environments={environments}
              envId={envId}
              onPickEnv={(id) => set({ envId: id })}
              onEditEnvs={() => setOpen('envs')}
              lastByRequest={lastByRequest}
            />
          </div>
        </Pane>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', showPane('request'), 'xl:flex')} aria-label="Request">
          {request ? (
            <RequestEditor
              key={request.id}
              request={request}
              onChange={(change) => updateRequest(request.id, change)}
              onSend={() => void send()}
              pending={pending === request.id}
              vars={vars}
              envName={env?.name ?? null}
              contract={contract}
              tab={requestTab}
              setTab={(t) => set({ requestTab: t })}
            />
          ) : (
            <div className="paper-grid flex flex-1 items-center justify-center p-6 text-center">
              <div className="max-w-sm text-[13px] text-ink-2">
                <Send size={20} className="mx-auto mb-2 text-accent" />
                <p>Make requests to your API, check what comes back, and share them with the rest of the team.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={newRequest}>
                    <Plus size={14} /> New request
                  </Button>
                  <Button variant="outline" onClick={() => setOpen('import')}>
                    <FileInput size={14} /> From cURL, Postman or the contract
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className={cx('min-h-0 min-w-0', showPane('response'), 'xl:flex')}>
          {request ? (
            <ResponseView
              request={request}
              exchange={exchange}
              history={history}
              onShow={(id) => showExchange(request.id, id)}
              onClear={() => clearHistory(request.id)}
              contract={contract}
              tab={responseTab}
              setTab={(t) => set({ responseTab: t })}
              transport={transport}
              onSwitchTransport={(t) => {
                switchTransport(t)
                void send(t)
              }}
              onGrant={grant}
              onAddToContract={addToContract}
              onOpenInExplorer={openInExplorer}
              onHelp={() => setOpen('help')}
            />
          ) : (
            <div className="paper-grid h-full w-full bg-panel" />
          )}
        </div>
      </div>

      {open === 'envs' ? <EnvironmentsDialog environments={environments} envId={envId} onSave={setEnvironments} onClose={() => setOpen(null)} /> : null}
      {open === 'import' ? <ImportDialog contract={contract} onImport={imported} onClose={() => setOpen(null)} /> : null}
      {open === 'run' ? (
        <RunnerDialog
          requests={requests}
          environment={env}
          contract={contract}
          send={(r) => transmit(r)}
          onEnvironment={(e) => updateEnvironment(e.id, () => e)}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === 'help' ? <HelpDialog proxyPort={proxyPort} extensionVersion={extension ? extension.version : extension} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
