import { shapeLabel } from '../contract/shapes'
import { openApiPath, statusText } from '../contract/model'
import type { Contract, ContractEndpoint, ContractResponse } from '../contract/types'
import type { ObjectType, Shape, StringFormat } from '../types'

/**
 * Checking a real response against the contract: does the status appear in
 * the endpoint's responses, and does the body have the shape that status
 * promises? Errors break the contract; warnings (a key the contract doesn't
 * list, a body on a response that promised none) are worth a look.
 */

export interface ContractIssue {
  /** where in the body: `$`, `$.items[2].total` */
  path: string
  message: string
  severity: 'error' | 'warning'
}

export interface ContractCheck {
  /** the contract response the status matched (exactly, or through `default`) */
  response?: ContractResponse
  issues: ContractIssue[]
  /** no errors */
  ok: boolean
}

/** stop listing after this many, so a list of 10 000 wrong items stays readable */
const MAX_ISSUES = 50

const FORMAT_TESTS: Record<StringFormat, (s: string) => boolean> = {
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s) && !Number.isNaN(Date.parse(s)),
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)),
  email: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  uri: (s) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(s),
}

const describe = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return value.length > 40 ? `the string "${value.slice(0, 40)}…"` : `the string ${JSON.stringify(value)}`
  return `${typeof value === 'number' ? 'the number' : typeof value === 'boolean' ? '' : typeof value} ${String(value)}`.trim()
}

const child = (path: string, key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`)

/** Every way `value` breaks `shape`. Object types are looked up by name in `types`. */
export function checkShape(shape: Shape, value: unknown, types: ObjectType[], path = '$'): ContractIssue[] {
  const byName = new Map(types.map((t) => [t.name, t]))
  const issues: ContractIssue[] = []
  const add = (p: string, message: string, severity: ContractIssue['severity'] = 'error') => {
    if (issues.length < MAX_ISSUES) issues.push({ path: p, message, severity })
  }
  const visit = (s: Shape, v: unknown, p: string, depth: number): void => {
    if (issues.length >= MAX_ISSUES || depth > 64) return
    const expected = () => `Expected ${shapeLabel(s)}, got ${describe(v)}.`
    switch (s.kind) {
      case 'unknown':
        return
      case 'null':
        if (v !== null) add(p, expected())
        return
      case 'boolean':
        if (typeof v !== 'boolean') add(p, expected())
        return
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) add(p, expected())
        // min and max are the range the samples had (a hint for mock data), not limits, so they aren't checked
        else if (s.integer && !Number.isInteger(v)) add(p, `Expected a whole number, got ${v}.`)
        return
      case 'string':
        if (typeof v !== 'string') add(p, expected())
        else if (s.format && !FORMAT_TESTS[s.format](v)) add(p, `Expected ${s.format === 'uri' ? 'a URL' : `a ${s.format}`}, got ${describe(v)}.`)
        return
      case 'enum':
        if (typeof v !== 'string' || !s.values.includes(v)) add(p, `Expected one of ${s.values.map((x) => JSON.stringify(x)).join(', ')}, got ${describe(v)}.`)
        return
      case 'array':
        if (!Array.isArray(v)) add(p, expected())
        else v.forEach((item, i) => visit(s.items, item, `${p}[${i}]`, depth + 1))
        return
      case 'union': {
        // fine if any option fits; otherwise report against the option of the same kind, if there is one
        const fits = s.options.some((o) => checkShape(o, v, types).every((x) => x.severity !== 'error'))
        if (fits) return
        const sameKind = s.options.find((o) => kindOf(o, byName) === kindOfValue(v))
        if (sameKind) visit(sameKind, v, p, depth + 1)
        else add(p, expected())
        return
      }
      case 'ref': {
        const type = byName.get(s.name)
        if (!type) {
          add(p, `The contract has no type called ${s.name}, so this can't be checked.`, 'warning')
          return
        }
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          add(p, `Expected ${s.name} (an object), got ${describe(v)}.`)
          return
        }
        const obj = v as Record<string, unknown>
        for (const f of type.fields) {
          if (!(f.key in obj) || obj[f.key] === undefined) {
            if (!f.optional) add(child(p, f.key), `Missing: ${s.name} needs ${f.key} (${shapeLabel(f.shape)}).`)
          } else visit(f.shape, obj[f.key], child(p, f.key), depth + 1)
        }
        const known = new Set(type.fields.map((f) => f.key))
        for (const key of Object.keys(obj)) if (!known.has(key)) add(child(p, key), `Not in the contract: ${s.name} has no ${key}.`, 'warning')
        return
      }
    }
  }
  visit(shape, value, path, 0)
  return issues
}

