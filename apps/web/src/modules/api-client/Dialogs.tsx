import { useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleX, CircleMinus, Download, FileUp, LoaderCircle, Play, Plus, Puzzle, Square, Terminal, Trash2 } from 'lucide-react'

import { collectionFromContract, fromPostmanCollection, fromPostmanEnvironment, requestFromCurl, runReport, runRequests } from '@stacksketch/core'
import type { ApiRequest, Contract, Environment, RunStep, SendRequest, SendResult } from '@stacksketch/core'
import { Method } from '@/components/Method'
import { Button, Checkbox, Dialog, Labeled, Segmented, Select, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { downloadText } from '@/lib/download'
import { clientId } from '@/store/client'
import { KeyValueTable } from './KeyValueTable'
import { statusTone } from './lib'
import { proxyOrigin } from './transport'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/* ---------- environments ---------- */

export function EnvironmentsDialog({
  environments,
  envId,
  onSave,
  onClose,
}: {
  environments: Environment[]
  envId: string | null
  onSave: (environments: Environment[], envId: string | null) => void
  onClose: () => void
}) {
  // edit a copy; Save keeps it, closing drops it
  const [draft, setDraft] = useState(environments)
  const [current, setCurrent] = useState(envId ?? environments[0]?.id ?? null)
  const env = draft.find((e) => e.id === current)
  const update = (change: (e: Environment) => Environment) => setDraft((list) => list.map((e) => (e.id === current ? change(e) : e)))
  const add = () => {
    const e: Environment = { id: clientId(), name: `Environment ${draft.length + 1}`, variables: env ? env.variables.map((v) => ({ ...v, value: '' })) : [{ key: 'baseUrl', value: '', enabled: true }] }
    setDraft((list) => [...list, e])
    setCurrent(e.id)
  }
  const remove = () => {
    const rest = draft.filter((e) => e.id !== current)
    setDraft(rest)
    setCurrent(rest[0]?.id ?? null)
  }
  return (
    <Dialog
      title="Environments"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(draft, draft.some((e) => e.id === envId) ? envId : (current ?? null))
              onClose()
            }}
          >
            Save environments
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
        An environment fills the <span className="font-mono">{'{{variables}}'}</span> in your requests: <span className="font-mono">{'{{baseUrl}}'}</span> is localhost in one and staging in another, so the same requests run against either. They’re saved in this browser only.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Environment to edit" value={current ?? ''} onChange={(e) => setCurrent(e.target.value)} className="h-8 min-w-40 flex-1">
          {draft.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus size={13} /> New environment
        </Button>
        {env ? (
          <Button variant="ghost" size="sm" onClick={remove}>
            <Trash2 size={13} /> Delete it
          </Button>
        ) : null}
      </div>
      {env ? (
        <div className="mt-4 space-y-3">
          <Labeled label="Name">
            <TextInput value={env.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} className="h-8 w-full" />
          </Labeled>
          <KeyValueTable rows={env.variables} onChange={(variables) => update((x) => ({ ...x, variables }))} keyLabel="Variable" keyPlaceholder="baseUrl" valuePlaceholder="http://localhost:3000" secret />
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink-3">No environments. Add one to fill {'{{variables}}'}.</p>
      )}
    </Dialog>
  )
}

/* ---------- import ---------- */

type ImportKind = 'curl' | 'postman' | 'contract'

