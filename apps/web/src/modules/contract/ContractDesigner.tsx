import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Braces, Check, Copy, Download, FileUp, Plus, Settings2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import {
  CONTRACT_FILES,
  contractProblems,
  emptyContract,
  functionNames,
  newEndpoint,
  openApiPath,
  resourceGroups,
  toContractClient,
  toContractTypes,
  toContractZod,
  toOpenApi,
  toYaml,
  typeUsage,
  uniqueTypeName,
  updateEndpoint,
  usableContract,
} from '@stacksketch/core'
import type { Contract, ContractEndpoint, ContractProblem } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import type { CodeLang } from '@/components/CodeView'
import { Button, Checkbox, IconButton, Segmented, Tabs } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { Method } from '@/components/Method'
import { sampleContract } from '@/lib/sampleContract'
import { uid, useContract } from '@/store/contract'
import type { ContractMobilePane, ContractOutput, ContractSelection } from '@/store/contract'
import { ContractSettings, EndpointEditor, TypeEditor } from './Editors'
import { FromExplorerDialog } from './FromExplorerDialog'
import { ImportDialog } from './ImportDialog'

const targetKey = (t: ContractProblem['target']) => (t.kind === 'endpoint' ? `endpoint:${t.id}` : t.kind === 'type' ? `type:${t.name}` : 'contract')
const selectionKey = (s: ContractSelection) => targetKey(s)

/* ---------- the list of endpoints and types ---------- */

function NavItem({ current, onClick, children, title, warn }: { current: boolean; onClick: () => void; children: ReactNode; title?: string; warn?: boolean }) {
  return (
    <li>
      <button
        type="button"
        title={title}
        aria-current={current ? 'true' : undefined}
        onClick={onClick}
        className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]', current ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}
      >
        {children}
        {warn ? <TriangleAlert size={12} className="ml-auto shrink-0 text-warn" aria-label="Has problems" /> : null}
      </button>
    </li>
  )
}

