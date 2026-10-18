import { hasRequestBody, openApiPath, statusText, successResponse } from '../contract/model'
import type { Contract, ContractEndpoint } from '../contract/types'
import type { HttpMethod } from '../generate/fetch'
import { toMock } from '../generate/mock'
import { parseCurl } from '../importers'
import type { Shape } from '../types'
import { checkContract, findEndpoint } from './check'
import type { ContractCheck } from './check'
import type { ApiRequest, Assertion, AssertionOp, BuiltRequest, Capture, Environment, KeyValue, SuccessfulResult } from './types'

export const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const emptyRequest = (id: string, patch: Partial<ApiRequest> = {}): ApiRequest => ({
  id,
  name: 'New request',
  folder: '',
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  auth: { kind: 'none' },
  body: { kind: 'none', text: '', form: [] },
  assertions: [],
  captures: [],
  ...patch,
})

export const sendsBody = (method: string) => !['GET', 'HEAD'].includes(method.toUpperCase())

/* ---------- variables ---------- */

const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g

/** The enabled variables of an environment, by name. Later rows win. */
export function variablesOf(env: Environment | undefined): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const v of env?.variables ?? []) if (v.enabled && v.key.trim()) vars[v.key.trim()] = v.value
  return vars
}

/** Fill `{{name}}` from `vars`. Names with no value are left as they are and listed in `missing`. */
export function interpolate(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(VARIABLE, (whole, name: string) => {
    if (Object.hasOwn(vars, name)) return vars[name]
    if (!missing.includes(name)) missing.push(name)
    return whole
  })
  return { text: out, missing }
}

/** Every `{{name}}` a request uses, in order. */
export function variablesUsed(request: ApiRequest): string[] {
  const texts = [request.url, ...rows(request.params).flatMap((r) => [r.key, r.value]), ...rows(request.headers).flatMap((r) => [r.key, r.value])]
  const a = request.auth
  if (a.kind === 'bearer') texts.push(a.token)
  if (a.kind === 'basic') texts.push(a.username, a.password)
  if (a.kind === 'apiKey') texts.push(a.name, a.value)
  if (request.body.kind === 'json' || request.body.kind === 'text') texts.push(request.body.text)
  if (request.body.kind === 'form') texts.push(...rows(request.body.form).flatMap((r) => [r.key, r.value]))
  const names: string[] = []
  for (const t of texts) for (const m of t.matchAll(VARIABLE)) if (!names.includes(m[1])) names.push(m[1])
  return names
}

const rows = (list: KeyValue[]) => list.filter((r) => r.enabled && r.key.trim())

/* ---------- URLs ---------- */

/** Split `https://x.dev/orders?status=open&page=2` into the URL without its query and the query as rows. */
export function splitQuery(url: string): { url: string; params: KeyValue[] } {
  const hash = url.indexOf('#')
  const noHash = hash >= 0 ? url.slice(0, hash) : url
  const at = noHash.indexOf('?')
  if (at < 0) return { url, params: [] }
  const params = noHash
    .slice(at + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=')
      const [k, v] = eq < 0 ? [pair, ''] : [pair.slice(0, eq), pair.slice(eq + 1)]
      return { key: decode(k), value: decode(v), enabled: true }
    })
  return { url: noHash.slice(0, at), params }
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Keep `{{variables}}` readable in a query string: encode everything else. */
const encode = (s: string) => encodeURIComponent(s).replace(/%7B%7B/g, '{{').replace(/%7D%7D/g, '}}')

/** `localhost:3000/x` → `http://localhost:3000/x`; `api.dev/x` → `https://api.dev/x`. */
function withScheme(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(url)) return `http://${url}`
  return `https://${url}`
}

/* ---------- building ---------- */