export function ImportDialog({
  contract,
  onImport,
  onClose,
}: {
  contract: Contract
  onImport: (requests: ApiRequest[], environments: Environment[], message: string) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<ImportKind>('curl')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const importCurl = () => {
    try {
      const r = requestFromCurl(text, clientId())
      onImport([r], [], `Added ${r.method} ${r.name}`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const importPostman = (raw: string) => {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      setError('That isn’t valid JSON. Export the collection from Postman as Collection v2.1 and pick the .json file.')
      return
    }
    try {
      if (value && typeof value === 'object' && Array.isArray((value as { values?: unknown }).values)) {
        const env = fromPostmanEnvironment(value, clientId())
        onImport([], [env], `Added the environment “${env.name}”`)
      } else {
        const got = fromPostmanCollection(value, clientId)
        onImport(got.requests, got.environment ? [got.environment] : [], `Imported ${plural(got.requests.length, 'request')} from “${got.name}”${got.skipped.length ? `. ${got.skipped.join(' ')}` : ''}`)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const fromContract = () => {
    const { environment, requests } = collectionFromContract(contract, clientId)
    onImport(requests, [environment], `Added ${plural(requests.length, 'request')} from “${contract.title}”`)
    onClose()
  }

  return (
    <Dialog
      title="Add requests"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {kind === 'curl' ? (
            <Button variant="primary" onClick={importCurl} disabled={!text.trim()}>
              Add the request
            </Button>
          ) : kind === 'postman' ? (
            <Button variant="primary" onClick={() => importPostman(text)} disabled={!text.trim()}>
              Import it
            </Button>
          ) : (
            <Button variant="primary" onClick={fromContract} disabled={!contract.endpoints.length}>
              Add {plural(contract.endpoints.length, 'request')}
            </Button>
          )}
        </>
      }
    >
      <Segmented
        label="From"
        value={kind}
        onChange={(k) => {
          setKind(k)
          setError(null)
        }}
        className="mb-3 w-full"
        options={[
          { value: 'curl', label: 'cURL' },
          { value: 'postman', label: 'Postman' },
          { value: 'contract', label: 'API contract' },
        ]}
      />
      {kind === 'curl' ? (
        <p className="mb-2 text-[13px] text-ink-2">In DevTools, right-click a request in the Network tab and pick Copy → Copy as cURL, or take one from the API’s docs. Pasting it straight into the URL box works too.</p>
      ) : null}
      {kind === 'postman' ? (
        <div className="mb-2 space-y-2 text-[13px] text-ink-2">
          <p>In Postman, open the collection’s menu → Export → Collection v2.1. Environments export the same way. Folders, params, headers, bearer, basic and API key auth, JSON and form bodies, and variables come across; scripts don’t run here.</p>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void f.text().then(importPostman)
              e.target.value = ''
            }}
          />
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            <FileUp size={13} /> Open a .json file
          </Button>
          <p className="text-[12px] text-ink-3">…or paste it below. It’s read in this browser; nothing is uploaded.</p>
        </div>
      ) : null}
      {kind === 'contract' ? (
        <p className="text-[13px] leading-relaxed text-ink-2">
          One request for each of the {contract.endpoints.length} endpoints in “{contract.title}”, each checking its response against the contract, and an environment whose <span className="font-mono">{'{{baseUrl}}'}</span> is{' '}
          <span className="font-mono">{contract.baseUrl || '(empty)'}</span>. Change it to your local server to test what you’re building.
        </p>
      ) : (
        <textarea
          aria-label={kind === 'curl' ? 'cURL command' : 'Postman collection JSON'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          spellCheck={false}
          rows={9}
          placeholder={kind === 'curl' ? "curl 'https://api.example.com/orders' -H 'Authorization: Bearer …'" : '{ "info": { "name": "…" }, "item": [ … ] }'}
          className={cx(inputClass, 'h-auto w-full resize-y py-2 font-mono text-[12px] leading-relaxed')}
        />
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}

/* ---------- collection runner ---------- */

export function RunnerDialog({
  requests,
  environment,
  contract,
  send,
  onEnvironment,
  onClose,
}: {
  requests: ApiRequest[]
  environment: Environment | undefined
  contract: Contract
  send: (r: SendRequest) => Promise<SendResult>
  onEnvironment: (env: Environment) => void
  onClose: () => void
}) {
  const folders = useMemo(() => [...new Set(requests.map((r) => r.folder))].sort(), [requests])
  const [folder, setFolder] = useState<string>('*')
  const [stopOnFailure, setStopOnFailure] = useState(false)
  const [steps, setSteps] = useState<RunStep[]>([])
  const [running, setRunning] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const stop = useRef(false)

  const chosen = requests.filter((r) => (folder === '*' || r.folder === folder) && !skipped.has(r.id))
  const passed = steps.filter((s) => s.pass).length

  const run = async () => {
    stop.current = false
    setSteps([])
    setRunning(true)
    const start: Environment = environment ?? { id: 'none', name: 'No environment', variables: [] }
    const { environment: after } = await runRequests(chosen, start, send, {
      contract,
      stopOnFailure,
      cancelled: () => stop.current,
      onStep: (step) => setSteps((s) => [...s, step]),
    })
    setRunning(false)
    if (environment && after !== start) onEnvironment(after)
  }

  const scope = folder === '*' ? 'all requests' : folder || 'requests without a folder'
  return (
    <Dialog
      title="Run requests in order"
      onClose={() => {
        stop.current = true
        onClose()
      }}
      footer={
        <>
          {steps.length && !running ? (
            <Button variant="outline" onClick={() => downloadText('api-run.md', runReport(`API run: ${scope}`, steps), 'text/markdown')}>
              <Download size={14} /> Download the report
            </Button>
          ) : null}
          {running ? (
            <Button variant="outline" onClick={() => (stop.current = true)}>
              <Square size={13} /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void run()} disabled={!chosen.length}>
              <Play size={14} /> Run {chosen.length} request{chosen.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
        Sends them one after another with the environment <span className="font-medium text-ink">{environment?.name ?? '(none)'}</span>. Values a request saves (a token, a new id) are there for the ones after it, and kept in the environment when the run ends.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Labeled label="Which">
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} className="h-8 min-w-44">
            <option value="*">Every request ({requests.length})</option>
            {folders.map((f) => (
              <option key={f || '(none)'} value={f}>
                {f || 'Not in a folder'} ({requests.filter((r) => r.folder === f).length})
              </option>
            ))}
          </Select>
        </Labeled>
        <Checkbox label="Stop at the first failure" checked={stopOnFailure} onChange={setStopOnFailure} />
        {steps.length ? (
          <span className={cx('ml-auto text-[13px] font-medium', passed === steps.length ? 'text-ok' : 'text-danger')}>
            {passed} of {steps.length} passed{running ? '…' : ''}
          </span>
        ) : null}
      </div>
      <ol className="space-y-1">
        {(folder === '*' ? requests : requests.filter((r) => r.folder === folder)).map((r) => {
          const step = steps.find((s) => s.requestId === r.id)
          const off = skipped.has(r.id)
          const failedChecks = step?.assertions.filter((a) => !a.pass) ?? []
          return (
            <li key={r.id} className={cx('rounded-md border border-line px-2.5 py-1.5', off && 'opacity-50')}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Include ${r.name}`}
                  checked={!off}
                  disabled={running}
                  onChange={(e) =>
                    setSkipped((s) => {
                      const next = new Set(s)
                      if (e.target.checked) next.delete(r.id)
                      else next.add(r.id)
                      return next
                    })
                  }
                  className="size-3.5 accent-[var(--c-accent)]"
                />
                {step ? step.pass ? <CircleCheck size={15} className="shrink-0 text-ok" /> : <CircleX size={15} className="shrink-0 text-danger" /> : running && !off ? <LoaderCircle size={15} className="shrink-0 animate-spin text-ink-3" /> : <CircleMinus size={15} className="shrink-0 text-ink-3" />}
                <Method method={r.method} className="w-12" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.name}</span>
                {step?.result?.ok ? (
                  <span className="shrink-0 font-mono text-[11.5px]">
                    <span className={statusTone(step.result.status)}>{step.result.status}</span> <span className="text-ink-3">{step.result.ms} ms</span>
                  </span>
                ) : null}
              </div>
              {step && !step.pass ? (
                <p className="mt-1 pl-6 text-[12px] break-words text-danger">
                  {step.skipped ?? (step.result && !step.result.ok ? step.result.error : failedChecks.map((a) => `${a.label}${a.detail ? `: ${a.detail}` : ''}`).join(' · '))}
                </p>
              ) : null}
              {step?.captured.length ? <p className="mt-0.5 pl-6 font-mono text-[11.5px] text-ink-3">set {step.captured.map((c) => c.variable).join(', ')}</p> : null}
            </li>
          )
        })}
      </ol>
    </Dialog>
  )
}

/* ---------- how to send without CORS ---------- */

export function HelpDialog({ proxyPort, extensionVersion, onClose }: { proxyPort: number; extensionVersion: string | null | undefined; onClose: () => void }) {
  return (
    <Dialog title="How to send without CORS" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-[13px] leading-relaxed text-ink-2">
        <p>
          A web page can only read answers from APIs that allow it, through CORS. Your local backend usually allows only its own frontend, so a request sent straight from this page is often blocked. There are two ways around it, and both keep everything on your machine:
        </p>
        <section className="rounded-md border border-line bg-raised p-3">
          <h3 className="mb-1.5 flex items-center gap-2 font-semibold text-ink">
            <Puzzle size={15} className="text-accent" /> The browser extension {extensionVersion ? <span className="text-[12px] font-normal text-ok">· connected (v{extensionVersion})</span> : <span className="text-[12px] font-normal text-ink-3">· not connected</span>}
          </h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Build it: <span className="font-mono">pnpm build</span> (it lands in <span className="font-mono">apps/extension/dist</span>).
            </li>
            <li>
              In Chrome, open <span className="font-mono">chrome://extensions</span>, turn on Developer mode, click Load unpacked and pick that folder.
            </li>
            <li>It runs on localhost and stacksketch.netlify.app by default. If this workbench is on another site, open the extension’s side panel here and turn it on for this site.</li>
            <li>Reload this page and pick Extension. localhost APIs work straight away; for any other host the extension asks you once.</li>
          </ol>
          <p className="mt-1.5 text-[12px] text-ink-3">Requests never carry your browser’s cookies. Chrome doesn’t let extensions set Cookie, Origin or Host either; use the proxy for those.</p>
        </section>
        <section className="rounded-md border border-line bg-raised p-3">
          <h3 className="mb-1.5 flex items-center gap-2 font-semibold text-ink">
            <Terminal size={15} className="text-accent" /> stacksketch proxy
          </h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Build the CLI: <span className="font-mono">pnpm build</span>.
            </li>
            <li>
              Run <span className="font-mono">node packages/cli/dist/cli.js proxy</span> (or <span className="font-mono">npx stacksketch proxy</span> once it’s published). It listens on{' '}
              <span className="font-mono">{proxyOrigin(proxyPort)}</span>.
            </li>
            <li>
              If this workbench isn’t stacksketch.netlify.app or localhost:5174, add <span className="font-mono">--allow-origin {location.origin}</span>.
            </li>
            <li>Pick Proxy. Requests go out from Node: no CORS, every header (Cookie included), self-signed certificates with NODE_EXTRA_CA_CERTS.</li>
          </ol>
          <p className="mt-1.5 text-[12px] text-ink-3">It only answers this workbench, and only on 127.0.0.1, so other sites and other machines can’t use it.</p>
        </section>
        <p>
          No backend yet? Pick <span className="font-medium text-ink">Mock</span>: requests are answered from the API contract right here, with the same data as <span className="font-mono">stacksketch mock</span>.
        </p>
      </div>
    </Dialog>
  )
}
