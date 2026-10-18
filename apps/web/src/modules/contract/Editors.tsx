import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Copy, Download, Plus, RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react'

import { derivedName, hasRequestBody, HTTP_METHODS, isSuccess, openApiPath, statusText, successResponse, syncPathParams } from '@stacksketch/core'
import type { Contract, ContractEndpoint, EndpointMock, ContractParam, ContractProblem, ContractResponse, HttpMethod, ObjectType, ResponseStatus } from '@stacksketch/core'
import { Button, Checkbox, Group, IconButton, Labeled, Select, TextInput, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { ShapePicker } from './ShapePicker'

const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/* ---------- small pieces ---------- */

export function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null
  return (
    <div role="status" className="mx-4 mt-3.5 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
      <p className="flex items-center gap-1.5 font-medium text-warn">
        <TriangleAlert size={13} />
        {problems.length === 1 ? 'One thing to fix' : `${problems.length} things to fix`}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

function TextArea({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string }) {
  return (
    <textarea
      aria-label={label}
      value={value}
      placeholder={placeholder}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputClass, 'h-auto w-full resize-y py-1.5 leading-snug')}
    />
  )
}

/** A bordered card for one param, field or response, with its actions at the top right. */
function Row({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-line bg-raised p-2.5">
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
      <div className="-mt-0.5 -mr-1 flex shrink-0 items-start">{actions}</div>
    </div>
  )
}

/** A status code as typed: `404` or `default`. Keeps its own text so a half-typed code doesn't jump around. */
function StatusInput({ status, onChange, label }: { status: ResponseStatus; onChange: (s: ResponseStatus) => void; label: string }) {
  const [text, setText] = useState(String(status))
  const valid = text === 'default' || /^[1-5]\d\d$/.test(text)
  return (
    <TextInput
      aria-label={label}
      aria-invalid={!valid}
      value={text}
      list="contract-statuses"
      inputMode="numeric"
      onChange={(e) => {
        const v = e.target.value.trim().toLowerCase()
        setText(v)
        if (v === 'default') onChange('default')
        else if (/^[1-5]\d\d$/.test(v)) onChange(Number(v))
      }}
      onBlur={() => setText(String(status))}
      className={cx('w-20 font-mono font-semibold', !valid ? 'border-danger' : isSuccess(status) ? 'text-ok' : status === 'default' ? 'text-ink-2' : 'text-danger')}
    />
  )
}

/** The next response worth adding: a success, then not found, then the body's errors, then everything else. */
function nextStatus(e: ContractEndpoint): ResponseStatus {
  const has = new Set(e.responses.map((r) => r.status))
  const candidates: ResponseStatus[] = [
    e.method === 'POST' ? 201 : e.method === 'DELETE' ? 204 : 200,
    ...(e.params.some((p) => p.in === 'path') ? [404] : []),
    ...(e.body ? [422] : []),
    400,
    401,
    'default',
    500,
  ]
  return candidates.find((s) => !has.has(s)) ?? 503
}