function Nav({
  contract,
  selected,
  problemKeys,
  onSelect,
  onAddEndpoint,
  onAddType,
}: {
  contract: Contract
  selected: ContractSelection
  problemKeys: Set<string>
  onSelect: (s: ContractSelection) => void
  onAddEndpoint: () => void
  onAddType: () => void
}) {
  const [dialog, setDialog] = useState<'import' | 'explorer' | null>(null)
  const current = selectionKey(selected)
  return (
    <div className="absolute inset-0 overflow-y-auto px-3 py-3 scrollbar-thin">
      <ul aria-label="Contract">
        <NavItem current={current === 'contract'} onClick={() => onSelect({ kind: 'contract' })} warn={problemKeys.has('contract')} title="Title, version and base URL">
          <Settings2 size={14} className={cx('shrink-0', current === 'contract' ? 'text-accent' : 'text-ink-3')} />
          <span className="truncate font-medium">{contract.title || 'Untitled API'}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{contract.apiVersion}</span>
        </NavItem>
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" onClick={onAddEndpoint}>
          <Plus size={13} />
          Endpoint
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog('explorer')} title="Add the API explorer's response as an endpoint">
          <Braces size={13} />
          From explorer
        </Button>
        <Button variant="outline" size="sm" className="col-span-2" onClick={() => setDialog('import')}>
          <FileUp size={13} />
          Import an OpenAPI file
        </Button>
      </div>
      {dialog === 'import' ? <ImportDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'explorer' ? <FromExplorerDialog onClose={() => setDialog(null)} /> : null}

      {contract.endpoints.length ? (
        resourceGroups(contract).map((g) => (
          <div key={g.name} className="mt-4">
            <p className="flex px-1 pb-1 text-[11.5px] font-medium text-ink-3">
              <span className="truncate">{g.name}</span>
              <span className="ml-auto font-mono text-[10.5px]">{g.endpoints.length}</span>
            </p>
            <ul aria-label={`${g.name} endpoints`} className="space-y-px">
              {g.endpoints.map((e) => (
                <NavItem
                  key={e.id}
                  current={current === `endpoint:${e.id}`}
                  onClick={() => onSelect({ kind: 'endpoint', id: e.id })}
                  warn={problemKeys.has(`endpoint:${e.id}`)}
                  title={e.summary}
                >
                  <Method method={e.method} className="w-11" />
                  <span className="truncate font-mono text-[12px]">{openApiPath(e.path)}</span>
                </NavItem>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="mt-4 px-1 text-[12.5px] text-ink-3">No endpoints yet. Add one, bring in the API explorer's response, or import an OpenAPI file.</p>
      )}

      <div className="mt-5 flex items-center px-1 pb-1">
        <p className="text-[11.5px] font-medium text-ink-3">Types</p>
        <Button variant="ghost" size="sm" className="ml-auto -mr-1 h-6 px-1.5" onClick={onAddType}>
          <Plus size={12} />
          Type
        </Button>
      </div>
      {contract.types.length ? (
        <ul aria-label="Types" className="space-y-px">
          {contract.types.map((t, i) => (
            <NavItem key={`${t.name}:${i}`} current={current === `type:${t.name}`} onClick={() => onSelect({ kind: 'type', name: t.name })} warn={problemKeys.has(`type:${t.name}`)}>
              <span className="truncate font-mono text-[12px] font-medium text-t-ref">{t.name}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{t.fields.length}</span>
            </NavItem>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[12.5px] text-ink-3">Bodies and responses point at types. Add one, or they come with the explorer's response.</p>
      )}
    </div>
  )
}

/* ---------- the code ---------- */

const OUTPUTS: { value: ContractOutput; label: string }[] = [
  { value: 'openapi', label: 'OpenAPI' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'zod', label: 'Zod' },
  { value: 'client', label: 'Client' },
]

function useOutput(contract: Contract, output: ContractOutput, format: 'yaml' | 'json', validate: boolean): { code: string; file: string; lang: CodeLang; what: string } {
  return useMemo(() => {
    switch (output) {
      case 'openapi': {
        const doc = toOpenApi(contract)
        return format === 'yaml'
          ? { code: toYaml(doc), file: 'openapi.yaml', lang: 'yaml', what: 'the OpenAPI file' }
          : { code: JSON.stringify(doc, null, 2) + '\n', file: 'openapi.json', lang: 'json', what: 'the OpenAPI file' }
      }
      case 'ts':
        return { code: toContractTypes(contract), file: CONTRACT_FILES.types, lang: 'ts', what: 'the types' }
      case 'zod':
        return { code: toContractZod(contract), file: CONTRACT_FILES.schema, lang: 'ts', what: 'the Zod schemas' }
      case 'client':
        return { code: toContractClient(contract, { validate }), file: CONTRACT_FILES.client, lang: 'ts', what: 'the client' }
    }
  }, [contract, output, format, validate])
}

/* ---------- the module ---------- */

export default function ContractDesigner() {
  const contract = useContract((s) => s.contract)
  const selected = useContract((s) => s.selected)
  const output = useContract((s) => s.output)
  const format = useContract((s) => s.openApiFormat)
  const validate = useContract((s) => s.validate)
  const mobilePane = useContract((s) => s.mobilePane)
  const set = useContract((s) => s.set)
  const update = useContract((s) => s.update)
  const replace = useContract((s) => s.replace)
  const renameType = useContract((s) => s.renameType)
  const [copied, setCopied] = useState(false)

  const problems = useMemo(() => contractProblems(contract), [contract])
  const problemsByKey = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of problems) map.set(targetKey(p.target), [...(map.get(targetKey(p.target)) ?? []), p.message])
    return map
  }, [problems])
  const names = useMemo(() => functionNames(contract), [contract])
  const leftOut = useMemo(() => usableContract(contract).leftOut, [contract])
  const code = useOutput(contract, output, format, validate)

  const endpoint = selected.kind === 'endpoint' ? contract.endpoints.find((e) => e.id === selected.id) : undefined
  const type = selected.kind === 'type' ? contract.types.find((t) => t.name === selected.name) : undefined
  // something that's gone (an undo, an import) falls back to the contract's settings
  const view: ContractSelection = endpoint ? selected : type ? selected : { kind: 'contract' }

  const select = (s: ContractSelection) => set({ selected: s, mobilePane: 'editor' })
  const undoable = (message: string, before: Contract) => {
    const beforeSelected = useContract.getState().selected
    toast.success(message, { action: { label: 'Undo', onClick: () => replace(before, beforeSelected) } })
  }

  /* ----- endpoints ----- */

  const addEndpoint = () => {
    const taken = new Set(contract.endpoints.map((e) => `${e.method} ${openApiPath(e.path)}`))
    let path = '/resources'
    for (let n = 2; taken.has(`GET ${path}`); n++) path = `/resources-${n}`
    const e = newEndpoint(uid(), 'GET', path)
    update((c) => ({ ...c, endpoints: [...c.endpoints, e] }))
    select({ kind: 'endpoint', id: e.id })
  }

  const duplicateEndpoint = (e: ContractEndpoint) => {
    const copy: ContractEndpoint = { ...structuredClone(e), id: uid(), operationId: undefined, summary: `${e.summary} (copy)` }
    update((c) => {
      const endpoints = [...c.endpoints]
      endpoints.splice(endpoints.findIndex((x) => x.id === e.id) + 1, 0, copy)
      return { ...c, endpoints }
    })
    select({ kind: 'endpoint', id: copy.id })
    toast.success('Duplicated it', { description: 'Change its method or path: two endpoints can’t share both.' })
  }

  const removeEndpoint = (e: ContractEndpoint) => {
    const before = contract
    const i = contract.endpoints.indexOf(e)
    const next = contract.endpoints[i + 1] ?? contract.endpoints[i - 1]
    update((c) => ({ ...c, endpoints: c.endpoints.filter((x) => x.id !== e.id) }))
    set({ selected: next ? { kind: 'endpoint', id: next.id } : { kind: 'contract' } })
    undoable(`Deleted ${e.method} ${openApiPath(e.path)}`, before)
  }

  /* ----- types ----- */

  const addType = () => {
    const name = uniqueTypeName(contract, 'NewType')
    update((c) => ({ ...c, types: [...c.types, { name, fields: [{ key: 'id', shape: { kind: 'string' }, optional: false }] }] }))
    select({ kind: 'type', name })
  }

  const removeType = (name: string) => {
    const before = contract
    update((c) => ({ ...c, types: c.types.filter((t) => t.name !== name) }))
    set({ selected: { kind: 'contract' } })
    undoable(`Deleted ${name}`, before)
  }

  /* ----- code ----- */

  const copy = async () => {
    try {
      await copyText(code.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success(`Copied ${code.what}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the code and copy it by hand.' })
    }
  }

  const describe = (p: ContractProblem) => {
    if (p.target.kind === 'type') return p.target.name
    if (p.target.kind === 'contract') return 'Contract'
    const id = p.target.id
    const e = contract.endpoints.find((x) => x.id === id)
    return e ? `${e.method} ${e.path}` : 'Endpoint'
  }

  const show = (pane: ContractMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')
  const issueCount = problems.length

  let title: ReactNode = 'Contract'
  if (endpoint)
    title = (
      <span className="flex min-w-0 items-center gap-2">
        <Method method={endpoint.method} />
        <span className="truncate font-mono">{openApiPath(endpoint.path)}</span>
      </span>
    )
  else if (type) title = <span className="font-mono text-t-ref">{type.name}</span>

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'list', label: 'Endpoints' },
            { value: 'editor', label: 'Edit' },
            { value: 'code', label: 'Code' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1fr)]">
        <section className={cx('relative min-h-0 min-w-0 flex-col bg-panel', show('list'), 'xl:flex')} aria-label="Endpoints and types">
          <Nav
            contract={contract}
            selected={view}
            problemKeys={new Set(problemsByKey.keys())}
            onSelect={select}
            onAddEndpoint={addEndpoint}
            onAddType={addType}
          />
        </section>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('editor'), 'xl:flex')} aria-label="Editor">
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3.5">
            <h2 className="min-w-0 text-[13px] font-semibold tracking-[-0.005em]">{title}</h2>
            {endpoint ? <span className="truncate text-[12px] text-ink-3 max-sm:hidden">{endpoint.summary}</span> : null}
            {type ? <span className="text-[12px] text-ink-3">type</span> : null}
          </header>
          <div className="relative min-h-0 flex-1">
            {/* keyed so each endpoint or type opens at the top */}
            <div key={selectionKey(view)} className="absolute inset-0 overflow-y-auto scrollbar-thin">
              {endpoint ? (
                <EndpointEditor
                  key={endpoint.id}
                  endpoint={endpoint}
                  contract={contract}
                  functionName={names.get(endpoint.id) ?? ''}
                  problems={problemsByKey.get(`endpoint:${endpoint.id}`) ?? []}
                  change={(fn) => update((c) => updateEndpoint(c, endpoint.id, fn))}
                  onDuplicate={() => duplicateEndpoint(endpoint)}
                  onRemove={() => removeEndpoint(endpoint)}
                />
              ) : type ? (
                <TypeEditor
                  key={type.name}
                  type={type}
                  contract={contract}
                  usage={typeUsage(contract, type.name)}
                  problems={problemsByKey.get(`type:${type.name}`) ?? []}
                  change={(fn) => update((c) => ({ ...c, types: c.types.map((t) => (t.name === type.name ? fn(t) : t)) }))}
                  onRename={(to) => renameType(type.name, to)}
                  onRemove={() => removeType(type.name)}
                />
              ) : (
                <ContractSettings
                  contract={contract}
                  problems={problems}
                  describe={describe}
                  onSelectTarget={(p) => select(p.target)}
                  change={update}
                  onStartOver={() => {
                    const before = contract
                    replace({ ...emptyContract(), title: contract.title, apiVersion: contract.apiVersion, baseUrl: contract.baseUrl })
                    undoable('Emptied the contract', before)
                  }}
                  onDownloadFile={() => downloadText('contract.json', JSON.stringify(contract, null, 2) + '\n', 'application/json')}
                  onLoadSample={() => {
                    const before = contract
                    replace(sampleContract(), { kind: 'endpoint', id: 'ep-list' })
                    undoable('Loaded the sample contract', before)
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('code'), 'xl:flex')} aria-label="Generated code">
          <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
            <div className="min-w-0 flex-1">
              <Tabs label="Output" value={output} onChange={(o) => set({ output: o })} options={OUTPUTS} />
            </div>
            {issueCount ? (
              <button
                type="button"
                onClick={() => select({ kind: 'contract' })}
                title={`${issueCount} ${issueCount === 1 ? 'problem' : 'problems'} to fix. Open the list.`}
                className="mr-1 flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-warn hover:bg-hover"
              >
                <TriangleAlert size={13} />
                {issueCount}
              </button>
            ) : null}
            <IconButton label={`Copy ${code.what}`} onClick={copy}>
              {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
            </IconButton>
            <IconButton label={`Download ${code.file}`} onClick={() => downloadText(code.file, code.code, code.lang === 'json' ? 'application/json' : 'text/plain')}>
              <Download size={15} />
            </IconButton>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2 text-[12.5px] text-ink-3">
            {output === 'openapi' ? (
              <>
                <Segmented
                  label="Format"
                  value={format}
                  onChange={(f) => set({ openApiFormat: f })}
                  options={[
                    { value: 'yaml', label: 'YAML' },
                    { value: 'json', label: 'JSON' },
                  ]}
                />
                <span>OpenAPI 3.1. Bodies are JSON Schema, the same as the explorer's.</span>
              </>
            ) : output === 'client' ? (
              <>
                <Checkbox label="Check responses with Zod" checked={validate} onChange={(v) => set({ validate: v })} />
                <span>
                  Save it next to <span className="font-mono text-ink-2">{validate ? CONTRACT_FILES.schema : CONTRACT_FILES.types}</span>.
                </span>
              </>
            ) : output === 'zod' ? (
              <span>Zod 4, each schema with its inferred type. The client imports it as ./schema.</span>
            ) : (
              <span>Every type, each after the ones it uses.</span>
            )}
            {leftOut.endpoints || leftOut.types ? (
              <span className="flex basis-full items-center gap-1.5 text-warn">
                <TriangleAlert size={13} className="shrink-0" />
                Left out until fixed:{' '}
                {[leftOut.endpoints ? `${leftOut.endpoints} ${leftOut.endpoints === 1 ? 'endpoint' : 'endpoints'}` : '', leftOut.types ? `${leftOut.types} ${leftOut.types === 1 ? 'type' : 'types'}` : '']
                  .filter(Boolean)
                  .join(' and ')}
                .
              </span>
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <CodeView code={code.code} lang={code.lang} label={`Generated ${code.what}`} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
