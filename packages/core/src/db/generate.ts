import { camelCase, isIdentifier, pascalCase, singular } from '../names'
import type { Field, ObjectType, Schema, Shape } from '../types'
import { emptyContract, statusText } from '../contract/model'
import type { Contract, ContractEndpoint } from '../contract/types'
import { schemaName } from '../generate/zod'
import type { DbColumn, DbEnum, DbModel, DbRef, DbTable } from './dbml'

/**
 * Code from a database model: shared-schema types, a Prisma schema, SQL
 * migrations, a CRUD contract and route handlers for it.
 */

/* ---------- names ---------- */

const tableKey = (t: DbTable) => (t.schema ? `${t.schema}.${t.name}` : t.name)

/** `order_items` → `OrderItem` */
export function modelName(table: string): string {
  const pascal = pascalCase(table)
  const m = /^(.*?)([A-Z][a-z0-9]*)$/.exec(pascal)
  return m ? m[1] + singular(m[2]) : pascal
}

/** `order_items` → `/order-items` */
const routeOf = (table: string) =>
  '/' +
  table
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()

const fieldKey = (column: string) => camelCase(column)

/* ---------- column types ---------- */

type Base = 'int' | 'bigint' | 'decimal' | 'float' | 'bool' | 'string' | 'text' | 'uuid' | 'datetime' | 'date' | 'time' | 'json' | 'bytes' | 'enum'

interface ColumnKind {
  base: Base
  length?: number
  precision?: number
  scale?: number
  enumName?: string
  array: boolean
}

function kindOf(type: string, enums: DbEnum[]): ColumnKind {
  const array = type.endsWith('[]')
  const t = type.replace(/\[\]$/, '').trim()
  const lower = t.toLowerCase()
  const args = /\(([^)]*)\)/.exec(t)?.[1].split(',').map((x) => Number(x.trim()))
  const bare = lower.replace(/\(.*\)/, '').trim()
  const en = enums.find((e) => e.name === t || `${e.schema}.${e.name}` === t)
  if (en) return { base: 'enum', enumName: en.name, array }
  if (/^(bigint|int8|bigserial)$/.test(bare)) return { base: 'bigint', array }
  if (/^(int|integer|int4|int2|smallint|tinyint|mediumint|serial|smallserial)$/.test(bare)) return { base: 'int', array }
  if (/^(decimal|numeric|money)$/.test(bare)) return { base: 'decimal', precision: args?.[0], scale: args?.[1], array }
  if (/^(float|float4|float8|double|double precision|real)$/.test(bare)) return { base: 'float', array }
  if (/^(bool|boolean)$/.test(bare)) return { base: 'bool', array }
  if (bare === 'uuid') return { base: 'uuid', array }
  if (/^(timestamp|timestamptz|datetime|timestamp with time zone|timestamp without time zone)$/.test(bare)) return { base: 'datetime', array }
  if (bare === 'date') return { base: 'date', array }
  if (/^(time|timetz|time with time zone)$/.test(bare)) return { base: 'time', array }
  if (/^(json|jsonb)$/.test(bare)) return { base: 'json', array }
  if (/^(bytea|blob|binary|varbinary)$/.test(bare)) return { base: 'bytes', array }
  if (/^(text|longtext|mediumtext|clob)$/.test(bare)) return { base: 'text', array }
  if (/^(varchar|character varying|char|character|nvarchar|string)$/.test(bare)) return { base: 'string', length: args?.[0], array }
  return { base: 'string', array }
}

const nullable = (c: DbColumn) => !c.notNull && !c.pk

/** The model with the columns of a composite primary key marked not null, as databases treat them. */
function keyed(model: DbModel): DbModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      const pk = t.indexes.find((i) => i.pk)?.columns ?? []
      return pk.length ? { ...t, columns: t.columns.map((c) => (pk.includes(c.name) ? { ...c, notNull: true } : c)) } : t
    }),
  }
}

/* ---------- shared-schema types ---------- */

function columnShape(c: DbColumn, enums: DbEnum[]): Shape {
  const k = kindOf(c.type, enums)
  const name = c.name.toLowerCase()
  let shape: Shape
  switch (k.base) {
    case 'int':
    case 'bigint':
      shape = { kind: 'number', integer: true }
      break
    case 'decimal':
    case 'float':
      shape = { kind: 'number', integer: false }
      break
    case 'bool':
      shape = { kind: 'boolean' }
      break
    case 'uuid':
      shape = { kind: 'string', format: 'uuid' }
      break
    case 'datetime':
      shape = { kind: 'string', format: 'date-time' }
      break
    case 'date':
      shape = { kind: 'string', format: 'date' }
      break
    case 'json':
      shape = { kind: 'unknown' }
      break
    case 'enum': {
      const values = enums.find((e) => e.name === k.enumName)?.values ?? []
      shape = values.length ? { kind: 'enum', values } : { kind: 'string' }
      break
    }
    default:
      shape = name.includes('email') ? { kind: 'string', format: 'email' } : /(^|_)(url|website|link)$/.test(name) ? { kind: 'string', format: 'uri' } : { kind: 'string' }
  }
  if (k.array) shape = { kind: 'array', items: shape }
  return nullable(c) && shape.kind !== 'unknown' ? { kind: 'union', options: [shape, { kind: 'null' }] } : shape
}

