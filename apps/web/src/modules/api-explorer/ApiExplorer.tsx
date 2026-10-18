import { Suspense, lazy, useDeferredValue, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Decoration, EditorView } from '@codemirror/view'
import { AlignLeft, Braces, Check, ChevronsDownUp, ChevronsUpDown, CircleAlert, Copy, Download, Eraser, FileUp, FlaskConical, Shuffle } from 'lucide-react'
import { toast } from 'sonner'

import { findDeclaration, inferSchema, parseJson, pascalCase, toFetch, toJsonSchema, toMock, toTypeScript, toZod } from '@stacksketch/core'
import type { DeclarationLanguage, HttpMethod, Schema } from '@stacksketch/core'
import { Button, Checkbox, IconButton, Pane, Segmented, Select, Tabs, TextInput, inputClass } from '@/components/ui/primitives'
import { useResolvedTheme } from '@/hooks/useTheme'
import { highlight } from '@/lib/codemirror'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { useExplorer, useFocus } from '@/store/explorer'
import type { MobilePane, OutputTab } from '@/store/explorer'
import { CodeView } from './CodeView'
import type { LineRange } from './CodeView'
import { StructureTree } from './StructureTree'

const SchemaGraph = lazy(() => import('./graph/SchemaGraph'))

const TABS: { value: OutputTab; label: string; file: string; lang: 'ts' | 'json'; what: string; declares?: DeclarationLanguage }[] = [
  { value: 'ts', label: 'TypeScript', file: 'types.ts', lang: 'ts', what: 'TypeScript types', declares: 'typescript' },
  { value: 'zod', label: 'Zod', file: 'schema.ts', lang: 'ts', what: 'Zod schema', declares: 'zod' },
  { value: 'mock', label: 'Mock data', file: 'mock.json', lang: 'json', what: 'mock data' },
  { value: 'fetch', label: 'Fetch', file: 'api.ts', lang: 'ts', what: 'fetch function' },
  { value: 'jsonschema', label: 'JSON Schema', file: 'schema.json', lang: 'json', what: 'JSON Schema', declares: 'jsonschema' },
]

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/* ---------- input ---------- */

