import { Suspense, lazy, useDeferredValue, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Decoration, EditorView } from '@codemirror/view'
import {
  AlignLeft,
  Braces,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Copy,
  Download,
  Eraser,
  FileDown,
  FileUp,
  FlaskConical,
  Plus,
  RotateCcw,
  Shuffle,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'

import {
  applyOverrides,
  countEdits,
  emptyOverrides,
  findDeclaration,
  parseJson,
  pascalCase,
  toAxios,
  toFetch,
  toGo,
  toJsonSchema,
  toMock,
  toPydantic,
  toQueryHook,
  toTypeScript,
  toValibot,
  toYup,
  toZod,
} from '@stacksketch/core'
import type { DeclarationLanguage, HttpMethod, Schema } from '@stacksketch/core'
import { Button, Checkbox, IconButton, Pane, Segmented, Select, Tabs, TextInput, inputClass } from '@/components/ui/primitives'
import { useResolvedTheme } from '@/hooks/useTheme'
import { highlight } from '@/lib/codemirror'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { activeSampleOf, useExplorer, useFocus } from '@/store/explorer'
import type { BackendLang, Client, MobilePane, OutputTab, Validator } from '@/store/explorer'
import { CodeView } from './CodeView'
import type { CodeLang, LineRange } from './CodeView'
import { ImportDialog } from './ImportDialog'
import type { SampleError } from './inference/inferSamples'
import { useInference } from './inference/useInference'
import { StructureTree } from './StructureTree'

const SchemaGraph = lazy(() => import('./graph/SchemaGraph'))

/** One generated output: what it's called, where it downloads to, and how to find a type in it. */
interface Output {
  /** the tab label, kept short so six tabs fit */
  label: string
  file: string
  lang: CodeLang
  what: string
  declares?: DeclarationLanguage
}

const VALIDATORS: Record<Validator, Output & { note: string }> = {
  zod: { label: 'Zod', file: 'schema.ts', lang: 'ts', what: 'Zod schema', declares: 'zod', note: 'Zod 4. Each schema comes with its inferred type, so you can drop types.ts.' },
  valibot: { label: 'Valibot', file: 'schema.ts', lang: 'ts', what: 'Valibot schema', declares: 'zod', note: 'Valibot 1. Modular, so only the checks you use end up in your bundle.' },
  yup: { label: 'Yup', file: 'schema.ts', lang: 'ts', what: 'Yup schema', declares: 'zod', note: 'Yup 1. Validate with { strict: true } so values are checked, not converted.' },
}
const CLIENTS: Record<Client, Output> = {
  fetch: { label: 'Fetch', file: 'api.ts', lang: 'ts', what: 'fetch function' },
  axios: { label: 'Axios', file: 'api.ts', lang: 'ts', what: 'Axios function' },
  query: { label: 'TanStack', file: 'queries.ts', lang: 'ts', what: 'TanStack Query hook' },
}
const BACKENDS: Record<BackendLang, Output & { note: string }> = {
  pydantic: { label: 'Pydantic', file: 'models.py', lang: 'python', what: 'Pydantic models', declares: 'pydantic', note: 'Pydantic v2. JSON keys that aren’t snake_case stay as aliases.' },
  go: { label: 'Go', file: 'types.go', lang: 'go', what: 'Go structs', declares: 'go', note: 'Nullable fields are pointers; optional ones get omitempty.' },
}

function outputOf(tab: OutputTab, s: { validator: Validator; client: Client; backend: BackendLang }): Output {
  switch (tab) {
    case 'ts':
      return { label: 'TypeScript', file: 'types.ts', lang: 'ts', what: 'TypeScript types', declares: 'typescript' }
    case 'validation':
      return VALIDATORS[s.validator]
    case 'mock':
      return { label: 'Mock', file: 'mock.json', lang: 'json', what: 'mock data' }
    case 'client':
      return CLIENTS[s.client]
    case 'jsonschema':
      return { label: 'JSON Schema', file: 'schema.json', lang: 'json', what: 'JSON Schema', declares: 'jsonschema' }
    case 'backend':
      return BACKENDS[s.backend]
  }
}

const TAB_ORDER: OutputTab[] = ['ts', 'validation', 'mock', 'client', 'jsonschema', 'backend']
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ---------- input ---------- */

function SampleTabs({ errors }: { errors: Record<string, SampleError | null> }) {
  const samples = useExplorer((s) => s.samples)
  const active = useExplorer((s) => s.activeSample)
  const set = useExplorer((s) => s.set)
  const addSample = useExplorer((s) => s.addSample)
  const removeSample = useExplorer((s) => s.removeSample)
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-thin" role="tablist" aria-label="Samples">
        {samples.map((s) => {
          const on = s.id === active
          const bad = Boolean(errors[s.id])
          return (
            <div
              key={s.id}
              className={cx('group flex h-7 shrink-0 items-center rounded-md text-[12.5px]', on ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}
            >
              <button type="button" role="tab" aria-selected={on} onClick={() => set({ activeSample: s.id })} className="flex h-full max-w-48 items-center gap-1.5 pl-2.5">
                {bad ? <span aria-label="has a JSON error" title="This sample isn’t valid JSON, so it’s left out" className="size-1.5 shrink-0 rounded-full bg-danger" /> : null}
                <span className="truncate font-medium">{s.name}</span>
              </button>
              <button
                type="button"
                aria-label={samples.length > 1 ? `Remove ${s.name}` : `Clear ${s.name}`}
                title={samples.length > 1 ? `Remove ${s.name}` : `Clear ${s.name}`}
                onClick={() => removeSample(s.id)}
                className={cx(
                  'mr-0.5 ml-0.5 inline-flex size-5 items-center justify-center rounded text-ink-3 hover:bg-line hover:text-ink focus-visible:opacity-100',
                  on ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
                )}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <IconButton label="Add another sample of the same endpoint: samples merge into one schema" className="size-7" onClick={() => addSample()}>
        <Plus size={15} />
      </IconButton>
    </div>
  )
}

function InputPane({ errors }: { errors: Record<string, SampleError | null> }) {
  const sample = useExplorer(activeSampleOf)
  const samples = useExplorer((s) => s.samples)
  const rootName = useExplorer((s) => s.rootName)
  const set = useExplorer((s) => s.set)
  const setSampleText = useExplorer((s) => s.setSampleText)
  const addSample = useExplorer((s) => s.addSample)
  const loadSample = useExplorer((s) => s.loadSample)
  const theme = useResolvedTheme()
  const editor = useRef<ReactCodeMirrorRef>(null)
  const file = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const input = sample.text
  // errors lag a little behind typing (they come from the deferred samples), so only show one for this text
  const error = errors[sample.id] ?? null
  const errorLine = error?.line

  const extensions = useMemo(
    () => [
      json(),
      highlight,
      EditorView.contentAttributes.of({ 'aria-label': 'JSON response' }),
      ...(errorLine
        ? [
            EditorView.decorations.of((view) => {
              const line = view.state.doc.line(Math.min(errorLine, view.state.doc.lines))
              return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)])
            }),
          ]
        : []),
    ],
    [errorLine],
  )

  const jumpToError = () => {
    const view = editor.current?.view
    if (!view || !error?.line) return
    const line = view.state.doc.line(Math.min(error.line, view.state.doc.lines))
    const pos = Math.min(line.from + (error.column ?? 1) - 1, line.to)
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    view.focus()
  }

  const format = () => {
    const r = parseJson(input)
    if (!r.ok) return toast.error('Fix the JSON first', { description: 'Formatting needs valid JSON.' })
    setSampleText(JSON.stringify(r.value, null, 2))
  }

  const openFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (!files.length) return
    const read = await Promise.all(files.map(async (f) => ({ name: f.name.replace(/\.json$/i, ''), text: await f.text() })))
    if (read.length === 1) setSampleText(read[0].text)
    else addSample(read)
    toast.success(read.length === 1 ? `Opened ${files[0].name}` : `Opened ${read.length} files as samples`)
  }

  return (
    <Pane
      title={samples.length > 1 ? 'Responses' : 'Response'}
      meta={input.trim() ? formatBytes(new Blob([input]).size) : undefined}
      actions={
        <>
          <IconButton label="Format JSON" onClick={format}>
            <AlignLeft size={15} />
          </IconButton>
          <IconButton label="Open .json files (several become separate samples)" onClick={() => file.current?.click()}>
            <FileUp size={15} />
          </IconButton>
          <IconButton label="Import a HAR file or cURL command" onClick={() => setImporting(true)}>
            <FileDown size={15} />
          </IconButton>
          <IconButton label="Load the sample response" onClick={loadSample}>
            <FlaskConical size={15} />
          </IconButton>
          <IconButton label="Clear this sample" onClick={() => setSampleText('')} disabled={!input}>
            <Eraser size={15} />
          </IconButton>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            onChange={(e) => {
              void openFiles(e.target.files)
              e.target.value = ''
            }}
          />
          {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
        </>
      }
      toolbar={
        <label className="flex flex-1 items-center gap-2 text-[12.5px] text-ink-2">
          Type name
          <TextInput
            value={rootName}
            onChange={(e) => set({ rootName: e.target.value })}
            onBlur={() => set({ rootName: pascalCase(rootName || 'Root') })}
            placeholder="Root"
            className="w-full max-w-60 font-mono"
          />
        </label>
      }
    >
      <div className="flex h-full flex-col">
        <SampleTabs errors={errors} />
        <div className="min-h-0 flex-1">
          <CodeMirror
            key={sample.id}
            ref={editor}
            value={input}
            onChange={setSampleText}
            height="100%"
            className="h-full"
            theme={theme}
            extensions={extensions}
            placeholder={samples.length > 1 ? 'Paste another response from the same endpoint…' : 'Paste a JSON response from your API…'}
            basicSetup={{ foldGutter: true, searchKeymap: true, autocompletion: false }}
          />
        </div>
        {error && input.trim() ? (
          <button
            type="button"
            onClick={jumpToError}
            className="flex shrink-0 items-start gap-2 border-t border-line bg-danger-soft px-3.5 py-2 text-left text-[12.5px] text-danger"
          >
            <CircleAlert size={14} className="mt-px shrink-0" />
            <span>
              {error.line ? <span className="font-medium">Line {error.line}, column {error.column}: </span> : null}
              {error.message}
            </span>
          </button>
        ) : null}
      </div>
    </Pane>
  )
}

/* ---------- structure ---------- */

function EmptyState({ text }: { text: string }) {
  return (
    <div className="paper-grid flex h-full items-center justify-center p-6">
      <div className="max-w-64 rounded-lg border border-line bg-raised px-4 py-3 text-center text-[13px] text-ink-2 shadow-pop">
        <Braces size={18} className="mx-auto mb-1.5 text-ink-3" />
        {text}
      </div>
    </div>
  )
}

function StructurePane({ inferred, schema, empty, merged, pending }: { inferred: Schema | null; schema: Schema | null; empty: string; merged: number; pending: boolean }) {
  const [mode, setMode] = useState({ openAll: false, n: 0 })
  const view = useExplorer((s) => s.structureView)
  const overrides = useExplorer((s) => s.overrides)
  const set = useExplorer((s) => s.set)
  const edits = countEdits(overrides)
  const fields = schema?.types.flatMap((t) => t.fields) ?? []
  const optional = fields.filter((f) => f.optional).length
  const resetEdits = () => {
    const before = overrides
    set({ overrides: emptyOverrides() })
    toast.success(`Undid ${edits} ${edits === 1 ? 'edit' : 'edits'}`, { action: { label: 'Bring them back', onClick: () => set({ overrides: before }) } })
  }
  return (
    <Pane
      title="Structure"
      meta={
        pending
          ? 'Reading the samples…'
          : schema
            ? `${schema.types.length} ${schema.types.length === 1 ? 'type' : 'types'} · ${fields.length} fields${optional ? ` · ${optional} optional` : ''}${merged > 1 ? ` · from ${merged} samples` : ''}`
            : undefined
      }
      actions={
        <>
          {edits ? (
            <IconButton label={`Undo all ${edits} schema ${edits === 1 ? 'edit' : 'edits'}`} onClick={resetEdits}>
              <RotateCcw size={14} />
            </IconButton>
          ) : null}
          {schema && view === 'tree' ? (
            <IconButton
              label={mode.openAll ? 'Collapse to two levels' : 'Expand everything'}
              onClick={() => setMode((m) => ({ openAll: !m.openAll, n: m.n + 1 }))}
            >
              {mode.openAll ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
            </IconButton>
          ) : null}
          <Segmented
            label="Structure view"
            className="ml-1"
            value={view}
            onChange={(structureView) => set({ structureView })}
            options={[
              { value: 'tree', label: 'Tree', title: 'Fields as a nested list' },
              { value: 'graph', label: 'Graph', title: 'One card per type, with an edge for each reference' },
            ]}
          />
        </>
      }
    >
      {!schema ? (
        <EmptyState text={empty} />
      ) : view === 'graph' ? (
        <div className="absolute inset-0">
          <Suspense fallback={<div className="paper-grid h-full" />}>
            <SchemaGraph schema={schema} />
          </Suspense>
        </div>
      ) : (
        <div className="absolute inset-0 overflow-auto scrollbar-thin">
          <StructureTree key={mode.n} inferred={inferred ?? schema} schema={schema} openAll={mode.openAll} />
        </div>
      )}
    </Pane>
  )
}

/* ---------- generated code ---------- */

function Note({ children }: { children: string }) {
  return <p className="text-[12.5px] text-ink-3">{children}</p>
}

function OutputToolbar({ tab, rootIsArray }: { tab: OutputTab; rootIsArray: boolean }) {
  const s = useExplorer()
  if (tab === 'ts')
    return (
      <>
        <Segmented
          label="Declaration style"
          value={s.tsStyle}
          onChange={(tsStyle) => s.set({ tsStyle })}
          options={[
            { value: 'interface', label: 'interface' },
            { value: 'type', label: 'type' },
          ]}
        />
        <Checkbox label="readonly" checked={s.tsReadonly} onChange={(tsReadonly) => s.set({ tsReadonly })} />
      </>
    )
  if (tab === 'validation')
    return (
      <>
        <Segmented
          label="Validation library"
          value={s.validator}
          onChange={(validator) => s.set({ validator })}
          options={(Object.keys(VALIDATORS) as Validator[]).map((v) => ({ value: v, label: VALIDATORS[v].label }))}
        />
        <Note>{VALIDATORS[s.validator].note}</Note>
      </>
    )
  if (tab === 'backend')
    return (
      <>
        <Segmented
          label="Language"
          value={s.backend}
          onChange={(backend) => s.set({ backend })}
          options={(Object.keys(BACKENDS) as BackendLang[]).map((v) => ({ value: v, label: BACKENDS[v].label }))}
        />
        <Note>{BACKENDS[s.backend].note}</Note>
      </>
    )
  if (tab === 'jsonschema') return <Note>Draft 2020-12, the same format OpenAPI 3.1 uses for bodies.</Note>
  if (tab === 'mock')
    return (
      <>
        {rootIsArray ? (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            Items
            <input
              type="number"
              min={1}
              max={200}
              value={s.mockCount}
              onChange={(e) => s.set({ mockCount: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
              className={cx(inputClass, 'w-16 font-mono')}
            />
          </label>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => s.set({ mockSeed: s.mockSeed + 1 })}>
          <Shuffle size={13} />
          New data
        </Button>
        <span className="font-mono text-[11.5px] text-ink-3">seed {s.mockSeed}</span>
      </>
    )
  return (
    <>
      <Segmented
        label="HTTP client"
        className="w-full sm:w-auto"
        value={s.client}
        onChange={(client) => s.set({ client })}
        options={(Object.keys(CLIENTS) as Client[]).map((v) => ({ value: v, label: v === 'query' ? 'TanStack Query' : CLIENTS[v].label }))}
      />
      <Select aria-label="HTTP method" value={s.method} onChange={(e) => s.set({ method: e.target.value as HttpMethod })} className="font-mono">
        {METHODS.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </Select>
      <TextInput
        aria-label="Endpoint URL"
        value={s.url}
        onChange={(e) => s.set({ url: e.target.value })}
        placeholder="https://api.example.com/users/:id"
        className="min-w-40 flex-1 font-mono"
      />
      <Checkbox label="Validate with Zod" checked={s.validate} onChange={(validate) => s.set({ validate })} />
    </>
  )
}

type GenOptions = Pick<
  ReturnType<typeof useExplorer.getState>,
  'tsStyle' | 'tsReadonly' | 'validator' | 'mockSeed' | 'mockCount' | 'client' | 'method' | 'url' | 'validate' | 'backend'
>

function generate(schema: Schema, tab: OutputTab, s: GenOptions): string {
  const client = { method: s.method, url: s.url, validate: s.validate }
  switch (tab) {
    case 'ts':
      return toTypeScript(schema, { style: s.tsStyle, readonly: s.tsReadonly })
    case 'validation':
      return s.validator === 'valibot' ? toValibot(schema) : s.validator === 'yup' ? toYup(schema) : toZod(schema)
    case 'mock':
      return JSON.stringify(toMock(schema, { seed: s.mockSeed, rootCount: s.mockCount }), null, 2) + '\n'
    case 'client':
      return s.client === 'axios' ? toAxios(schema, client) : s.client === 'query' ? toQueryHook(schema, client) : toFetch(schema, client)
    case 'jsonschema':
      return JSON.stringify(toJsonSchema(schema), null, 2) + '\n'
    case 'backend':
      return s.backend === 'go' ? toGo(schema) : toPydantic(schema)
  }
}

function OutputPane({ schema, empty }: { schema: Schema | null; empty: string }) {
  const s = useExplorer(useShallow((x) => ({ output: x.output, validator: x.validator, client: x.client, backend: x.backend, set: x.set })))
  const [copied, setCopied] = useState(false)
  const tab = TAB_ORDER.includes(s.output) ? s.output : 'ts'
  const out = outputOf(tab, s)
  const focus = useFocus()

  const options = useExplorer(
    useShallow((x): GenOptions => ({
      tsStyle: x.tsStyle,
      tsReadonly: x.tsReadonly,
      validator: x.validator,
      mockSeed: x.mockSeed,
      mockCount: x.mockCount,
      client: x.client,
      method: x.method,
      url: x.url,
      validate: x.validate,
      backend: x.backend,
    })),
  )
  const code = useMemo(() => (schema ? generate(schema, tab, options) : ''), [schema, tab, options])

  const highlightRange = useMemo<LineRange | null>(() => {
    const at = focus.type && out.declares ? findDeclaration(code, focus.type, out.declares) : null
    return at ? { ...at, nonce: focus.nonce } : null
  }, [code, focus.type, focus.nonce, out.declares])

  const copy = async () => {
    try {
      await copyText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success(`Copied the ${out.what}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the code and copy it by hand.' })
    }
  }

  const tabs = TAB_ORDER.map((t) => ({ value: t, label: outputOf(t, s).label }))

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
        <div className="min-w-0 flex-1">
          <Tabs label="Generated code" value={tab} onChange={(output) => s.set({ output })} options={tabs} />
        </div>
        <IconButton label={`Copy the ${out.what}`} onClick={copy} disabled={!code}>
          {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
        </IconButton>
        <IconButton
          label={`Download ${out.file}`}
          disabled={!code}
          onClick={() => downloadText(out.file, code, out.lang === 'json' ? 'application/json' : 'text/plain')}
        >
          <Download size={15} />
        </IconButton>
      </header>
      {schema ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <OutputToolbar tab={tab} rootIsArray={schema.root.kind === 'array'} />
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <CodeView code={code} lang={out.lang} label={`Generated ${out.what}`} highlight={highlightRange} />
            </div>
          </div>
        </>
      ) : (
        <div className="relative min-h-0 flex-1">
          <EmptyState text={empty} />
        </div>
      )}
    </section>
  )
}

/* ---------- the module ---------- */

export function ApiExplorer() {
  const samples = useExplorer((s) => s.samples)
  const rootName = useExplorer((s) => s.rootName)
  const mobilePane = useExplorer((s) => s.mobilePane)
  const overrides = useExplorer((s) => s.overrides)
  const set = useExplorer((s) => s.set)
  const deferred = useDeferredValue(samples)

  const { schema: inferred, errors, pending } = useInference(deferred, rootName)
  const schema = useMemo(() => (inferred ? applyOverrides(inferred, overrides) : null), [inferred, overrides])
  const filled = deferred.filter((s) => s.text.trim())
  const merged = filled.filter((s) => !errors[s.id]).length
  const empty = !filled.length
    ? 'Paste a JSON response on the left to see its structure.'
    : pending
      ? 'Reading the samples…'
      : 'Fix the JSON on the left and the structure will show up here.'

  const show = (pane: MobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'input', label: samples.length > 1 ? 'Responses' : 'Response' },
            { value: 'structure', label: 'Structure' },
            { value: 'code', label: 'Code' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.25fr)]">
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('input'), 'xl:flex')}>
          <InputPane errors={errors} />
        </div>
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('structure'), 'xl:flex')}>
          <StructurePane inferred={inferred} schema={schema} empty={empty} merged={merged} pending={pending} />
        </div>
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('code'), 'xl:flex')}>
          <OutputPane schema={schema} empty={empty} />
        </div>
      </div>
    </div>
  )
}