/** Whether the database fills a column in when it's left out: an auto-increment, or a default. */
const generated = (c: DbColumn) => c.increment || c.default !== null

/** One shared-schema type per table, as rows come back (`Customer`). */
export function tablesToTypes(model: DbModel): ObjectType[] {
  model = keyed(model)
  return model.tables.map((t) => ({
    name: modelName(t.name),
    fields: t.columns.map((c): Field => ({ key: fieldKey(c.name), shape: columnShape(c, model.enums), optional: false })),
  }))
}

/** The tables as a shared schema the rest of Stacksketch reads: the root is a list of the first table's rows. */
export function dbToSchema(model: DbModel): Schema {
  const types = tablesToTypes(model)
  return { version: 2, rootName: types[0] ? `${types[0].name}List` : 'Rows', root: types[0] ? { kind: 'array', items: { kind: 'ref', name: types[0].name } } : { kind: 'unknown' }, types }
}

/* ---------- relations ---------- */

interface Relation {
  /** the table holding the foreign key */
  many: { table: DbTable; columns: string[] }
  one: { table: DbTable; columns: string[] }
  kind: 'many-one' | 'one-one' | 'many-many'
  ref: DbRef
}

function relations(model: DbModel): { list: Relation[]; problems: string[] } {
  const byKey = new Map(model.tables.map((t) => [tableKey(t), t]))
  const find = (name: string) => byKey.get(name) ?? model.tables.find((t) => t.name === name)
  const list: Relation[] = []
  const problems: string[] = []
  for (const r of model.refs) {
    const a = find(r.from.table)
    const b = find(r.to.table)
    if (!a || !b) {
      problems.push(`A relationship points at ${a ? r.to.table : r.from.table}, which isn’t a table. It was left out.`)
      continue
    }
    const from = { table: a, columns: r.from.columns }
    const to = { table: b, columns: r.to.columns }
    if (r.kind === '>') list.push({ many: from, one: to, kind: 'many-one', ref: r })
    else if (r.kind === '<') list.push({ many: to, one: from, kind: 'many-one', ref: r })
    else if (r.kind === '-') list.push({ many: from, one: to, kind: 'one-one', ref: r })
    else list.push({ many: from, one: to, kind: 'many-many', ref: r })
  }
  return { list, problems }
}

const pkColumns = (t: DbTable) => {
  const index = t.indexes.find((i) => i.pk)
  return index ? index.columns : t.columns.filter((c) => c.pk).map((c) => c.name)
}

/** Whether a set of columns is already unique (a primary key or a unique column or index). */
const isUnique = (t: DbTable, cols: string[]) => {
  const same = (a: string[]) => a.length === cols.length && a.every((c) => cols.includes(c))
  if (same(pkColumns(t))) return true
  if (cols.length === 1 && t.columns.find((c) => c.name === cols[0])?.unique) return true
  return t.indexes.some((i) => i.unique && same(i.columns))
}

/* ---------- Prisma ---------- */

export type PrismaProvider = 'postgresql' | 'mysql' | 'sqlite'

const PRISMA_ACTION: Record<string, string> = { cascade: 'Cascade', restrict: 'Restrict', 'set null': 'SetNull', 'set default': 'SetDefault', 'no action': 'NoAction' }

function prismaType(k: ColumnKind, provider: PrismaProvider): { type: string; native: string } {
  const pg = provider === 'postgresql'
  const my = provider === 'mysql'
  switch (k.base) {
    case 'int':
      return { type: 'Int', native: '' }
    case 'bigint':
      return { type: 'BigInt', native: '' }
    case 'decimal':
      return { type: 'Decimal', native: (pg || my) && k.precision ? ` @db.Decimal(${k.precision}, ${k.scale ?? 0})` : '' }
    case 'float':
      return { type: 'Float', native: '' }
    case 'bool':
      return { type: 'Boolean', native: '' }
    case 'uuid':
      return { type: 'String', native: pg ? ' @db.Uuid' : my ? ' @db.Char(36)' : '' }
    case 'datetime':
      return { type: 'DateTime', native: '' }
    case 'date':
      return { type: 'DateTime', native: pg || my ? ' @db.Date' : '' }
    case 'time':
      return { type: 'DateTime', native: pg || my ? ' @db.Time' : '' }
    case 'json':
      return { type: 'Json', native: '' }
    case 'bytes':
      return { type: 'Bytes', native: '' }
    case 'enum':
      return { type: provider === 'sqlite' ? 'String' : pascalCase(k.enumName as string), native: '' }
    case 'text':
      return { type: 'String', native: my ? ' @db.Text' : '' }
    default:
      return { type: 'String', native: (pg || my) && k.length ? ` @db.VarChar(${k.length})` : '' }
  }
}

const enumValue = (v: string) => (isIdentifier(v) && !/^\d/.test(v) ? v : `${camelCase(v) || 'value'}`)