function InputPane({ error }: { error: { message: string; line?: number; column?: number } | null }) {
  const input = useExplorer((s) => s.input)
  const rootName = useExplorer((s) => s.rootName)
  const set = useExplorer((s) => s.set)
  const loadSample = useExplorer((s) => s.loadSample)
  const theme = useResolvedTheme()
  const editor = useRef<ReactCodeMirrorRef>(null)
  const file = useRef<HTMLInputElement>(null)
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
    set({ input: JSON.stringify(r.value, null, 2) })
  }

  const openFile = async (f: File | undefined) => {
    if (!f) return
    set({ input: await f.text() })
    toast.success(`Opened ${f.name}`)
  }

  return (
    <Pane
      title="Response"
      meta={input.trim() ? formatBytes(new Blob([input]).size) : undefined}
      actions={
        <>
          <IconButton label="Format JSON" onClick={format}>
            <AlignLeft size={15} />
          </IconButton>
          <IconButton label="Open a .json file" onClick={() => file.current?.click()}>
            <FileUp size={15} />
          </IconButton>
          <IconButton label="Load the sample response" onClick={loadSample}>
            <FlaskConical size={15} />
          </IconButton>
          <IconButton label="Clear" onClick={() => set({ input: '' })} disabled={!input}>
            <Eraser size={15} />
          </IconButton>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void openFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
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
        <div className="min-h-0 flex-1">
          <CodeMirror
            ref={editor}
            value={input}
            onChange={(v) => set({ input: v })}
            height="100%"
            className="h-full"
            theme={theme}
            extensions={extensions}
            placeholder="Paste a JSON response from your API…"
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

function StructurePane({ schema, empty }: { schema: Schema | null; empty: string }) {
  const [mode, setMode] = useState({ openAll: false, n: 0 })
  const view = useExplorer((s) => s.structureView)
  const set = useExplorer((s) => s.set)
  const fields = schema?.types.flatMap((t) => t.fields) ?? []
  const optional = fields.filter((f) => f.optional).length
  return (
    <Pane
      title="Structure"
      meta={
        schema
          ? `${schema.types.length} ${schema.types.length === 1 ? 'type' : 'types'} · ${fields.length} fields${optional ? ` · ${optional} optional` : ''}`
          : undefined
      }
      actions={
        <>
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
          <StructureTree key={mode.n} schema={schema} openAll={mode.openAll} />
        </div>
      )}
    </Pane>
  )
}

/* ---------- generated code ---------- */

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
  if (tab === 'zod') return <p className="text-[12.5px] text-ink-3">Zod 4. Each schema comes with its inferred type, so you can drop types.ts.</p>
  if (tab === 'jsonschema') return <p className="text-[12.5px] text-ink-3">Draft 2020-12, the same format OpenAPI 3.1 uses for bodies.</p>
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

function OutputPane({ schema, empty }: { schema: Schema | null; empty: string }) {
  const s = useExplorer()
  const [copied, setCopied] = useState(false)
  const tab = TABS.find((t) => t.value === s.output) ?? TABS[0]
  const focus = useFocus()

  const code = useMemo(() => {
    if (!schema) return ''
    switch (tab.value) {
      case 'ts':
        return toTypeScript(schema, { style: s.tsStyle, readonly: s.tsReadonly })
      case 'zod':
        return toZod(schema)
      case 'mock':
        return JSON.stringify(toMock(schema, { seed: s.mockSeed, rootCount: s.mockCount }), null, 2) + '\n'
      case 'fetch':
        return toFetch(schema, { method: s.method, url: s.url, validate: s.validate })
      case 'jsonschema':
        return JSON.stringify(toJsonSchema(schema), null, 2) + '\n'
    }
  }, [schema, tab.value, s.tsStyle, s.tsReadonly, s.mockSeed, s.mockCount, s.method, s.url, s.validate])

  const highlight = useMemo<LineRange | null>(() => {
    const at = focus.type && tab.declares ? findDeclaration(code, focus.type, tab.declares) : null
    return at ? { ...at, nonce: focus.nonce } : null
  }, [code, focus.type, focus.nonce, tab.declares])

  const copy = async () => {
    try {
      await copyText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success(`Copied the ${tab.what}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the code and copy it by hand.' })
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-panel">
      <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
        <div className="min-w-0 flex-1">
          <Tabs label="Generated code" value={tab.value} onChange={(output) => s.set({ output })} options={TABS} />
        </div>
        <IconButton label={`Copy the ${tab.what}`} onClick={copy} disabled={!code}>
          {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
        </IconButton>
        <IconButton
          label={`Download ${tab.file}`}
          disabled={!code}
          onClick={() => downloadText(tab.file, code, tab.lang === 'json' ? 'application/json' : 'text/plain')}
        >
          <Download size={15} />
        </IconButton>
      </header>
      {schema ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <OutputToolbar tab={tab.value} rootIsArray={schema.root.kind === 'array'} />
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <CodeView code={code} lang={tab.lang} label={`Generated ${tab.what}`} highlight={highlight} />
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
  const input = useExplorer((s) => s.input)
  const rootName = useExplorer((s) => s.rootName)
  const mobilePane = useExplorer((s) => s.mobilePane)
  const set = useExplorer((s) => s.set)
  const deferred = useDeferredValue(input)

  const parsed = useMemo(() => parseJson(deferred), [deferred])
  const schema = useMemo(() => (parsed.ok ? inferSchema([parsed.value], rootName.trim() || 'Root') : null), [parsed, rootName])
  const error = parsed.ok ? null : parsed
  const empty = !deferred.trim() ? 'Paste a JSON response on the left to see its structure.' : 'Fix the JSON on the left and the structure will show up here.'

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
            { value: 'input', label: 'Response' },
            { value: 'structure', label: 'Structure' },
            { value: 'code', label: 'Code' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.25fr)]">
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('input'), 'xl:flex')}>
          <InputPane error={error && !error.ok ? error : null} />
        </div>
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('structure'), 'xl:flex')}>
          <StructurePane schema={schema} empty={empty} />
        </div>
        <div className={cx('min-h-0 min-w-0 flex-col [&>section]:flex-1', show('code'), 'xl:flex')}>
          <OutputPane schema={schema} empty={empty} />
        </div>
      </div>
    </div>
  )
}
