import { useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Copy, Download, FileUp, KeyRound, Link2, RotateCcw, TriangleAlert, Waypoints } from 'lucide-react'
import { toast } from 'sonner'

import {
  dbCrudContract,
  dbProblems,
  emptyContract,
  modelName,
  parseDbml,
  readSchemasketchFile,
  toContractTypes,
  toContractZod,
  toExpressRoutes,
  toNextRoutes,
  toPrisma,
  toSqlMigration,
} from '@stacksketch/core'
import type { DbModel, DbTable, PrismaProvider, SqlDialect } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import type { CodeLang } from '@/components/CodeView'
import { Button, IconButton, Pane, Segmented, Select, Tabs, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { SAMPLE_DB_NAME, SAMPLE_DBML } from '@/lib/sampleDbml'
import { useContract } from '@/store/contract'
import { useDb } from '@/store/db'
import type { DbMobilePane, DbOutput } from '@/store/db'
import { useUi } from '@/store/ui'

const OUTPUTS: { value: DbOutput; label: string }[] = [
  { value: 'prisma', label: 'Prisma' },
  { value: 'sql', label: 'SQL' },
  { value: 'types', label: 'Types' },
  { value: 'express', label: 'Express' },
  { value: 'next', label: 'Next.js' },
]

/* ---------- the tables ---------- */

function TableCard({ table, model }: { table: DbTable; model: DbModel }) {
  const key = table.schema ? `${table.schema}.${table.name}` : table.name
  const fks = new Map(model.refs.filter((r) => r.from.table === key && r.kind !== '<>').flatMap((r) => r.from.columns.map((c) => [c, `${r.to.table}.${r.to.columns.join(', ')}`] as const)))
  const pk = new Set(table.indexes.find((i) => i.pk)?.columns ?? table.columns.filter((c) => c.pk).map((c) => c.name))
  return (
    <section className="rounded-lg border border-line bg-raised" aria-label={`Table ${table.name}`}>
      <header className="flex items-baseline gap-2 border-b border-line px-3 py-2">
        <h3 className="font-mono text-[12.5px] font-semibold text-ink">{table.name}</h3>
        <span className="font-mono text-[11.5px] text-t-ref">{modelName(table.name)}</span>
      </header>
      <ul className="divide-y divide-line">
        {table.columns.map((c) => (
          <li key={c.name} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            {pk.has(c.name) ? <KeyRound size={12} className="shrink-0 text-accent" aria-label="Primary key" /> : <span className="w-3 shrink-0" />}
            <span className="min-w-0 truncate font-mono text-ink">{c.name}</span>
            <span className="truncate font-mono text-t-number">{c.type}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-ink-3">
              {fks.get(c.name) ? (
                <span className="flex items-center gap-1 font-mono" title={`Points at ${fks.get(c.name)}`}>
                  <Link2 size={11} />
                  {fks.get(c.name)}
                </span>
              ) : null}
              {c.unique ? <span>unique</span> : null}
              {c.notNull || pk.has(c.name) ? null : <span>null</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------- the module ---------- */

export default function DbCode() {
  const source = useDb((s) => s.source)
  const name = useDb((s) => s.name)
  const output = useDb((s) => s.output)
  const provider = useDb((s) => s.provider)
  const dialect = useDb((s) => s.dialect)
  const file = useDb((s) => s.file)
  const mobilePane = useDb((s) => s.mobilePane)
  const set = useDb((s) => s.set)
  const replaceContract = useContract((s) => s.replace)
  const setModule = useUi((s) => s.setModule)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const { model, problems } = useMemo(() => parseDbml(source, name), [source, name])
  const notes = useMemo(() => dbProblems(model), [model])
  const crud = useMemo(() => dbCrudContract(model), [model])

  const files = useMemo((): Record<string, { code: string; lang: CodeLang }> => {
    const ts = (code: string) => ({ code, lang: 'ts' as const })
    switch (output) {
      case 'prisma':
        return { 'schema.prisma': { code: toPrisma(model, provider), lang: 'ts' } }
      case 'sql':
        return { 'migration.sql': { code: toSqlMigration(model, dialect), lang: 'sql' } }
      case 'types':
        return { 'types.ts': ts(toContractTypes({ ...emptyContract(), types: crud.contract.types })) }
      case 'express':
      case 'next': {
        const routes = output === 'express' ? toExpressRoutes(model, provider) : toNextRoutes(model, provider)
        return Object.fromEntries([...Object.entries(routes), ['schema.ts', toContractZod(crud.contract)]].map(([k, v]) => [k, ts(v)]))
      }
    }
  }, [output, model, provider, dialect, crud])
  const names = Object.keys(files)
  const current = files[file] ? file : names[0]
  const shown = files[current]

  const open = async (f: File | undefined) => {
    if (!f) return
    const text = await f.text()
    try {
      if (/\.json$/i.test(f.name) || text.trimStart().startsWith('{')) {
        const value: unknown = JSON.parse(text)
        const { model: m } = readSchemasketchFile(value)
        set({ source: (value as { source: string }).source, name: m.name, mobilePane: 'tables' })
      } else set({ source: text, name: f.name.replace(/\.dbml$/i, ''), mobilePane: 'tables' })
      toast.success(`Opened ${f.name}`)
    } catch (e) {
      toast.error('Couldn’t open that file', { description: e instanceof Error ? e.message : String(e) })
    }
  }

  const toContract = () => {
    const { contract: before, selected } = useContract.getState()
    const { contract } = dbCrudContract(model, before.endpoints.length || before.types.length ? before : { ...emptyContract(), title: model.name })
    replaceContract(contract, { kind: 'contract' })
    toast.success(`Added ${model.tables.length} tables to the API contract`, {
      description: 'A type per table, with create and change types, and CRUD endpoints for each table with a single key. Types and routes it already had are kept.',
      action: { label: 'Undo', onClick: () => replaceContract(before, selected) },
    })
  }

  const copy = async () => {
    try {
      await copyText(shown.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success(`Copied ${current}`)
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the code and copy it by hand.' })
    }
  }

  const show = (pane: DbMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')
  const allProblems = [...problems, ...notes]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'input', label: 'DBML' },
            { value: 'tables', label: 'Tables' },
            { value: 'code', label: 'Code' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <Pane
          title="Database"
          meta={name}
          className={cx(show('input'), 'xl:flex')}
          actions={
            <>
              <IconButton label="Open a Schemasketch project or DBML file" onClick={() => input.current?.click()}>
                <FileUp size={15} />
              </IconButton>
              <IconButton label="Load the sample" onClick={() => set({ source: SAMPLE_DBML, name: SAMPLE_DB_NAME })}>
                <RotateCcw size={15} />
              </IconButton>
            </>
          }
        >
          <input ref={input} type="file" accept=".json,.dbml,.txt,application/json" className="hidden" onChange={(e) => void open(e.target.files?.[0])} />
          <div className="absolute inset-0 flex flex-col gap-2 p-3">
            <p className="text-[12px] text-ink-3">
              Paste DBML, or open a Schemasketch project (<span className="font-mono">.schemasketch.json</span>). It’s read here; nothing is uploaded.
            </p>
            <textarea
              aria-label="DBML"
              value={source}
              wrap="off"
              spellCheck={false}
              onChange={(e) => set({ source: e.target.value })}
              className={cx(inputClass, 'h-auto min-h-0 w-full flex-1 resize-none py-2 font-mono text-[12px] leading-relaxed')}
            />
          </div>
        </Pane>

        <Pane
          title="Tables"
          meta={`${model.tables.length} tables, ${model.refs.length} relationships`}
          className={cx(show('tables'), 'xl:flex')}
          actions={
            <Button variant="outline" size="sm" onClick={toContract} disabled={!model.tables.length} title="Add a type per table and CRUD endpoints to the API contract">
              <Waypoints size={13} />
              Add to the API contract
            </Button>
          }
        >
          <div className="absolute inset-0 space-y-3 overflow-y-auto p-3 scrollbar-thin">
            {allProblems.length ? (
              <ul className="space-y-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
                {allProblems.map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            {model.tables.length ? (
              model.tables.map((t) => <TableCard key={`${t.schema}.${t.name}`} table={t} model={model} />)
            ) : (
              <p className="py-8 text-center text-[13px] text-ink-3">No tables yet. Write one like: Table users {'{'} id integer [pk] {'}'}</p>
            )}
            {model.enums.length ? (
              <p className="text-[12px] text-ink-3">
                Enums: {model.enums.map((e) => <span key={e.name} className="mr-2 font-mono text-ink-2">{e.name} ({e.values.join(', ')})</span>)}
              </p>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setModule('contract')}>
              Open the API contract
              <ArrowRight size={13} />
            </Button>
          </div>
        </Pane>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('code'), 'xl:flex')} aria-label="Generated code">
          <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
            <div className="min-w-0 flex-1">
              <Tabs label="Output" value={output} onChange={(o) => set({ output: o })} options={OUTPUTS} />
            </div>
            <IconButton label={`Copy ${current}`} onClick={copy}>
              {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
            </IconButton>
            <IconButton label={`Download ${current}`} onClick={() => downloadText(current.split('/').at(-1) ?? current, shown.code)}>
              <Download size={15} />
            </IconButton>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2 text-[12.5px] text-ink-3">
            {output === 'sql' ? (
              <Segmented<SqlDialect>
                label="Database"
                value={dialect}
                onChange={(d) => set({ dialect: d })}
                options={[
                  { value: 'postgres', label: 'PostgreSQL' },
                  { value: 'mysql', label: 'MySQL' },
                  { value: 'sqlite', label: 'SQLite' },
                ]}
              />
            ) : output !== 'types' ? (
              <Segmented<PrismaProvider>
                label="Database"
                value={provider}
                onChange={(p) => set({ provider: p })}
                options={[
                  { value: 'postgresql', label: 'PostgreSQL' },
                  { value: 'mysql', label: 'MySQL' },
                  { value: 'sqlite', label: 'SQLite' },
                ]}
              />
            ) : null}
            {names.length > 1 ? (
              <Select aria-label="File" value={current} onChange={(e) => set({ file: e.target.value })} className="min-w-0 font-mono">
                {names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </Select>
            ) : null}
            <span className="basis-full">
              {output === 'prisma'
                ? 'Prisma 7: models with @map names, relations on both sides, and the driver adapter in db.ts.'
                : output === 'sql'
                  ? 'A migration for a fresh database: enums, tables, keys and indexes.'
                  : output === 'types'
                    ? 'A type per table as rows come back, plus New… and …Changes for creating and updating.'
                    : 'CRUD handlers that check bodies with schema.ts and use Prisma. Generate the Prisma client first.'}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <CodeView code={shown.code} lang={shown.lang} label={`Generated ${current}`} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