const uniqueName = (base: string, taken: string[]) => {
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base}${n}`
  return name
}

/* ---------- endpoint ---------- */

type EndpointChange = (change: (e: ContractEndpoint) => ContractEndpoint) => void

export function EndpointEditor({
  endpoint: e,
  contract,
  functionName,
  problems,
  change,
  onDuplicate,
  onRemove,
}: {
  endpoint: ContractEndpoint
  contract: Contract
  functionName: string
  problems: string[]
  change: EndpointChange
  onDuplicate: () => void
  onRemove: () => void
}) {
  const types = contract.types.map((t) => t.name)
  const resources = [...new Set(contract.endpoints.map((x) => x.resource.trim()).filter(Boolean))]
  const set = (patch: Partial<ContractEndpoint>) => change((x) => ({ ...x, ...patch }))
  const setParam = (param: ContractParam, patch: Partial<ContractParam>) => change((x) => ({ ...x, params: x.params.map((p) => (p === param ? { ...p, ...patch } : p)) }))
  const setResponse = (i: number, patch: Partial<ContractResponse>) => change((x) => ({ ...x, responses: x.responses.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  const pathParams = e.params.filter((p) => p.in === 'path')
  const query = e.params.filter((p) => p.in === 'query')
  const canSend = hasRequestBody(e.method)
  const setMock = (patch: EndpointMock) =>
    change((x) => {
      const mock = Object.fromEntries(Object.entries({ ...x.mock, ...patch }).filter(([, v]) => v !== undefined)) as EndpointMock
      const { mock: _old, ...rest } = x
      return Object.keys(mock).length ? { ...rest, mock } : rest
    })

  return (
    <>
      <Problems problems={problems} />
      <Group title="Request">
        <div className="flex gap-1.5">
          <Labeled label="Method" className="w-24 shrink-0">
            <Select value={e.method} onChange={(ev) => set({ method: ev.target.value as HttpMethod })} className="w-full font-mono">
              {HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Path" className="flex-1">
            <TextInput value={e.path} onChange={(ev) => change((x) => syncPathParams({ ...x, path: ev.target.value }))} className="w-full font-mono" placeholder="/orders/{orderId}" />
          </Labeled>
        </div>
        <p className="-mt-1.5 text-[11.5px] text-ink-3">
          Put params in braces, <span className="font-mono">{'{orderId}'}</span>, or after a colon, <span className="font-mono">:orderId</span>. The path is relative to the base URL.
        </p>
        <Labeled label="Summary" hint="One line: what it does. It's the doc comment on the function.">
          <TextInput value={e.summary} onChange={(ev) => set({ summary: ev.target.value })} className="w-full" />
        </Labeled>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Resource" hint="Endpoints are grouped by it, and it's the OpenAPI tag.">
            <TextInput value={e.resource} onChange={(ev) => set({ resource: ev.target.value })} list="contract-resources" className="w-full" />
          </Labeled>
          <Labeled label="Function name" hint={e.operationId?.trim() ? 'Also the OpenAPI operationId.' : 'Made from the method and path until you name it.'}>
            <TextInput
              value={e.operationId ?? ''}
              placeholder={derivedName(e)}
              onChange={(ev) => set({ operationId: ev.target.value || undefined })}
              className="w-full font-mono"
            />
          </Labeled>
        </div>
        <datalist id="contract-resources">
          {resources.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Labeled label="Description">
          <TextArea value={e.description ?? ''} onChange={(v) => set({ description: v || undefined })} placeholder="Anything callers should know: limits, side effects, who can call it." />
        </Labeled>
        {functionName !== (e.operationId?.trim() || derivedName(e)) ? (
          <p className="text-[12px] text-ink-3">
            In the client it's <span className="font-mono text-ink-2">{functionName}</span>, since another endpoint already has that name.
          </p>
        ) : null}
      </Group>

      <Group title="Path params">
        {pathParams.length ? (
          pathParams.map((p) => (
            <Row key={p.name} actions={null}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12.5px] font-medium text-ink">{p.name}</span>
                <span className="text-[11.5px] text-ink-3">required, from the path</span>
              </div>
              <ShapePicker shape={p.shape} onChange={(s) => s && setParam(p, { shape: s })} types={types} allowTypes={false} allowList={false} allowNull={false} label={`Type of ${p.name}`} />
              <TextInput aria-label={`Description of ${p.name}`} placeholder="Description" value={p.description ?? ''} onChange={(ev) => setParam(p, { description: ev.target.value || undefined })} className="w-full" />
            </Row>
          ))
        ) : (
          <p className="text-[12.5px] text-ink-3">None. Add one to the path, like {openApiPath(e.path).replace(/\/$/, '') || ''}/{'{id}'}.</p>
        )}
      </Group>

      <Group
        title="Query params"
        aside={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => change((x) => ({ ...x, params: [...x.params, { name: uniqueName('param', x.params.map((p) => p.name)), in: 'query', shape: { kind: 'string' }, required: false }] }))}
          >
            <Plus size={13} />
            Add a query param
          </Button>
        }
      >
        {query.length ? (
          query.map((p, i) => (
            <Row
              key={i}
              actions={
                <IconButton label={`Remove ${p.name || 'this param'}`} onClick={() => change((x) => ({ ...x, params: x.params.filter((q) => q !== p) }))}>
                  <X size={14} />
                </IconButton>
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <TextInput aria-label={`Name of query param ${i + 1}`} value={p.name} onChange={(ev) => setParam(p, { name: ev.target.value.trim() })} className="min-w-0 flex-1 font-mono" />
                <Checkbox label="Required" checked={p.required} onChange={(required) => setParam(p, { required })} />
              </div>
              <ShapePicker shape={p.shape} onChange={(s) => s && setParam(p, { shape: s })} types={types} allowTypes={false} allowNull={false} label={`Type of ${p.name || `query param ${i + 1}`}`} />
              <TextInput aria-label={`Description of ${p.name || `query param ${i + 1}`}`} placeholder="Description" value={p.description ?? ''} onChange={(ev) => setParam(p, { description: ev.target.value || undefined })} className="w-full" />
            </Row>
          ))
        ) : (
          <p className="text-[12.5px] text-ink-3">None. Filters, sorting and paging usually go here.</p>
        )}
      </Group>

      <Group title="Request body">
        {canSend || e.body ? (
          <>
            <ShapePicker
              shape={e.body?.shape}
              noneLabel="No body"
              onChange={(s) => set({ body: s ? { shape: s, required: e.body?.required ?? true } : undefined })}
              types={types}
              allowNull={false}
              label="Request body"
            />
            {e.body ? (
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox label="Callers must send it" checked={e.body.required} onChange={(required) => set({ body: { ...e.body!, required } })} />
                {!canSend ? (
                  <Button variant="outline" size="sm" onClick={() => set({ body: undefined })}>
                    <Trash2 size={13} />
                    Remove the body
                  </Button>
                ) : null}
              </div>
            ) : null}
            {e.body?.shape.kind === 'unknown' ? <p className="text-[12px] text-ink-3">Pick a type to get a typed body in the client.</p> : null}
          </>
        ) : (
          <p className="text-[12.5px] text-ink-3">{e.method} requests don't send a body. Use POST, PUT or PATCH to send one.</p>
        )}
      </Group>

      <Group
        title="Responses"
        aside={
          <Button variant="ghost" size="sm" onClick={() => change((x) => ({ ...x, responses: [...x.responses, { status: nextStatus(x), description: '' }] }))}>
            <Plus size={13} />
            Add a response
          </Button>
        }
      >
        <datalist id="contract-statuses">
          {[200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500, 503].map((s) => (
            <option key={s} value={s}>
              {statusText(s)}
            </option>
          ))}
          <option value="default">Any other status</option>
        </datalist>
        {e.responses.length ? (
          // kept in the order they were added (the exports sort them), so a row never moves while its status is typed
          e.responses.map((r, i) => (
              <Row
                key={i}
                actions={
                  <IconButton label={`Remove the ${r.status} response`} onClick={() => change((x) => ({ ...x, responses: x.responses.filter((_, j) => j !== i) }))}>
                    <X size={14} />
                  </IconButton>
                }
              >
                <div className="flex gap-1.5">
                  <StatusInput status={r.status} onChange={(status) => setResponse(i, { status })} label={`Status of response ${i + 1}`} />
                  <TextInput
                    aria-label={`Description of the ${r.status} response`}
                    value={r.description}
                    placeholder={statusText(r.status)}
                    onChange={(ev) => setResponse(i, { description: ev.target.value })}
                    className="min-w-0 flex-1"
                  />
                </div>
                <ShapePicker shape={r.body} noneLabel="No body" onChange={(body) => setResponse(i, { body })} types={types} label={`Body of the ${r.status} response`} />
              </Row>
          ))
        ) : (
          <p className="text-[12.5px] text-ink-3">Add the response callers get when it works, then the errors.</p>
        )}
        <p className="text-[11.5px] text-ink-3">The client returns the lowest 2xx response's body and throws ApiError with the body of any other status.</p>
      </Group>

      <Group title="Mock server">
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Delay (ms)" hint="Wait before answering, to see loading states.">
            <input
              type="number"
              min={0}
              step={100}
              value={e.mock?.delay ?? ''}
              placeholder="0"
              onChange={(ev) => setMock({ delay: ev.target.value === '' || !Number.isFinite(ev.target.valueAsNumber) ? undefined : Math.max(0, ev.target.valueAsNumber) })}
              className={cx(inputClass, 'w-full font-mono')}
            />
          </Labeled>
          <Labeled label="Answer with" hint="Force an error to build its state.">
            <Select
              value={e.mock?.status === undefined ? '' : String(e.mock.status)}
              onChange={(ev) => setMock({ status: ev.target.value === '' ? undefined : ev.target.value === 'default' ? 'default' : Number(ev.target.value) })}
              className="w-full font-mono"
            >
              <option value="">{successResponse(e)?.status ?? 200} (the success response)</option>
              {[...new Set<ResponseStatus>([...e.responses.map((r) => r.status).filter((s) => !isSuccess(s)), 400, 401, 404, 500, 503])].map((s) => (
                <option key={s} value={String(s)}>
                  {s === 'default' ? 'default (500)' : `${s} ${statusText(s)}`}
                </option>
              ))}
            </Select>
          </Labeled>
        </div>
      </Group>

      <Group title="This endpoint">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy size={13} />
            Duplicate it
          </Button>
          <Button variant="outline" size="sm" onClick={onRemove}>
            <Trash2 size={13} />
            Delete it
          </Button>
        </div>
      </Group>
    </>
  )
}

/* ---------- type ---------- */

/** The type's name. Renames apply on Enter or when the box loses focus, and only when the new name is free. */
function TypeName({ type, taken, onRename }: { type: ObjectType; taken: string[]; onRename: (to: string) => void }) {
  const [text, setText] = useState(type.name)
  const name = text.trim()
  const problem = !TYPE_NAME.test(name)
    ? 'Use letters, digits and underscores, starting with a letter, like OrderItem.'
    : name !== type.name && taken.includes(name)
      ? `There's already a type called ${name}.`
      : null
  const commit = () => {
    if (!problem && name !== type.name) onRename(name)
    else setText(type.name)
  }
  return (
    <Labeled label="Name" hint={problem ?? 'Renaming it updates every endpoint and field that uses it.'}>
      <TextInput
        value={text}
        aria-invalid={Boolean(problem)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setText(type.name)
        }}
        className={cx('w-full font-mono font-medium text-t-ref', problem && 'border-danger')}
      />
    </Labeled>
  )
}

