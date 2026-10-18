import type { ComponentInfo, PropInfo, PropType } from './grid'

/**
 * Components and their props from one .tsx file's text, for the variant
 * canvas in the workbench. The dev-server plugin asks the TypeScript compiler;
 * the browser can't carry it, so this reads the types the way people usually
 * write them: interfaces and type aliases in the same file, string unions,
 * booleans, `Omit`/`Pick`/`Partial`, `PropsWithChildren`, and the HTML
 * attributes a component extends (which bring `children` and `disabled`).
 */

const isPascal = (s: string) => /^[A-Z][A-Za-z0-9]*$/.test(s)

/** The source with comments blanked out (same length, newlines kept), so offsets still line up. */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i++
      }
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' '
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const start = i++
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1
      i++
      out += src.slice(start, i)
    } else {
      out += ch
      i++
    }
  }
  return out
}

const OPEN: Record<string, string> = { '(': ')', '{': '}', '[': ']', '<': '>' }

/** The index of the bracket that closes the one at `open`, skipping strings; -1 when it's never closed. */
function closing(src: string, open: number): number {
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1
      continue
    }
    if (ch === '>' && src[i - 1] === '=') continue // an arrow, not a generic
    if (OPEN[ch] && (ch !== '<' || stack.at(-1) === '>' || i === open)) stack.push(OPEN[ch])
    else if (ch === stack.at(-1)) {
      stack.pop()
      if (!stack.length) return i
    }
  }
  return -1
}

/** Split at the separators that sit outside any brackets or strings. */
function splitTop(s: string, seps: string[]): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < s.length && s[i] !== ch) i += s[i] === '\\' ? 2 : 1
      continue
    }
    if (ch === '>' && s[i - 1] === '=') continue
    if ('({[<'.includes(ch)) depth++
    else if (')}]>'.includes(ch)) depth--
    else if (depth === 0 && seps.includes(ch)) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/* ---------- type declarations ---------- */

type Decl = { kind: 'object'; body: string; extends: string[] } | { kind: 'alias'; text: string }

/** The type after `type X =`, up to the `;` or the line break that ends it. */
function readTypeExpr(src: string, from: number): string {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i++
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1
      continue
    }
    if (ch === '>' && src[i - 1] === '=') continue
    if ('({[<'.includes(ch)) depth++
    else if (')}]>'.includes(ch)) depth--
    else if (depth === 0 && ch === ';') return src.slice(from, i)
    else if (depth === 0 && ch === '\n') {
      const before = src.slice(from, i).trim()
      const after = src.slice(i + 1).trimStart()
      // a union or intersection spread over several lines carries on
      if (before && !/[|&=:,]$/.test(before) && !/^[|&]/.test(after)) return src.slice(from, i)
    }
  }
  return src.slice(from)
}