function prismaDefault(c: DbColumn, k: ColumnKind, provider: PrismaProvider): string {
  if (c.increment && (k.base === 'int' || k.base === 'bigint')) return ' @default(autoincrement())'
  const d = c.default
  if (!d) return ''
  if (d.kind === 'expression') {
    const v = d.value.toLowerCase().replace(/\s/g, '')
    if (/^(now\(\)|current_timestamp(\(\))?|localtimestamp)$/.test(v)) return ' @default(now())'
    if (/^(gen_random_uuid|uuid_generate_v4|uuid)\(\)$/.test(v)) return ' @default(uuid())'
    return provider === 'sqlite' ? '' : ` @default(dbgenerated(${JSON.stringify(d.value)}))`
  }
  if (d.kind === 'null') return ''
  if (d.kind === 'boolean') return ` @default(${d.value})`
  if (d.kind === 'number') return k.base === 'string' || k.base === 'text' ? ` @default("${d.value}")` : ` @default(${d.value})`
  if (k.base === 'enum' && provider !== 'sqlite') return ` @default(${enumValue(d.value)})`
  if (k.base === 'bool') return ` @default(${d.value === 'true'})`
  if (k.base === 'int' || k.base === 'bigint' || k.base === 'decimal' || k.base === 'float') return Number.isFinite(Number(d.value)) ? ` @default(${d.value})` : ''
  return ` @default(${JSON.stringify(d.value)})`
}