export function TypeEditor({
  type,
  contract,
  usage,
  problems,
  change,
  onRename,
  onRemove,
}: {
  type: ObjectType
  contract: Contract
  usage: string[]
  problems: string[]
  change: (change: (t: ObjectType) => ObjectType) => void
  onRename: (to: string) => void
  onRemove: () => void
}) {
  const types = contract.types.map((t) => t.name)
  const setField = (i: number, patch: Partial<ObjectType['fields'][number]>) => change((t) => ({ ...t, fields: t.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }))
  const move = (i: number, by: number) =>
    change((t) => {
      const fields = [...t.fields]
      const [f] = fields.splice(i, 1)
      fields.splice(i + by, 0, f)
      return { ...t, fields }
    })

  return (
    <>
      <Problems problems={problems} />
      <Group title="Type">
        <TypeName key={type.name} type={type} taken={types} onRename={onRename} />
        <p className="text-[12px] text-ink-3">{usage.length ? <>Used by {usage.join(', ')}.</> : 'Nothing uses it yet. Pick it as a body or a field type.'}</p>
      </Group>
      <Group
        title={`Fields (${type.fields.length})`}
        aside={
          <Button variant="ghost" size="sm" onClick={() => change((t) => ({ ...t, fields: [...t.fields, { key: uniqueName('field', t.fields.map((f) => f.key)), shape: { kind: 'string' }, optional: false }] }))}>
            <Plus size={13} />
            Add a field
          </Button>
        }
      >
        {type.fields.length ? (
          type.fields.map((f, i) => (
            <Row
              key={i}
              actions={
                <>
                  <IconButton label={`Move ${f.key} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton label={`Move ${f.key} down`} disabled={i === type.fields.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} />
                  </IconButton>
                  <IconButton label={`Remove ${f.key}`} onClick={() => change((t) => ({ ...t, fields: t.fields.filter((_, j) => j !== i) }))}>
                    <X size={14} />
                  </IconButton>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <TextInput aria-label={`Name of field ${i + 1}`} value={f.key} onChange={(e) => setField(i, { key: e.target.value })} className="min-w-0 flex-1 font-mono" />
                <Checkbox label="Optional" checked={f.optional} onChange={(optional) => setField(i, { optional })} />
              </div>
              <ShapePicker shape={f.shape} onChange={(s) => s && setField(i, { shape: s })} types={types} label={`Type of ${f.key || `field ${i + 1}`}`} />
            </Row>
          ))
        ) : (
          <p className="text-[12.5px] text-ink-3">No fields yet.</p>
        )}
      </Group>
      <Group title="This type">
        <Button variant="outline" size="sm" onClick={onRemove}>
          <Trash2 size={13} />
          Delete it
        </Button>
        {usage.length ? <p className="text-[12px] text-ink-3">What uses it becomes "any value" until you pick another type.</p> : null}
      </Group>
    </>
  )
}

/* ---------- the contract ---------- */

export function ContractSettings({
  contract,
  problems,
  describe,
  onSelectTarget,
  change,
  onStartOver,
  onLoadSample,
  onDownloadFile,
}: {
  contract: Contract
  problems: ContractProblem[]
  /** where a problem is, in words: "GET /orders", "Order" */
  describe: (p: ContractProblem) => string
  onSelectTarget: (p: ContractProblem) => void
  change: (change: (c: Contract) => Contract) => void
  onStartOver: () => void
  onLoadSample: () => void
  onDownloadFile: () => void
}) {
  const set = (patch: Partial<Contract>) => change((c) => ({ ...c, ...patch }))
  return (
    <>
      <Group title="API">
        <Labeled label="Title">
          <TextInput value={contract.title} onChange={(e) => set({ title: e.target.value })} className="w-full" />
        </Labeled>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)]">
          <Labeled label="Version" hint="The API's own version.">
            <TextInput value={contract.apiVersion} onChange={(e) => set({ apiVersion: e.target.value })} className="w-full font-mono" placeholder="1.0.0" />
          </Labeled>
          <Labeled label="Base URL" hint="Where it lives. Every path is relative to it.">
            <TextInput value={contract.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} className="w-full font-mono" placeholder="https://api.example.com/v1" />
          </Labeled>
        </div>
        <Labeled label="Description">
          <TextArea value={contract.description ?? ''} onChange={(v) => set({ description: v || undefined })} />
        </Labeled>
      </Group>
      <Group title={problems.length ? `Things to fix (${problems.length})` : 'Things to fix'}>
        {problems.length ? (
          <>
            <ul className="space-y-1">
              {problems.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelectTarget(p)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover"
                  >
                    <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                    <span className="min-w-0">
                      <span className="block truncate font-mono font-medium text-ink">{describe(p)}</span>
                      <span className="block text-ink-2">{p.message}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-ink-3">
              Until they're fixed, endpoints and types with problems are left out of the code and the OpenAPI file, so it always compiles. A type that's gone only turns into "any value" where it was used; its endpoints stay in.
            </p>
          </>
        ) : (
          <p className="text-[12.5px] text-ink-3">Nothing. Every endpoint and type makes it into the code.</p>
        )}
      </Group>
      <Group title="Mock server">
        <p className="text-[12.5px] text-ink-2">Serve this contract on your machine, with fake data, delays and forced errors set per endpoint:</p>
        <p className="rounded-md border border-line bg-raised px-2.5 py-1.5 font-mono text-[12px] text-ink">npx stacksketch mock contract.json</p>
        <Button variant="outline" size="sm" onClick={onDownloadFile}>
          <Download size={13} />
          Download contract.json
        </Button>
        <p className="text-[12px] text-ink-3">It also takes the OpenAPI file. Add ?__status=500 or ?__delay=2000 to any request to try an error or a slow answer.</p>
      </Group>
      <Group title="Start again">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onStartOver}>
            <Trash2 size={13} />
            Empty the contract
          </Button>
          <Button variant="outline" size="sm" onClick={onLoadSample}>
            <RotateCcw size={13} />
            Load the sample
          </Button>
        </div>
        <p className="text-[12px] text-ink-3">You can undo either from the message that pops up.</p>
      </Group>
    </>
  )
}
