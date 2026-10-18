/**
 * A database model, as Schemasketch draws it, and a reader for the DBML it
 * saves. It covers what turns into code: tables, columns and their settings,
 * enums, indexes and relationships. Projects, notes, groups and colours are
 * read past.
 */

export interface DbDefault {
  kind: 'expression' | 'string' | 'number' | 'boolean' | 'null'
  /** as written, without quotes or backticks: `now()`, `pending`, `1` */
  value: string
}

export interface DbColumn {
  name: string
  /** as written: `varchar(255)`, `decimal(10,2)`, `order_status` */
  type: string
  pk: boolean
  unique: boolean
  notNull: boolean
  increment: boolean
  default: DbDefault | null
  note: string | null
}

export interface DbIndex {
  name: string | null
  columns: string[]
  unique: boolean
  pk: boolean
}

export interface DbTable {
  name: string
  schema: string | null
  alias: string | null
  note: string | null
  columns: DbColumn[]
  indexes: DbIndex[]
}

export interface DbEnum {
  name: string
  schema: string | null
  values: string[]
}

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many, read from `from` to `to`. */
export type DbRefKind = '>' | '<' | '-' | '<>'

export interface DbRef {
  from: { table: string; columns: string[] }
  to: { table: string; columns: string[] }
  kind: DbRefKind
  onDelete: string | null
  onUpdate: string | null
}

export interface DbModel {
  name: string
  tables: DbTable[]
  enums: DbEnum[]
  refs: DbRef[]
}

export interface DbmlResult {
  model: DbModel
  /** lines it couldn't read, with where they are */
  problems: string[]
}

/* ---------- scanning ---------- */

/** Blank out comments, keeping every other character where it was (so offsets still give line numbers). */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (src.startsWith("'''", i)) {
      const end = src.indexOf("'''", i + 3)
      const stop = end < 0 ? src.length : end + 3
      out += src.slice(i, stop)
      i = stop
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j + 1
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i++
      }
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