/** A Prisma schema: a model per table, an enum per enum, and relation fields on both sides of every relationship. */
export function toPrisma(model: DbModel, provider: PrismaProvider = 'postgresql'): string {
  model = keyed(model)
  const { list } = relations(model)
  const names = new Map(model.tables.map((t) => [t, modelName(t.name)]))
  const out: string[] = [
    `// Made by Stacksketch from ${model.name}.`,
    '',
    'generator client {\n  provider = "prisma-client"\n  output   = "../src/generated/prisma"\n}',
    '',
    `// Prisma 7 reads the connection URL from prisma.config.ts: datasource: { url: env('DATABASE_URL') }\ndatasource db {\n  provider = "${provider}"\n}`,
  ]

  if (provider !== 'sqlite')
    for (const e of model.enums) {
      const lines = e.values.map((v) => (enumValue(v) === v ? `  ${v}` : `  ${enumValue(v)} @map(${JSON.stringify(v)})`))
      out.push('', `enum ${pascalCase(e.name)} {\n${lines.join('\n')}${pascalCase(e.name) !== e.name ? `\n\n  @@map(${JSON.stringify(e.name)})` : ''}\n}`)
    }

  // how many relationships each pair of models has, to name them when there's more than one (or it's a model pointing at itself)
  const pairCount = new Map<string, number>()
  const pair = (r: Relation) => [names.get(r.many.table), names.get(r.one.table)].sort().join(':')
  for (const r of list) pairCount.set(pair(r), (pairCount.get(pair(r)) ?? 0) + 1)
  const extra = new Map<DbTable, string[]>()
  const add = (t: DbTable, line: string) => extra.set(t, [...(extra.get(t) ?? []), line])
  // columns that relationships point at must be unique in Prisma
  const mustBeUnique = new Map<DbTable, string[][]>()

  for (const r of list) {
    const many = names.get(r.many.table) as string
    const one = names.get(r.one.table) as string
    const taken = (t: DbTable) => new Set([...t.columns.map((c) => fieldKey(c.name)), ...(extra.get(t) ?? []).map((l) => l.trim().split(/\s+/)[0])])
    const unique = (t: DbTable, base: string) => {
      const used = taken(t)
      let name = base
      for (let n = 2; used.has(name); n++) name = `${base}${n}`
      return name
    }
    const fk = r.many.columns.map(fieldKey)
    const named = (pairCount.get(pair(r)) ?? 0) > 1 || many === one
    if (r.kind === 'many-many') {
      const relName = named ? ` @relation(${JSON.stringify(`${many}${one}`)})` : ''
      add(r.many.table, `  ${unique(r.many.table, camelCase(r.one.table.name))} ${one}[]${relName}`)
      add(r.one.table, `  ${unique(r.one.table, camelCase(r.many.table.name))} ${many}[]${relName}`)
      continue
    }
    const base = r.many.columns.length === 1 ? camelCase(r.many.columns[0].replace(/_?id$/i, '')) || camelCase(one) : camelCase(one)
    const field = unique(r.many.table, base === fk[0] ? camelCase(one) : base)
    const relName = named ? `${many}${pascalCase(field)}` : ''
    const optional = r.many.columns.some((c) => {
      const col = r.many.table.columns.find((x) => x.name === c)
      return !col || nullable(col)
    })
    const actions = [
      r.ref.onDelete && PRISMA_ACTION[r.ref.onDelete.toLowerCase()] ? `, onDelete: ${PRISMA_ACTION[r.ref.onDelete.toLowerCase()]}` : '',
      r.ref.onUpdate && PRISMA_ACTION[r.ref.onUpdate.toLowerCase()] ? `, onUpdate: ${PRISMA_ACTION[r.ref.onUpdate.toLowerCase()]}` : '',
    ].join('')
    add(
      r.many.table,
      `  ${field} ${one}${optional ? '?' : ''} @relation(${relName ? `${JSON.stringify(relName)}, ` : ''}fields: [${fk.join(', ')}], references: [${r.one.columns.map(fieldKey).join(', ')}]${actions})`,
    )
    const back = r.kind === 'one-one' ? `${many}?` : `${many}[]`
    const backBase = r.kind === 'one-one' ? camelCase(r.many.table.name.replace(/s$/, '')) : camelCase(r.many.table.name)
    add(r.one.table, `  ${unique(r.one.table, named ? `${field}${pascalCase(r.many.table.name)}` : backBase)} ${back}${relName ? ` @relation(${JSON.stringify(relName)})` : ''}`)
    if (!isUnique(r.one.table, r.one.columns)) mustBeUnique.set(r.one.table, [...(mustBeUnique.get(r.one.table) ?? []), r.one.columns])
    if (r.kind === 'one-one' && !isUnique(r.many.table, r.many.columns)) mustBeUnique.set(r.many.table, [...(mustBeUnique.get(r.many.table) ?? []), r.many.columns])
  }

  for (const t of model.tables) {
    const name = names.get(t) as string
    const pk = pkColumns(t)
    const uniques = mustBeUnique.get(t) ?? []
    const lines = t.columns.map((c) => {
      const k = kindOf(c.type, model.enums)
      const { type, native } = prismaType(k, provider)
      const list = k.array && provider === 'postgresql'
      const attrs = [
        pk.length === 1 && pk[0] === c.name ? ' @id' : '',
        prismaDefault(c, k, provider),
        (c.unique || uniques.some((u) => u.length === 1 && u[0] === c.name)) && !(pk.length === 1 && pk[0] === c.name) ? ' @unique' : '',
        fieldKey(c.name) !== c.name ? ` @map(${JSON.stringify(c.name)})` : '',
        native,
      ].join('')
      return `  ${fieldKey(c.name)} ${list ? `${type}[]` : k.array ? 'Json' : type}${!list && nullable(c) ? '?' : ''}${attrs}`
    })
    const blocks = [lines.join('\n')]
    if (extra.get(t)?.length) blocks.push((extra.get(t) as string[]).join('\n'))
    const footer: string[] = []
    if (pk.length > 1) footer.push(`  @@id([${pk.map(fieldKey).join(', ')}])`)
    for (const i of t.indexes.filter((x) => !x.pk && x.columns.every((c) => !c.startsWith('`')))) {
      if (i.unique && i.columns.length === 1) continue
      footer.push(`  @@${i.unique ? 'unique' : 'index'}([${i.columns.map(fieldKey).join(', ')}])`)
    }
    for (const u of uniques.filter((u) => u.length > 1)) footer.push(`  @@unique([${u.map(fieldKey).join(', ')}])`)
    for (const i of t.indexes.filter((x) => x.unique && x.columns.length === 1 && !t.columns.find((c) => c.name === x.columns[0])?.unique)) footer.push(`  @@unique([${fieldKey(i.columns[0])}])`)
    if (!pk.length && !t.columns.some((c) => c.unique) && !t.indexes.some((i) => i.unique) && !uniques.length) footer.push('  // no primary key or unique column, so Prisma Client leaves this table out', '  @@ignore')
    if (name !== t.name) footer.push(`  @@map(${JSON.stringify(t.name)})`)
    if (footer.length) blocks.push(footer.join('\n'))
    out.push('', `${t.note ? `/// ${t.note.replace(/\n/g, ' ')}\n` : ''}model ${name} {\n${blocks.join('\n\n')}\n}`)
  }
  return out.join('\n') + '\n'
}

/* ---------- SQL ---------- */

export type SqlDialect = 'postgres' | 'mysql' | 'sqlite'

const quoteFor = (d: SqlDialect) => (name: string) => (d === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`)
const str = (s: string) => `'${s.replace(/'/g, "''")}'`

function sqlDefault(c: DbColumn, d: SqlDialect): string {
  const v = c.default
  if (!v) return ''
  if (v.kind === 'expression') {
    const e = v.value.trim()
    const lower = e.toLowerCase().replace(/\s/g, '')
    if (/^(now\(\)|current_timestamp(\(\))?)$/.test(lower)) return ' DEFAULT CURRENT_TIMESTAMP'
    if (/^(gen_random_uuid|uuid_generate_v4)\(\)$/.test(lower)) return d === 'postgres' ? ' DEFAULT gen_random_uuid()' : d === 'mysql' ? ' DEFAULT (uuid())' : " DEFAULT (lower(hex(randomblob(16))))"
    return ` DEFAULT (${e})`
  }
  if (v.kind === 'string') return ` DEFAULT ${str(v.value)}`
  if (v.kind === 'boolean') return d === 'sqlite' ? ` DEFAULT ${v.value === 'true' ? 1 : 0}` : ` DEFAULT ${v.value.toUpperCase()}`
  if (v.kind === 'null') return ' DEFAULT NULL'
  return ` DEFAULT ${v.value}`
}