/** The request as it will go out: variables filled, params on the URL, auth and content type in the headers. */
export function buildRequest(request: ApiRequest, vars: Record<string, string>): BuiltRequest {
  const missing = new Set<string>()
  const fill = (text: string) => {
    const r = interpolate(text, vars)
    r.missing.forEach((m) => missing.add(m))
    return r.text
  }
  const method = request.method.toUpperCase()
  const query: [string, string][] = rows(request.params).map((r) => [fill(r.key), fill(r.value)])
  const headers: [string, string][] = rows(request.headers).map((r) => [fill(r.key).trim(), fill(r.value)])
  const has = (name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase())

  const auth = request.auth
  if (auth.kind === 'bearer' && auth.token.trim() && !has('authorization')) headers.push(['Authorization', `Bearer ${fill(auth.token.trim())}`])
  if (auth.kind === 'basic' && !has('authorization')) headers.push(['Authorization', `Basic ${base64(`${fill(auth.username)}:${fill(auth.password)}`)}`])
  if (auth.kind === 'apiKey' && auth.name.trim()) {
    if (auth.in === 'query') query.push([fill(auth.name.trim()), fill(auth.value)])
    else if (!has(auth.name.trim())) headers.push([fill(auth.name.trim()), fill(auth.value)])
  }

  let body: string | undefined
  if (sendsBody(method)) {
    const b = request.body
    if (b.kind === 'json' && b.text.trim()) {
      body = fill(b.text)
      if (!has('content-type')) headers.push(['Content-Type', 'application/json'])
    } else if (b.kind === 'text' && b.text) {
      body = fill(b.text)
      if (!has('content-type')) headers.push(['Content-Type', 'text/plain'])
    } else if (b.kind === 'form') {
      body = rows(b.form)
        .map((r) => `${encodeURIComponent(fill(r.key))}=${encodeURIComponent(fill(r.value))}`)
        .join('&')
      if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
  }

  let url = fill(request.url.trim())
  if (url) url = withScheme(url)
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&')
  return { method, url, headers, ...(body !== undefined ? { body } : {}), missing: [...missing] }
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** What stops a built request from being sent, in plain words, or null when it's fine. */
export function requestProblem(built: BuiltRequest, bodyKind: ApiRequest['body']['kind']): string | null {
  if (built.missing.length) return `No value for ${built.missing.map((m) => `{{${m}}}`).join(', ')}. Add ${built.missing.length > 1 ? 'them' : 'it'} to the environment, or pick another environment.`
  if (!built.url) return 'Type the URL to send it to, like https://api.example.com/orders.'
  let u: URL
  try {
    u = new URL(built.url)
  } catch {
    return `${built.url} isn't a URL. It should look like https://api.example.com/orders.`
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `Only http and https URLs can be sent, not ${u.protocol.replace(':', '')}.`
  if (bodyKind === 'json' && built.body !== undefined) {
    try {
      JSON.parse(built.body)
    } catch (e) {
      return `The JSON body isn't valid: ${e instanceof Error ? e.message : String(e)}. To send it anyway (to test a 400), switch the body to Text and set Content-Type yourself.`
    }
  }
  return null
}

/** The same request as a cURL command, to share or run in a terminal. */
export function toCurl(built: Pick<BuiltRequest, 'method' | 'url' | 'headers' | 'body'>): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const parts = [`curl${built.method === 'GET' ? '' : ` -X ${built.method}`} ${q(built.url)}`]
  for (const [k, v] of built.headers) parts.push(`-H ${q(`${k}: ${v}`)}`)
  if (built.body !== undefined) parts.push(`--data-raw ${q(built.body)}`)
  return parts.join(' \\\n  ')
}

/** The same request as a `fetch` call, to paste into the frontend. */
export function toFetchSnippet(built: Pick<BuiltRequest, 'method' | 'url' | 'headers' | 'body'>): string {
  const init: string[] = []
  if (built.method !== 'GET') init.push(`  method: ${JSON.stringify(built.method)},`)
  if (built.headers.length) init.push(`  headers: {\n${built.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n  },`)
  if (built.body !== undefined) {
    let body = JSON.stringify(built.body)
    try {
      body = `JSON.stringify(${JSON.stringify(JSON.parse(built.body), null, 2).replace(/\n/g, '\n  ')})`
    } catch {
      // not JSON: send the text as it is
    }
    init.push(`  body: ${body},`)
  }
  const call = init.length ? `fetch(${JSON.stringify(built.url)}, {\n${init.join('\n')}\n})` : `fetch(${JSON.stringify(built.url)})`
  return `const res = await ${call}\nconst data = await res.json()\n`
}

/* ---------- making requests ---------- */

/** A request from a cURL command ("Copy as cURL" in DevTools, or the API docs). Throws with a plain message when it isn't one. */
export function requestFromCurl(command: string, id: string): ApiRequest {
  const c = parseCurl(command)
  const { url, params } = splitQuery(c.url)
  const headers: KeyValue[] = []
  let auth: ApiRequest['auth'] = { kind: 'none' }
  for (const [key, value] of Object.entries(c.headers)) {
    const bearer = key === 'authorization' ? /^Bearer\s+(.+)$/i.exec(value) : null
    if (bearer && auth.kind === 'none') auth = { kind: 'bearer', token: bearer[1] }
    else headers.push({ key: headerCase(key), value, enabled: true })
  }
  const type = c.headers['content-type'] ?? ''
  let body: ApiRequest['body'] = { kind: 'none', text: '', form: [] }
  if (c.body !== undefined) {
    if (/json/i.test(type) || looksJson(c.body)) {
      body = { kind: 'json', text: pretty(c.body), form: [] }
    } else if (/x-www-form-urlencoded/i.test(type) || (!type && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(c.body))) {
      body = { kind: 'form', text: '', form: splitQuery(`?${c.body}`).params }
    } else body = { kind: 'text', text: c.body, form: [] }
    // the body kind sets these again on the way out
    if (body.kind !== 'text') {
      const i = headers.findIndex((h) => h.key.toLowerCase() === 'content-type')
      if (i >= 0) headers.splice(i, 1)
    }
  }
  let name = `${c.method} request`
  try {
    name = new URL(url).pathname.split('/').filter(Boolean).slice(-2).join('/') || new URL(url).host
  } catch {
    // keep the plain name
  }
  return emptyRequest(id, { name, method: c.method, url, params, headers, auth, body })
}

const headerCase = (key: string) => key.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => dash + c.toUpperCase())

const looksJson = (text: string) => {
  const t = text.trim()
  if (!/^[[{]/.test(t)) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

const pretty = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** A value that fits a param: 1 for numbers, a UUID for UUIDs, the first value of an enum, a word otherwise. */
export function sampleParamValue(shape: Shape | undefined): string {
  const s = shape?.kind === 'union' ? shape.options.find((o) => o.kind !== 'null') : shape
  if (s?.kind === 'number') return '1'
  if (s?.kind === 'boolean') return 'true'
  if (s?.kind === 'enum') return String(s.values[0] ?? 'value')
  if (s?.kind === 'array') return sampleParamValue(s.items)
  if (s?.kind === 'string' && s.format === 'uuid') return '3f2b8a6e-6d1c-4c2e-9a57-0d4b1e2c7a10'
  if (s?.kind === 'string' && s.format === 'date') return '2026-01-31'
  if (s?.kind === 'string' && s.format === 'date-time') return '2026-01-31T09:30:00Z'
  if (s?.kind === 'string' && s.format === 'email') return 'asha@example.com'
  return 'abc123'
}

/**
 * A request for a contract endpoint: `{{baseUrl}}` and the path with sample
 * path params, its query params (optional ones unticked), a made-up body,
 * and a check that the response matches the contract.
 */
export function requestFromEndpoint(contract: Contract, endpoint: ContractEndpoint, id: string, seed = 1): ApiRequest {
  const path = openApiPath(endpoint.path).replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(sampleParamValue(endpoint.params.find((p) => p.in === 'path' && p.name === name)?.shape)),
  )
  const params = endpoint.params.filter((p) => p.in === 'query').map((p) => ({ key: p.name, value: sampleParamValue(p.shape), enabled: p.required }))
  let body: ApiRequest['body'] = { kind: 'none', text: '', form: [] }
  if (endpoint.body && hasRequestBody(endpoint.method as HttpMethod)) {
    const value = toMock({ version: 2, rootName: endpoint.resource || 'body', root: endpoint.body.shape, types: contract.types }, { seed, rootCount: 2, optionalRate: 1 })
    body = { kind: 'json', text: JSON.stringify(value, null, 2), form: [] }
  }
  const ok = successResponse(endpoint)
  const assertions: Assertion[] = [
    { id: `${id}-a1`, target: 'contract', path: '', op: 'matches', value: '', enabled: true },
    ...(ok && typeof ok.status === 'number' ? [{ id: `${id}-a2`, target: 'status' as const, path: '', op: 'equals' as const, value: String(ok.status), enabled: true }] : []),
  ]
  return emptyRequest(id, {
    name: endpoint.summary || `${endpoint.method} ${endpoint.path}`,
    folder: endpoint.resource,
    method: endpoint.method,
    url: `{{baseUrl}}${path}`,
    params,
    headers: [],
    body,
    assertions,
    endpointId: endpoint.id,
    description: endpoint.description,
  })
}

/* ---------- responses ---------- */

/** The response body as JSON, or undefined when it's empty or isn't JSON. */
export function responseJson(result: Pick<SuccessfulResult, 'body'>): unknown {
  const t = result.body.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t) as unknown
  } catch {
    return undefined
  }
}

export const headerValue = (result: Pick<SuccessfulResult, 'headers'>, name: string) => result.headers.find(([k]) => k.toLowerCase() === name.trim().toLowerCase())?.[1]

/**
 * Read a value out of JSON by path: `data.items[0].id`, `items.0.id`,
 * `$.data` and `["odd key"]` all work. An empty path or `$` is the whole value.
 */
export function valueAtPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  const p = path.trim().replace(/^\$\.?/, '')
  if (!p) return { found: true, value }
  const keys: string[] = []
  const re = /\[\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(-?\d+))\s*\]|\.?([^.[\]]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(p))) keys.push(m[1] !== undefined ? (JSON.parse(`"${m[1]}"`) as string) : (m[2] ?? m[3] ?? m[4]))
  let cur: unknown = value
  for (const k of keys) {
    if (Array.isArray(cur)) {
      const i = Number(k)
      if (!Number.isInteger(i)) return { found: false }
      const at = i < 0 ? cur.length + i : i
      if (at < 0 || at >= cur.length) return { found: false }
      cur = cur[at]
    } else if (typeof cur === 'object' && cur !== null && Object.hasOwn(cur, k)) {
      cur = (cur as Record<string, unknown>)[k]
    } else return { found: false }
  }
  return { found: true, value: cur }
}