type Kind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'any'

function kindOf(s: Shape, types: Map<string, ObjectType>): Kind {
  if (s.kind === 'enum' || s.kind === 'string') return 'string'
  if (s.kind === 'ref') return types.has(s.name) ? 'object' : 'any'
  if (s.kind === 'unknown' || s.kind === 'union') return 'any'
  return s.kind
}

function kindOfValue(v: unknown): Kind {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'object'
}

/** The contract's response for a status: the exact one, or `default`. */
export function responseFor(endpoint: ContractEndpoint, status: number): ContractResponse | undefined {
  return endpoint.responses.find((r) => r.status === status) ?? endpoint.responses.find((r) => r.status === 'default')
}

/**
 * Check a real response against an endpoint. `body` is the parsed JSON, or
 * undefined when the response had no body (or it wasn't JSON: pass `bodyText`
 * so that case says so).
 */
export function checkContract(contract: Contract, endpoint: ContractEndpoint, status: number, body: unknown, bodyText = ''): ContractCheck {
  const issues: ContractIssue[] = []
  const response = responseFor(endpoint, status)
  const declared = endpoint.responses.map((r) => (r.status === 'default' ? 'default' : String(r.status))).join(', ') || 'none'
  if (!response) {
    issues.push({ path: '$', message: `The contract doesn't list ${status} ${statusText(status)} for ${endpoint.method} ${openApiPath(endpoint.path)}. It lists: ${declared}.`, severity: 'error' })
    return { issues, ok: false }
  }
  if (!response.body) {
    if (body !== undefined || bodyText.trim()) issues.push({ path: '$', message: `The contract says ${status} has no body, but one came back.`, severity: 'warning' })
  } else if (body === undefined) {
    issues.push({ path: '$', message: bodyText.trim() ? `Expected a JSON ${shapeLabel(response.body)}, but the body isn't JSON.` : `Expected a ${shapeLabel(response.body)} body, but the response was empty.`, severity: 'error' })
  } else {
    issues.push(...checkShape(response.body, body, contract.types))
  }
  return { response, issues, ok: issues.every((i) => i.severity !== 'error') }
}

const segments = (path: string) => openApiPath(path).split('/').filter(Boolean)

/**
 * The contract endpoint a request URL hits, if any: `GET https://api.shop.in/v1/orders/42`
 * matches `GET /orders/{id}` when the base URL is `https://api.shop.in/v1`.
 * Fixed segments beat params, so `/orders/latest` wins over `/orders/{id}`.
 */
export function findEndpoint(contract: Contract, method: string, url: string): ContractEndpoint | undefined {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split(/[?#]/)[0]
  }
  let basePath = ''
  try {
    basePath = new URL(contract.baseUrl).pathname.replace(/\/+$/, '')
  } catch {
    basePath = contract.baseUrl.startsWith('/') ? contract.baseUrl.replace(/\/+$/, '') : ''
  }
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) path = path.slice(basePath.length) || '/'
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
  let best: { endpoint: ContractEndpoint; score: number } | undefined
  for (const e of contract.endpoints) {
    if (e.method !== method.toUpperCase()) continue
    const want = segments(e.path)
    if (want.length !== parts.length) continue
    let score = 0
    let fits = true
    for (let i = 0; i < want.length; i++) {
      if (/^\{\w+\}$/.test(want[i])) continue
      if (want[i] !== parts[i]) {
        fits = false
        break
      }
      score++
    }
    if (fits && (!best || score > best.score)) best = { endpoint: e, score }
  }
  return best?.endpoint
}