function sqlType(c: DbColumn, k: ColumnKind, d: SqlDialect, q: (s: string) => string, enums: DbEnum[]): string {
  if (k.base === 'enum') {
    const values = (enums.find((e) => e.name === k.enumName)?.values ?? []).map(str).join(', ')
    if (d === 'postgres') return q(k.enumName as string) + (k.array ? '[]' : '')
    if (d === 'mysql') return `ENUM(${values})`
    return `TEXT CHECK (${q(c.name)} IN (${values}))`
  }
  if (k.array && d !== 'postgres') return d === 'mysql' ? 'JSON' : 'TEXT'
  const raw = c.type
  if (d === 'postgres') return k.base === 'datetime' && /^datetime$/i.test(raw) ? 'timestamp' : raw
  if (d === 'mysql') {
    if (k.base === 'uuid') return 'CHAR(36)'
    if (k.base === 'datetime') return 'DATETIME'
    if (k.base === 'json') return 'JSON'
    if (k.base === 'bool') return 'BOOLEAN'
    if (k.base === 'string' && !k.length) return /^(varchar|character varying)$/i.test(raw) ? 'VARCHAR(255)' : raw
    if (k.base === 'bytes') return 'BLOB'
    return raw
  }
  // SQLite keeps any type name, by affinity
  if (k.base === 'uuid' || k.base === 'json') return 'TEXT'
  if (k.base === 'bool') return 'INTEGER'
  return raw
}

/** A migration that creates every enum, table, key and index, for a fresh database. */
export function toSqlMigration(model: DbModel, dialect: SqlDialect = 'postgres'): string {
  model = keyed(model)
  const q = quoteFor(dialect)
  const { list } = relations(model)
  const tableName = (t: DbTable) => (t.schema && dialect === 'postgres' ? `${q(t.schema)}.${q(t.name)}` : q(t.name))
  const out: string[] = [`-- Made by Stacksketch from ${model.name}, for ${dialect === 'postgres' ? 'PostgreSQL' : dialect === 'mysql' ? 'MySQL' : 'SQLite'}.`]
  if (dialect === 'postgres') {
    for (const s of [...new Set(model.tables.map((t) => t.schema).filter((x): x is string => Boolean(x && x !== 'public')))]) out.push(`CREATE SCHEMA IF NOT EXISTS ${q(s)};`)
    for (const e of model.enums) out.push(`CREATE TYPE ${q(e.name)} AS ENUM (${e.values.map(str).join(', ')});`)
  }
  const mustBeUnique = new Map<DbTable, string[][]>()
  for (const r of list) if (r.kind !== 'many-many' && !isUnique(r.one.table, r.one.columns)) mustBeUnique.set(r.one.table, [...(mustBeUnique.get(r.one.table) ?? []), r.one.columns])
  const fk = (r: Relation) =>
    `FOREIGN KEY (${r.many.columns.map(q).join(', ')}) REFERENCES ${tableName(r.one.table)} (${r.one.columns.map(q).join(', ')})${r.ref.onDelete ? ` ON DELETE ${r.ref.onDelete.toUpperCase()}` : ''}${r.ref.onUpdate ? ` ON UPDATE ${r.ref.onUpdate.toUpperCase()}` : ''}`

  for (const t of model.tables) {
    const pk = pkColumns(t)
    const lines = t.columns.map((c) => {
      const k = kindOf(c.type, model.enums)
      let type = sqlType(c, k, dialect, q, model.enums)
      let auto = ''
      if (c.increment) {
        if (dialect === 'postgres') auto = ' GENERATED BY DEFAULT AS IDENTITY'
        else if (dialect === 'mysql') auto = ' AUTO_INCREMENT'
        else if (pk.length === 1 && pk[0] === c.name) {
          type = 'INTEGER'
          auto = ' PRIMARY KEY AUTOINCREMENT'
        }
      }
      return `  ${q(c.name)} ${type}${c.notNull || c.pk ? ' NOT NULL' : ''}${auto}${sqlDefault(c, dialect)}${c.unique ? ' UNIQUE' : ''}`
    })
    const sqliteInlinePk = dialect === 'sqlite' && t.columns.some((c) => c.increment && pk.length === 1 && pk[0] === c.name)
    if (pk.length && !sqliteInlinePk) lines.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`)
    for (const i of t.indexes.filter((x) => x.unique && !x.pk && x.columns.every((c) => !c.startsWith('`')))) lines.push(`  UNIQUE (${i.columns.map(q).join(', ')})`)
    for (const u of mustBeUnique.get(t) ?? []) lines.push(`  UNIQUE (${u.map(q).join(', ')})`)
    // SQLite can't add foreign keys later, so they go in the table
    if (dialect === 'sqlite') for (const r of list.filter((x) => x.kind !== 'many-many' && x.many.table === t)) lines.push(`  ${fk(r)}`)
    out.push('', `CREATE TABLE ${tableName(t)} (\n${lines.join(',\n')}\n);`)
    for (const i of t.indexes.filter((x) => !x.unique && !x.pk)) {
      const cols = i.columns.map((c) => (c.startsWith('`') ? `(${c.slice(1, -1)})` : q(c))).join(', ')
      out.push(`CREATE INDEX ${q(i.name ?? `${t.name}_${i.columns.join('_').replace(/\W+/g, '_')}_idx`)} ON ${tableName(t)} (${cols});`)
    }
  }

  // many-to-many relationships become a join table
  for (const r of list.filter((x) => x.kind === 'many-many')) {
    const a = r.many
    const b = r.one
    const col = (t: DbTable, c: string) => `${singular(t.name)}_${c}`
    const typeOf = (t: DbTable, c: string) => {
      const column = t.columns.find((x) => x.name === c)
      const k = column ? kindOf(column.type, model.enums) : { base: 'int' as const, array: false }
      return k.base === 'bigint' ? 'BIGINT' : k.base === 'int' ? 'INTEGER' : column ? sqlType(column, k, dialect, q, model.enums) : 'INTEGER'
    }
    const cols = [...a.columns.map((c) => [col(a.table, c), typeOf(a.table, c)]), ...b.columns.map((c) => [col(b.table, c), typeOf(b.table, c)])]
    const lines = [
      ...cols.map(([n, t]) => `  ${q(n)} ${t} NOT NULL`),
      `  PRIMARY KEY (${cols.map(([n]) => q(n)).join(', ')})`,
      `  FOREIGN KEY (${a.columns.map((c) => q(col(a.table, c))).join(', ')}) REFERENCES ${tableName(a.table)} (${a.columns.map(q).join(', ')}) ON DELETE CASCADE`,
      `  FOREIGN KEY (${b.columns.map((c) => q(col(b.table, c))).join(', ')}) REFERENCES ${tableName(b.table)} (${b.columns.map(q).join(', ')}) ON DELETE CASCADE`,
    ]
    out.push('', `-- ${a.table.name} <> ${b.table.name}`, `CREATE TABLE ${q(`${a.table.name}_${b.table.name}`)} (\n${lines.join(',\n')}\n);`)
  }

  if (dialect !== 'sqlite') {
    const fks = list.filter((x) => x.kind !== 'many-many')
    if (fks.length) out.push('')
    for (const r of fks) {
      const name = `${r.many.table.name}_${r.many.columns.join('_')}_fkey`
      out.push(`ALTER TABLE ${tableName(r.many.table)} ADD CONSTRAINT ${q(name)} ${fk(r)};`)
    }
  }
  return out.join('\n') + '\n'
}