const asText = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))

/* ---------- tests ---------- */

export interface AssertionResult {
  id: string
  pass: boolean
  /** "Status equals 200" */
  label: string
  /** what was actually there, when it failed */
  detail?: string
  /** for a contract check: everything it found */
  contract?: ContractCheck
}

const OP_WORDS: Record<AssertionOp, string> = {
  equals: 'equals',
  notEquals: 'isn’t',
  contains: 'contains',
  exists: 'exists',
  missing: 'is missing',
  lessThan: 'is less than',
  greaterThan: 'is more than',
  matches: 'matches',
}

/** Which ops make sense for a target, in the order a menu should list them. */
export const OPS_FOR: Record<Assertion['target'], AssertionOp[]> = {
  status: ['equals', 'notEquals', 'lessThan', 'greaterThan'],
  time: ['lessThan', 'greaterThan'],
  header: ['exists', 'missing', 'equals', 'notEquals', 'contains', 'matches'],
  body: ['exists', 'missing', 'equals', 'notEquals', 'contains', 'lessThan', 'greaterThan', 'matches'],
  contract: ['matches'],
}

export const opWords = (op: AssertionOp) => OP_WORDS[op]

export function assertionLabel(a: Assertion): string {
  if (a.target === 'contract') return 'Response matches the API contract'
  const subject = a.target === 'status' ? 'Status' : a.target === 'time' ? 'Time (ms)' : a.target === 'header' ? `Header ${a.path || '…'}` : `Body ${a.path.trim() || '$'}`
  const needsValue = a.op !== 'exists' && a.op !== 'missing'
  const value = a.op === 'matches' ? `/${a.value}/` : a.value
  return `${subject} ${OP_WORDS[a.op]}${needsValue ? ` ${value}` : ''}`
}