/** The index of the brace that closes the one at `open`, skipping strings. */
function closing(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (src.startsWith("'''", i)) {
      const end = src.indexOf("'''", i + 3)
      i = end < 0 ? src.length : end + 2
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      i = j
    } else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

/** Split on a separator at the top level: not inside brackets, parentheses or quotes. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out.map((x) => x.trim()).filter(Boolean)
}

const unquote = (s: string) => {
  const t = s.trim()
  if (t.startsWith("'''") && t.endsWith("'''")) return t.slice(3, -3).trim()
  if (/^(['"`]).*\1$/s.test(t)) return t.slice(1, -1).replace(/\\(['"`\\])/g, '$1')
  return t
}

/** `public.users` → schema and name; quoted parts allowed. */
function qualified(s: string): { schema: string | null; name: string } {
  const parts = s
    .trim()
    .split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map(unquote)
  return parts.length > 1 ? { schema: parts[0], name: parts.slice(1).join('.') } : { schema: null, name: parts[0] }
}

/** The settings list at the end of a line: `[pk, note: 'x']` → its parts, and the text before it. */
function trailingSettings(line: string): { head: string; settings: string[] } {
  const t = line.trimEnd()
  if (!t.endsWith(']')) return { head: t, settings: [] }
  let depth = 0
  for (let i = t.length - 1; i >= 0; i--) {
    if (t[i] === ']') depth++
    else if (t[i] === '[' && --depth === 0) return { head: t.slice(0, i).trimEnd(), settings: splitTop(t.slice(i + 1, -1), ',') }
  }
  return { head: t, settings: [] }
}

function readDefault(raw: string): DbDefault {
  const v = raw.trim()
  if (v.startsWith('`')) return { kind: 'expression', value: v.slice(1, -1) }
  if (/^['"]/.test(v)) return { kind: 'string', value: unquote(v) }
  if (/^-?\d+(\.\d+)?$/.test(v)) return { kind: 'number', value: v }
  if (/^(true|false)$/i.test(v)) return { kind: 'boolean', value: v.toLowerCase() }
  if (/^null$/i.test(v)) return { kind: 'null', value: 'null' }
  return { kind: 'expression', value: v }
}

/** `users.id`, `public.users.id` or `users.(a, b)` → table and columns. */
function refEnd(s: string): { table: string; columns: string[] } | null {
  const t = s.trim()
  const composite = /^(.+)\.\(([^)]*)\)$/.exec(t)
  if (composite) return { table: qualifiedName(composite[1]), columns: splitTop(composite[2], ',').map(unquote) }
  const parts = t.split(/\.(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(unquote)
  if (parts.length < 2) return null
  return { table: parts.slice(0, -1).join('.'), columns: [parts[parts.length - 1]] }
}

const qualifiedName = (s: string) => {
  const q = qualified(s)
  return q.schema ? `${q.schema}.${q.name}` : q.name
}

const REF_OP = /\s(<>|<|>|-)\s/

/* ---------- reading ---------- */

export function parseDbml(source: string, name = 'Database'): DbmlResult {
  const src = stripComments(source)
  const problems: string[] = []
  const lineOf = (offset: number) => src.slice(0, offset).split('\n').length
  const tables: DbTable[] = []
  const enums: DbEnum[] = []
  const refs: DbRef[] = []
  let projectName = name

  const addRef = (text: string, settings: string[], line: number) => {
    const m = REF_OP.exec(` ${text} `)
    const op = m?.[1] as DbRefKind | undefined
    const [a, b] = op ? text.split(new RegExp(`\\s${op.replace(/[<>-]/g, '\\$&')}\\s`)) : []
    const from = a ? refEnd(a) : null
    const to = b ? refEnd(b) : null
    if (!op || !from || !to) {
      problems.push(`Line ${line}: couldn’t read the relationship “${text.trim()}”. Write it like orders.customer_id > customers.id.`)
      return
    }
    const setting = (key: string) => {
      const s = settings.find((x) => x.toLowerCase().startsWith(`${key}:`))
      return s ? s.slice(key.length + 1).trim() : null
    }
    refs.push({ from, to, kind: op, onDelete: setting('delete'), onUpdate: setting('update') })
  }

  const header = /\b(Project|Table|TableGroup|TablePartial|Enum|Ref|Note|Records)\b/gi
  let at = 0
  while (at < src.length) {
    header.lastIndex = at
    const m = header.exec(src)
    if (!m) break
    // only at the start of a line
    const lineStart = src.lastIndexOf('\n', m.index - 1) + 1
    if (src.slice(lineStart, m.index).trim()) {
      at = m.index + m[0].length
      continue
    }
    const kind = m[1].toLowerCase()
    const brace = src.indexOf('{', m.index)
    const eol = src.indexOf('\n', m.index) < 0 ? src.length : src.indexOf('\n', m.index)
    // a one-line Ref: `Ref name: a.b > c.d [delete: cascade]`
    if (kind === 'ref' && (brace < 0 || brace > eol)) {
      const text = src.slice(m.index + m[0].length, eol)
      const { head, settings } = trailingSettings(text.slice(text.indexOf(':') + 1))
      addRef(head, settings, lineOf(m.index))
      at = eol
      continue
    }
    if (brace < 0) break
    const end = closing(src, brace)
    if (end < 0) {
      problems.push(`Line ${lineOf(m.index)}: this ${m[1]} has no closing }.`)
      break
    }
    const head = src.slice(m.index + m[0].length, brace).trim()
    const body = src.slice(brace + 1, end)
    const bodyLine = lineOf(brace + 1)
    at = end + 1

    if (kind === 'project') projectName = unquote(head) || projectName
    else if (kind === 'enum') {
      const q = qualified(head)
      const values = body
        .split('\n')
        .map((l) => trailingSettings(l).head.trim())
        .filter(Boolean)
        .map(unquote)
      enums.push({ name: q.name, schema: q.schema, values })
    } else if (kind === 'ref') {
      body.split('\n').forEach((l, i) => {
        const { head: text, settings } = trailingSettings(l)
        if (text.trim()) addRef(text, settings, bodyLine + i)
      })
    } else if (kind === 'table') {
      const { head: h } = trailingSettings(head)
      const alias = /\sas\s+(\S+)$/i.exec(h)
      const q = qualified(alias ? h.slice(0, alias.index) : h)
      const table: DbTable = { name: q.name, schema: q.schema, alias: alias ? unquote(alias[1]) : null, note: null, columns: [], indexes: [] }
      tables.push(table)
      readTable(table, body, bodyLine, problems, (text, settings, line) => addRef(text, settings, line))
    }
    // TableGroup, TablePartial, Note and Records hold nothing that becomes code
  }

  // refs may name a table by its alias
  const byAlias = new Map(tables.filter((t) => t.alias).map((t) => [t.alias as string, t.schema ? `${t.schema}.${t.name}` : t.name]))
  for (const r of refs) {
    r.from.table = byAlias.get(r.from.table) ?? r.from.table
    r.to.table = byAlias.get(r.to.table) ?? r.to.table
  }
  return { model: { name: projectName, tables, enums, refs }, problems }
}

function readTable(table: DbTable, body: string, firstLine: number, problems: string[], addRef: (text: string, settings: string[], line: number) => void) {
  const tableKey = table.schema ? `${table.schema}.${table.name}` : table.name
  let i = 0
  const lines = body.split('\n')
  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()
    const n = firstLine + i
    i++
    if (!line) continue
    // indexes { … } and Note { … } blocks
    const block = /^(indexes|note)\s*\{/i.exec(line)
    if (block) {
      const inner: string[] = []
      let rest = line.slice(block[0].length)
      while (!rest.includes('}') && i < lines.length) {
        if (rest.trim()) inner.push(rest)
        rest = lines[i++]
      }
      inner.push(rest.slice(0, rest.lastIndexOf('}')))
      if (block[1].toLowerCase() === 'indexes')
        for (const l of inner) {
          if (!l.trim()) continue
          const { head, settings } = trailingSettings(l.trim())
          const flags = settings.map((s) => s.toLowerCase())
          const nameSetting = settings.find((s) => /^name\s*:/i.test(s))
          const cols = head.startsWith('(') ? splitTop(head.slice(1, head.lastIndexOf(')')), ',') : [head]
          table.indexes.push({ name: nameSetting ? unquote(nameSetting.split(':').slice(1).join(':')) : null, columns: cols.map(unquote), unique: flags.includes('unique'), pk: flags.includes('pk') })
        }
      else table.note = unquote(inner.join('\n'))
      continue
    }
    const note = /^note\s*:\s*(.+)$/i.exec(line)
    if (note) {
      let text = note[1]
      // a ''' note can run over several lines
      if (text.startsWith("'''") && !text.slice(3).includes("'''")) while (i < lines.length && !text.slice(3).includes("'''")) text += '\n' + lines[i++]
      table.note = unquote(text)
      continue
    }
    const { head, settings } = trailingSettings(line)
    const col = /^("(?:[^"\\]|\\.)*"|[^\s]+)\s+(.+)$/.exec(head)
    if (!col) {
      problems.push(`Line ${n}: couldn’t read “${line}” in ${table.name}. Columns look like: email varchar(255) [not null].`)
      continue
    }
    const column: DbColumn = { name: unquote(col[1]), type: unquote(col[2].trim()), pk: false, unique: false, notNull: false, increment: false, default: null, note: null }
    for (const s of settings) {
      const lower = s.toLowerCase()
      if (lower === 'pk' || lower === 'primary key') column.pk = true
      else if (lower === 'unique') column.unique = true
      else if (lower === 'not null') column.notNull = true
      else if (lower === 'null') column.notNull = false
      else if (lower === 'increment') column.increment = true
      else if (lower.startsWith('default:')) column.default = readDefault(s.slice(s.indexOf(':') + 1))
      else if (lower.startsWith('note:')) column.note = unquote(s.slice(s.indexOf(':') + 1))
      else if (lower.startsWith('ref:')) {
        const r = s.slice(s.indexOf(':') + 1).trim()
        const m = /^(<>|<|>|-)\s*(.+)$/.exec(r)
        if (m) addRef(`${tableKey}.${column.name} ${m[1]} ${m[2]}`, [], n)
      }
    }
    table.columns.push(column)
  }
}

/** Read a Schemasketch project file (`*.schemasketch.json`), already parsed from JSON. */
export function readSchemasketchFile(value: unknown): DbmlResult {
  const v = value as { app?: unknown; source?: unknown; name?: unknown } | null
  if (!v || v.app !== 'schemasketch' || typeof v.source !== 'string')
    throw new Error('This isn’t a Schemasketch project file. In Schemasketch, use Export → Project file (.schemasketch.json), or paste the DBML instead.')
  return parseDbml(v.source, typeof v.name === 'string' ? v.name : 'Database')
}