/* ---------- CRUD ---------- */

interface Crud {
  table: DbTable
  model: string
  route: string
  pk: DbColumn
  newType: string
  changesType: string
}

/** Tables with a single-column primary key get CRUD endpoints; the others are listed as skipped. */
function cruds(model: DbModel): { list: Crud[]; skipped: string[] } {
  const list: Crud[] = []
  const skipped: string[] = []
  for (const t of model.tables) {
    const pk = pkColumns(t)
    const col = pk.length === 1 ? t.columns.find((c) => c.name === pk[0]) : undefined
    if (!col) {
      skipped.push(`${t.name} has ${pk.length ? 'a composite primary key' : 'no primary key'}, so it gets a type but no endpoints.`)
      continue
    }
    const m = modelName(t.name)
    list.push({ table: t, model: m, route: routeOf(t.name), pk: col, newType: `New${m}`, changesType: `${m}Changes` })
  }
  return { list, skipped }
}

/**
 * The tables as an API contract: a type per table plus `New…` (what a create
 * sends: columns the database fills in are optional) and `…Changes` (every
 * column optional, for PATCH), and list, create, get, update and delete
 * endpoints for each table with a single-column primary key.
 */
export function dbCrudContract(model: DbModel, base: Contract = emptyContract()): { contract: Contract; skipped: string[] } {
  model = keyed(model)
  const rows = tablesToTypes(model)
  const { list, skipped } = cruds(model)
  const problem: ObjectType = {
    name: 'Problem',
    fields: [
      { key: 'message', shape: { kind: 'string' }, optional: false },
      { key: 'details', shape: { kind: 'array', items: { kind: 'string' } }, optional: true },
    ],
  }
  const types: ObjectType[] = [...rows, problem]
  const endpoints: ContractEndpoint[] = []
  for (const c of list) {
    const row = rows.find((t) => t.name === c.model) as ObjectType
    const writable = c.table.columns.filter((col) => !(col.pk && col.increment))
    types.push({
      name: c.newType,
      fields: writable.map((col) => ({ key: fieldKey(col.name), shape: row.fields.find((f) => f.key === fieldKey(col.name))!.shape, optional: generated(col) || nullable(col) })),
    })
    types.push({ name: c.changesType, fields: writable.filter((col) => !col.pk).map((col) => ({ key: fieldKey(col.name), shape: row.fields.find((f) => f.key === fieldKey(col.name))!.shape, optional: true })) })
    const resource = c.table.name.replace(/[_-]+/g, ' ').replace(/^./, (x) => x.toUpperCase())
    const idShape = columnShape({ ...c.pk, notNull: true }, model.enums)
    const id = `${camelCase(c.model)}Id`
    const ref = (name: string): Shape => ({ kind: 'ref', name })
    const problemBody = ref('Problem')
    const item = `${c.route}/{${id}}`
    const idParam = { name: id, in: 'path' as const, shape: idShape, required: true }
    const one = singular(resource.toLowerCase())
    endpoints.push(
      {
        id: `${c.model}-list`,
        method: 'GET',
        path: c.route,
        summary: `List ${resource.toLowerCase()}`,
        resource,
        params: [
          { name: 'limit', in: 'query', shape: { kind: 'number', integer: true, min: 1, max: 200 }, required: false, description: 'At most this many, 50 by default' },
          { name: 'offset', in: 'query', shape: { kind: 'number', integer: true, min: 0 }, required: false, description: 'Skip this many first' },
        ],
        responses: [{ status: 200, description: statusText(200), body: { kind: 'array', items: ref(c.model) } }],
      },
      {
        id: `${c.model}-create`,
        method: 'POST',
        path: c.route,
        summary: `Create ${one}`,
        resource,
        params: [],
        body: { shape: ref(c.newType), required: true },
        responses: [
          { status: 201, description: statusText(201), body: ref(c.model) },
          { status: 422, description: 'The body has errors', body: problemBody },
        ],
      },
      {
        id: `${c.model}-get`,
        method: 'GET',
        path: item,
        summary: `Get ${one}`,
        resource,
        params: [idParam],
        responses: [
          { status: 200, description: statusText(200), body: ref(c.model) },
          { status: 404, description: statusText(404), body: problemBody },
        ],
      },
      {
        id: `${c.model}-update`,
        method: 'PATCH',
        path: item,
        summary: `Update ${one}`,
        resource,
        params: [idParam],
        body: { shape: ref(c.changesType), required: true },
        responses: [
          { status: 200, description: statusText(200), body: ref(c.model) },
          { status: 404, description: statusText(404), body: problemBody },
          { status: 422, description: 'The body has errors', body: problemBody },
        ],
      },
      {
        id: `${c.model}-delete`,
        method: 'DELETE',
        path: item,
        summary: `Delete ${one}`,
        resource,
        params: [idParam],
        responses: [
          { status: 204, description: statusText(204) },
          { status: 404, description: statusText(404), body: problemBody },
        ],
      },
    )
  }
  // keep what the base contract had; types it already has (by name) win
  const have = new Set(base.types.map((t) => t.name))
  const routes = new Set(base.endpoints.map((e) => `${e.method} ${e.path}`))
  return {
    contract: {
      ...base,
      title: base.endpoints.length || base.types.length ? base.title : model.name,
      types: [...base.types, ...types.filter((t) => !have.has(t.name))],
      endpoints: [...base.endpoints, ...endpoints.filter((e) => !routes.has(`${e.method} ${e.path}`))],
    },
    skipped,
  }
}