function compare(op: AssertionOp, actual: unknown, expected: string): boolean | string {
  const text = asText(actual)
  switch (op) {
    case 'exists':
      return actual !== undefined
    case 'missing':
      return actual === undefined
    case 'equals':
    case 'notEquals': {
      let same = text === expected
      if (!same && typeof actual !== 'string') {
        // `1` equals 1, `true` equals true, `{"a":1}` equals {"a":1}
        try {
          same = JSON.stringify(JSON.parse(expected)) === JSON.stringify(actual)
        } catch {
          same = false
        }
      }
      return op === 'equals' ? same : !same
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.some((x) => asText(x) === expected) || text.includes(expected)
      return text.includes(expected)
    case 'lessThan':
    case 'greaterThan': {
      const a = typeof actual === 'number' ? actual : Number(text)
      const b = Number(expected)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return `${expected.trim() ? `Can't compare ${text || 'nothing'} with ${expected}` : 'Type a number to compare with'}.`
      return op === 'lessThan' ? a < b : a > b
    }
    case 'matches':
      try {
        return new RegExp(expected).test(text)
      } catch {
        return `/${expected}/ isn't a valid regular expression.`
      }
  }
}

/** Run a request's checks on its response. Contract checks need the contract; without a matching endpoint they fail and say why. */
export function runAssertions(request: Pick<ApiRequest, 'assertions' | 'endpointId' | 'method'>, result: SuccessfulResult, contract?: Contract): AssertionResult[] {
  const json = responseJson(result)
  return request.assertions
    .filter((a) => a.enabled)
    .map((a): AssertionResult => {
      const label = assertionLabel(a)
      if (a.target === 'contract') {
        const endpoint = contract && (contract.endpoints.find((e) => e.id === request.endpointId) ?? findEndpoint(contract, request.method, result.url))
        if (!contract || !endpoint)
          return { id: a.id, pass: false, label, detail: `No endpoint in the API contract matches ${request.method} ${pathOf(result.url)}. Add it to the contract, or link this request to one.` }
        const check = checkContract(contract, endpoint, result.status, json, result.body)
        const errors = check.issues.filter((i) => i.severity === 'error')
        return {
          id: a.id,
          pass: check.ok,
          label: `${label} (${endpoint.method} ${openApiPath(endpoint.path)})`,
          detail: errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors[0].path} ${errors[0].message}` : undefined,
          contract: check,
        }
      }
      let actual: unknown
      if (a.target === 'status') actual = result.status
      else if (a.target === 'time') actual = result.ms
      else if (a.target === 'header') actual = headerValue(result, a.path)
      else {
        if (json === undefined && a.path.trim() && a.path.trim() !== '$') actual = undefined
        else {
          const at = json === undefined ? { found: Boolean(result.body), value: result.body } : valueAtPath(json, a.path)
          actual = at.found ? at.value : undefined
        }
      }
      const outcome = compare(a.op, actual, a.value.trim())
      if (typeof outcome === 'string') return { id: a.id, pass: false, label, detail: outcome }
      const shown = actual === undefined ? 'nothing there' : asText(actual)
      return { id: a.id, pass: outcome, label, detail: outcome ? undefined : `Got ${shown.length > 120 ? `${shown.slice(0, 120)}…` : shown}${a.target === 'status' ? ` ${statusText(Number(actual))}` : ''}.` }
    })
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** Values to copy into the environment after a response: a login's token, the id of what was just created. */
export function runCaptures(captures: Capture[], result: SuccessfulResult): { set: { variable: string; value: string }[]; failed: string[] } {
  const json = responseJson(result)
  const set: { variable: string; value: string }[] = []
  const failed: string[] = []
  for (const c of captures) {
    if (!c.enabled || !c.variable.trim()) continue
    let value: unknown
    if (c.from === 'status') value = result.status
    else if (c.from === 'header') value = headerValue(result, c.path)
    else value = json === undefined ? undefined : valueAtPath(json, c.path).value
    if (value === undefined) failed.push(`${c.variable.trim()}: nothing at ${c.from === 'body' ? c.path || '$' : c.from === 'header' ? `header ${c.path}` : 'status'}`)
    else set.push({ variable: c.variable.trim(), value: asText(value) })
  }
  return { set, failed }
}

/** Set variables in an environment: update the rows that exist (ticking them), add the rest. */
export function setVariables(env: Environment, values: { variable: string; value: string }[]): Environment {
  const variables = env.variables.map((v) => ({ ...v }))
  for (const { variable, value } of values) {
    const row = variables.find((v) => v.key.trim() === variable)
    if (row) {
      row.value = value
      row.enabled = true
    } else variables.push({ key: variable, value, enabled: true })
  }
  return { ...env, variables }
}

/** Format a byte count the way people read it: 812 B, 14.2 KB, 1.3 MB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Environments and requests made from a contract: one environment holding its base URL, one request per endpoint. */
export function collectionFromContract(contract: Contract, ids: () => string): { environment: Environment; requests: ApiRequest[] } {
  return {
    environment: { id: ids(), name: contract.title || 'API', variables: [{ key: 'baseUrl', value: contract.baseUrl, enabled: true }] },
    requests: contract.endpoints.map((e) => requestFromEndpoint(contract, e, ids())),
  }
}