function declarations(src: string): Map<string, Decl> {
  const out = new Map<string, Decl>()
  for (const m of src.matchAll(/\binterface\s+([A-Za-z_$][\w$]*)\s*(<[^{]*?>)?\s*(?:extends\s+([^{]+?))?\s*\{/g)) {
    const open = m.index + m[0].length - 1
    const close = closing(src, open)
    if (close < 0) continue
    out.set(m[1], { kind: 'object', body: src.slice(open + 1, close), extends: m[3] ? splitTop(m[3], [',']).map((s) => s.trim()).filter(Boolean) : [] })
  }
  for (const m of src.matchAll(/\btype\s+([A-Za-z_$][\w$]*)\s*(<[^=]*?>)?\s*=(?!=)/g)) {
    out.set(m[1], { kind: 'alias', text: readTypeExpr(src, m.index + m[0].length).trim() })
  }
  return out
}

/* ---------- props ---------- */

const NODE = /\b(ReactNode|ReactElement|ReactChild|ReactPortal|JSX\.Element|ReactChildren)\b/
/** HTML attribute types from React: they bring `children`, and the form ones `disabled` */
const HTML_ATTRS = /\b(HTMLAttributes|AllHTMLAttributes|ComponentProps|ComponentPropsWithoutRef|ComponentPropsWithRef|PropsWithChildren|HTMLProps|DetailedHTMLProps|\w+HTMLAttributes)\b/
const FORM_ATTRS = /\b(Button|Input|Select|TextArea|Textarea|Fieldset|Option|Optgroup)HTMLAttributes\b|['"](button|input|select|textarea|fieldset)['"]/

const stripParens = (t: string): string => {
  const s = t.trim()
  return s.startsWith('(') && closing(s, 0) === s.length - 1 ? stripParens(s.slice(1, -1)) : s
}

const literal = (s: string) => /^(['"])(.*)\1$/.exec(s)?.[2] ?? null

class Reader {
  private decls: Map<string, Decl>
  constructor(decls: Map<string, Decl>) {
    this.decls = decls
  }

  /** What kind of value a type takes, following aliases declared in the file. */
  kind(text: string, depth = 0): PropType {
    const t = stripParens(text)
    if (depth > 8) return { kind: 'other' }
    const parts = splitTop(t, ['|'])
      .map((s) => stripParens(s))
      .filter((s) => s && s !== 'undefined' && s !== 'null' && s !== 'void')
    if (!parts.length) return { kind: 'other' }
    if (parts.length === 1 && /=>/.test(parts[0]) && !parts[0].startsWith('{')) return { kind: 'function' }
    // a union of string literals and aliases of them is an enum
    const values: string[] = []
    let allStrings = true
    for (const p of parts) {
      const lit = literal(p)
      if (lit !== null) values.push(lit)
      else {
        const d = this.decls.get(p)
        const k = d?.kind === 'alias' ? this.kind(d.text, depth + 1) : null
        if (k?.kind === 'enum') values.push(...k.values)
        else allStrings = false
      }
    }
    if (allStrings) return { kind: 'enum', values: [...new Set(values)] }
    if (parts.every((p) => p === 'boolean' || p === 'true' || p === 'false')) return { kind: 'boolean' }
    if (parts.length === 1) {
      const d = this.decls.get(parts[0])
      if (d?.kind === 'alias') return this.kind(d.text, depth + 1)
    }
    if (parts.some((p) => NODE.test(p))) return { kind: 'node' }
    if (parts.every((p) => /^(Function|\w*(Handler|EventHandler|Callback))\b/.test(p) || /^(React\.)?(Dispatch|SetStateAction)\b/.test(p))) return { kind: 'function' }
    if (parts.every((p) => p === 'number' || /^-?\d+(\.\d+)?$/.test(p))) return { kind: 'number' }
    if (parts.every((p) => p === 'string' || p.startsWith('`'))) return { kind: 'string' }
    return { kind: 'other' }
  }

  /** The members of a `{ … }` type literal. */
  members(body: string): PropInfo[] {
    const out: PropInfo[] = []
    for (const raw of this.memberTexts(body)) {
      const m = /^(?:readonly\s+)?(['"]?)([A-Za-z_$][\w$-]*)\1\s*(\?)?\s*([:(<])/.exec(raw)
      if (!m) continue
      const name = m[2]
      const optional = m[3] === '?'
      if (m[4] !== ':') {
        out.push({ name, optional, type: { kind: 'function' }, text: raw.slice(m[0].length - 1).trim() })
        continue
      }
      const text = raw.slice(m[0].length).trim()
      out.push({ name, optional, type: this.kind(text), text })
    }
    return out
  }

  /** Member texts, split at `;`, `,` or the line break before the next member. */
  private memberTexts(body: string): string[] {
    const out: string[] = []
    for (const chunk of splitTop(body, [';', ','])) {
      // inside one chunk, a line that starts like `name?:` begins a new member
      let current = ''
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (current.trim() && /^(readonly\s+)?['"]?[A-Za-z_$][\w$-]*['"]?\s*\??\s*[:(]/.test(trimmed) && !/[|&:=,(<]$|=>$/.test(current.trim())) {
          out.push(current.trim())
          current = ''
        }
        current += `${line}\n`
      }
      if (current.trim()) out.push(current.trim())
    }
    return out
  }

  /** Every prop a props type has: literals, interfaces (with what they extend), aliases, intersections and the utility types. */
  props(text: string, depth = 0): PropInfo[] {
    const t = stripParens(text)
    if (!t || depth > 8) return []
    const parts = splitTop(t, ['&']).map((s) => stripParens(s)).filter(Boolean)
    if (parts.length > 1) return merge(parts.map((p) => this.props(p, depth + 1)))
    if (t.startsWith('{')) {
      const close = closing(t, 0)
      return this.members(t.slice(1, close < 0 ? undefined : close))
    }
    const g = /^([\w$.]+)\s*(?:<([\s\S]*)>)?$/.exec(t)
    if (!g) return []
    const name = g[1].replace(/^React\./, '')
    const args = g[2] ? splitTop(g[2], [',']).map((s) => s.trim()) : []
    const keys = (s: string | undefined) => (s ? splitTop(s, ['|']).map((k) => literal(k.trim())).filter((k): k is string => k !== null) : [])
    switch (name) {
      case 'Omit': {
        const drop = new Set(keys(args[1]))
        return this.props(args[0] ?? '', depth + 1).filter((p) => !drop.has(p.name))
      }
      case 'Pick': {
        const keep = new Set(keys(args[1]))
        return this.props(args[0] ?? '', depth + 1).filter((p) => keep.has(p.name))
      }
      case 'Partial':
        return this.props(args[0] ?? '', depth + 1).map((p) => ({ ...p, optional: true }))
      case 'Required':
        return this.props(args[0] ?? '', depth + 1).map((p) => ({ ...p, optional: false }))
      case 'Readonly':
        return this.props(args[0] ?? '', depth + 1)
      case 'PropsWithChildren':
        return merge([this.props(args[0] ?? '', depth + 1), [CHILDREN]])
    }
    const d = this.decls.get(name)
    if (d?.kind === 'object') return merge([...d.extends.map((e) => this.props(e, depth + 1)), this.members(d.body)])
    if (d?.kind === 'alias') return this.props(d.text, depth + 1)
    if (HTML_ATTRS.test(t)) return FORM_ATTRS.test(t) ? [CHILDREN, DISABLED] : [CHILDREN]
    return []
  }
}

const CHILDREN: PropInfo = { name: 'children', optional: true, type: { kind: 'node' }, text: 'ReactNode' }
const DISABLED: PropInfo = { name: 'disabled', optional: true, type: { kind: 'boolean' }, text: 'boolean' }

/** Later props win, as they do in an intersection or an interface that redeclares one. */
function merge(lists: PropInfo[][]): PropInfo[] {
  const map = new Map<string, PropInfo>()
  for (const list of lists) for (const p of list) map.set(p.name, p)
  return [...map.values()]
}

/* ---------- components ---------- */

/** The type annotation on a component's first parameter: `{ size }: ButtonProps` → `ButtonProps`. */
function paramType(params: string): string | null {
  const first = splitTop(params, [','])[0] ?? ''
  const parts = splitTop(first, [':'])
  if (parts.length < 2) return null
  // `= {}` defaults sit after the type
  return splitTop(parts.slice(1).join(':'), ['='])[0].trim() || null
}

/** A function's parameter list, starting at its `(`. */
function paramsAt(src: string, open: number): string | null {
  const close = closing(src, open)
  return close < 0 ? null : src.slice(open + 1, close)
}

/** The props type of what a `const X = …` is set to: an arrow, a function, forwardRef or memo around one. */
function propsTypeOfValue(src: string, from: number, depth = 0): string | null {
  const rest = src.slice(from)
  const lead = /^\s*/.exec(rest)![0].length
  const at = from + lead
  const s = src.slice(at)
  if (depth > 3) return null
  const wrapper = /^(?:React\.)?(forwardRef|memo)\s*(<)?/.exec(s)
  if (wrapper) {
    let i = at + wrapper[0].length
    if (wrapper[2]) {
      const close = closing(src, i - 1)
      const args = splitTop(src.slice(i, close), [',']).map((x) => x.trim())
      // forwardRef<Ref, Props>; memo<Props>
      const typed = wrapper[1] === 'forwardRef' ? args[1] : args[0]
      if (typed) return typed
      i = close + 1
    }
    const open = src.indexOf('(', i)
    return open < 0 ? null : propsTypeOfValue(src, open + 1, depth + 1)
  }
  const fn = /^(?:async\s+)?function\s*[A-Za-z_$]?[\w$]*\s*(?:<[^(]*>)?\s*\(/.exec(s)
  if (fn) {
    const params = paramsAt(src, at + fn[0].length - 1)
    return params === null ? null : paramType(params)
  }
  const arrow = /^(?:async\s+)?(?:<[^(]*>\s*)?\(/.exec(s)
  if (arrow) {
    const params = paramsAt(src, at + arrow[0].length - 1)
    return params === null ? null : paramType(params)
  }
  return null
}

export interface SourceComponents {
  components: ComponentInfo[]
  /** things worth telling the user, e.g. no exported components */
  warnings: string[]
}

/** The exported React components in one .tsx file, with their props. */
export function componentsFromSource(source: string, file = '/Component.tsx'): SourceComponents {
  const src = stripComments(source)
  const reader = new Reader(declarations(src))
  type Found = { name: string; props: string | null; exported: boolean; isDefault: boolean; at: number }
  const found = new Map<string, Found>()
  const add = (f: Found) => {
    const had = found.get(f.name)
    found.set(f.name, had ? { ...had, props: had.props ?? f.props, at: Math.min(had.at, f.at), exported: had.exported || f.exported, isDefault: had.isDefault || f.isDefault } : f)
  }

  for (const m of src.matchAll(/(\bexport\s+(default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(<[^(]*?>)?\s*\(/g)) {
    if (!isPascal(m[3])) continue
    const params = paramsAt(src, m.index + m[0].length - 1)
    add({ name: m[3], props: params === null ? null : paramType(params), exported: !!m[1], isDefault: !!m[2], at: m.index })
  }
  for (const m of src.matchAll(/(\bexport\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(:\s*)?/g)) {
    if (!isPascal(m[2])) continue
    let at = m.index + m[0].length
    let props: string | null = null
    if (m[3]) {
      // const Button: FC<ButtonProps> = …
      const ann = /^(?:React\.)?(?:FC|FunctionComponent|VFC|ComponentType)\s*</.exec(src.slice(at))
      if (!ann) continue
      const open = at + ann[0].length - 1
      const close = closing(src, open)
      if (close < 0) continue
      props = src.slice(open + 1, close).trim()
      at = src.indexOf('=', close) + 1
      if (at <= 0) continue
    } else if (src[at] === '=' && src[at + 1] !== '=') at += 1
    else continue
    const fromValue = propsTypeOfValue(src, at)
    // only functions (and wrappers around them) are components
    if (fromValue === null && !/^\s*(?:React\.)?(forwardRef|memo)\b|^\s*(?:async\s+)?(function\b|\(|<)/.test(src.slice(at)) && !props) continue
    add({ name: m[2], props: props ?? fromValue, exported: !!m[1], isDefault: false, at: m.index })
  }
  for (const m of src.matchAll(/\bexport\s+default\s+(?:(?:React\.)?memo\s*\(\s*)?([A-Za-z_$][\w$]*)\s*\)?\s*;?\s*$/gm)) {
    const f = found.get(m[1])
    if (f) add({ ...f, exported: true, isDefault: true })
  }
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(',')) {
      const [local, as] = spec.trim().split(/\s+as\s+/)
      const f = local ? found.get(local.trim()) : undefined
      if (f) add({ ...f, exported: true, isDefault: f.isDefault || as?.trim() === 'default' })
    }
  }

  const components: ComponentInfo[] = [...found.values()]
    .filter((f) => f.exported)
    .sort((a, b) => a.at - b.at)
    .map((f) => ({ name: f.name, file, ...(f.isDefault ? { exportName: 'default' } : {}), props: f.props ? reader.props(f.props) : [] }))
  const warnings: string[] = []
  if (!components.length)
    warnings.push(
      found.size
        ? `${[...found.keys()].join(', ')} ${found.size === 1 ? 'isn’t' : 'aren’t'} exported. Add export in front of the component.`
        : 'No components found. Export a function whose name starts with a capital letter, like export function Button(props: ButtonProps).',
    )
  for (const c of components) if (!c.props.length && found.get(c.name)?.props) warnings.push(`Couldn’t read the props of ${c.name}: declare its props type in this file.`)
  return { components, warnings }
}