/* ---------- route handlers ---------- */

const idExpr = (c: Crud, raw: string) => {
  const k = c.pk.type.toLowerCase()
  return /int|serial/.test(k) ? (/big/.test(k) ? `BigInt(${raw})` : `Number(${raw})`) : raw
}

const ADAPTER: Record<PrismaProvider, [string, string, string]> = {
  postgresql: ['@prisma/adapter-pg', 'PrismaPg', '{ connectionString: process.env.DATABASE_URL }'],
  mysql: ['@prisma/adapter-mariadb', 'PrismaMariaDb', 'process.env.DATABASE_URL as string'],
  sqlite: ['@prisma/adapter-better-sqlite3', 'PrismaBetterSqlite3', "{ url: process.env.DATABASE_URL ?? 'file:./dev.db' }"],
}

/** One Prisma 7 client for the whole app, through the driver adapter for the database. */
const dbFile = (provider: PrismaProvider) => {
  const [pkg, name, args] = ADAPTER[provider]
  return `import { ${name} } from '${pkg}'

import { PrismaClient } from './generated/prisma/client'

/** One client for the whole app. */
export const prisma = new PrismaClient({ adapter: new ${name}(${args}) })
`
}

const ISSUES = `function problems(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return { message: 'The body has errors', details: error.issues.map((i) => \`\${i.path.join('.') || 'body'}: \${i.message}\`) }
}`

/**
 * Express routers, one per table, that check bodies with the contract's Zod
 * schemas (`schema.ts`, from the contract's Zod output) and read and write
 * through Prisma 7 (`db.ts`, with the driver adapter for the database).
 * `routes.ts` mounts them all.
 */
export function toExpressRoutes(model: DbModel, provider: PrismaProvider = 'postgresql'): Record<string, string> {
  const { list } = cruds(model)
  const files: Record<string, string> = { 'db.ts': dbFile(provider) }
  for (const c of list) {
    const delegate = camelCase(c.model)
    const router = `${camelCase(c.table.name)}Router`
    const id = idExpr(c, 'req.params.id')
    files[`routes/${c.route.slice(1)}.ts`] = `import { Router } from 'express'

import { prisma } from '../db'
import { ${schemaName(c.newType)}, ${schemaName(c.changesType)} } from '../schema'

${ISSUES}

/** ${c.model} rows: list, create, get, update and delete. */
export const ${router} = Router()

${router}.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  res.json(await prisma.${delegate}.findMany({ take: limit, skip: offset }))
})

${router}.post('/', async (req, res) => {
  const parsed = ${schemaName(c.newType)}.safeParse(req.body)
  if (!parsed.success) return void res.status(422).json(problems(parsed.error))
  res.status(201).json(await prisma.${delegate}.create({ data: parsed.data }))
})

${router}.get('/:id', async (req, res) => {
  const row = await prisma.${delegate}.findUnique({ where: { ${fieldKey(c.pk.name)}: ${id} } })
  if (!row) return void res.status(404).json({ message: 'No ${singular(c.table.name.replace(/_/g, ' '))} with that ID' })
  res.json(row)
})

${router}.patch('/:id', async (req, res) => {
  const parsed = ${schemaName(c.changesType)}.safeParse(req.body)
  if (!parsed.success) return void res.status(422).json(problems(parsed.error))
  const found = await prisma.${delegate}.findUnique({ where: { ${fieldKey(c.pk.name)}: ${id} } })
  if (!found) return void res.status(404).json({ message: 'No ${singular(c.table.name.replace(/_/g, ' '))} with that ID' })
  res.json(await prisma.${delegate}.update({ where: { ${fieldKey(c.pk.name)}: ${id} }, data: parsed.data }))
})

${router}.delete('/:id', async (req, res) => {
  const found = await prisma.${delegate}.findUnique({ where: { ${fieldKey(c.pk.name)}: ${id} } })
  if (!found) return void res.status(404).json({ message: 'No ${singular(c.table.name.replace(/_/g, ' '))} with that ID' })
  await prisma.${delegate}.delete({ where: { ${fieldKey(c.pk.name)}: ${id} } })
  res.status(204).end()
})
`
  }
  files['routes.ts'] = `import express from 'express'

${list.map((c) => `import { ${camelCase(c.table.name)}Router } from './routes/${c.route.slice(1)}'`).join('\n')}

/** Every table's routes, under one router: app.use('/api', routes). */
export const routes = express.Router()
routes.use(express.json())
${list.map((c) => `routes.use('${c.route}', ${camelCase(c.table.name)}Router)`).join('\n')}
`
  return files
}

/** Next.js App Router handlers (`app/api/…/route.ts`), using only web-standard Request and Response. */
export function toNextRoutes(model: DbModel, provider: PrismaProvider = 'postgresql'): Record<string, string> {
  const { list } = cruds(model)
  const files: Record<string, string> = { 'db.ts': dbFile(provider) }
  for (const c of list) {
    const delegate = camelCase(c.model)
    const where = `{ ${fieldKey(c.pk.name)}: ${idExpr(c, 'id')} }`
    const notFound = `Response.json({ message: 'No ${singular(c.table.name.replace(/_/g, ' '))} with that ID' }, { status: 404 })`
    const dir = `app/api${c.route}`
    files[`${dir}/route.ts`] = `import { prisma } from '@/db'
import { ${schemaName(c.newType)} } from '@/schema'

${ISSUES}

/** List ${c.model} rows: ?limit=50&offset=0 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
  return Response.json(await prisma.${delegate}.findMany({ take: limit, skip: offset }))
}

/** Create a ${c.model}. */
export async function POST(request: Request) {
  const parsed = ${schemaName(c.newType)}.safeParse(await request.json().catch(() => undefined))
  if (!parsed.success) return Response.json(problems(parsed.error), { status: 422 })
  return Response.json(await prisma.${delegate}.create({ data: parsed.data }), { status: 201 })
}
`
    files[`${dir}/[id]/route.ts`] = `import { prisma } from '@/db'
import { ${schemaName(c.changesType)} } from '@/schema'

${ISSUES}

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  const row = await prisma.${delegate}.findUnique({ where: ${where} })
  return row ? Response.json(row) : ${notFound}
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params
  const parsed = ${schemaName(c.changesType)}.safeParse(await request.json().catch(() => undefined))
  if (!parsed.success) return Response.json(problems(parsed.error), { status: 422 })
  if (!(await prisma.${delegate}.findUnique({ where: ${where} }))) return ${notFound}
  return Response.json(await prisma.${delegate}.update({ where: ${where}, data: parsed.data }))
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params
  if (!(await prisma.${delegate}.findUnique({ where: ${where} }))) return ${notFound}
  await prisma.${delegate}.delete({ where: ${where} })
  return new Response(null, { status: 204 })
}
`
  }
  return files
}

/** Problems with the model that change the output: relationships to tables that aren't there, tables without a usable key. */
export function dbProblems(model: DbModel): string[] {
  return [...relations(model).problems, ...cruds(model).skipped]
}
