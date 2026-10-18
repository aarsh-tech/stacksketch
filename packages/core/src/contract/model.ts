import { fetchFunctionName } from '../generate/fetch'
import type { HttpMethod } from '../generate/fetch'
import { refsOf, typesInDependencyOrder } from '../infer'
import { isIdentifier, pascalCase, singular } from '../names'
import type { ObjectType, Schema, Shape } from '../types'
import { isParamShape, mapRefs, sameShape } from './shapes'
import type { Contract, ContractEndpoint, ContractParam, ContractResponse, ResponseStatus } from './types'

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export const emptyContract = (): Contract => ({ version: 1, title: 'My API', apiVersion: '1.0.0', baseUrl: '', types: [], endpoints: [] })

/** Load a contract saved by any version. */
export function upgradeContract(saved: Omit<Contract, 'version'> & { version: number }): Contract {
  if (saved.version > 1) throw new Error(`This contract was saved by a newer Stacksketch (format v${saved.version}). Update the app to open it.`)
  return { ...saved, version: 1 }
}

export const hasRequestBody = (method: HttpMethod) => method === 'POST' || method === 'PUT' || method === 'PATCH'

/* ---------- paths ---------- */

const PARAM = /\{(\w+)\}|:([A-Za-z_]\w*)/g

/** Path param names in order: `/orders/{orderId}/items/:sku` → `orderId`, `sku`. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(PARAM)].map((m) => m[1] ?? m[2])
}

/** The path as OpenAPI writes it: `:id` becomes `{id}`. */
export const openApiPath = (path: string) => path.replace(PARAM, (_, a: string | undefined, b: string | undefined) => `{${a ?? b}}`)

/** The path with its params blanked, to spot two endpoints for the same URL: `/orders/{}`. */
const pathPattern = (path: string) => openApiPath(path).replace(/\{\w+\}/g, '{}').replace(/\/+$/, '') || '/'

const staticSegments = (path: string) =>
  path
    .split('/')
    .filter((s) => s && !/^(\{\w+\}|:\w+)$/.test(s) && !/^v\d+$|^api$/i.test(s))

const words = (segment: string) => segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase()

/** The resource a path is about: `/orders/{id}/items` → "Orders". */
export function resourceOf(path: string): string {
  const first = staticSegments(path)[0]
  if (!first) return 'General'
  const w = words(first)
  return w[0].toUpperCase() + w.slice(1)
}

/** A plain summary for a new endpoint: "List orders", "Get order", "Delete order". */
export function defaultSummary(method: HttpMethod, path: string): string {
  const last = staticSegments(path).at(-1)
  if (!last) return method === 'GET' ? 'Get the root' : `${method} the root`
  const many = words(last)
  const one = singular(many)
  const endsWithParam = /(\{\w+\}|:\w+)\/?$/.test(path)
  switch (method) {
    case 'GET':
      return endsWithParam ? `Get ${one}` : `List ${many}`
    case 'POST':
      return `Create ${one}`
    case 'PUT':
      return `Replace ${one}`
    case 'PATCH':
      return `Update ${one}`
    case 'DELETE':
      return `Delete ${one}`
  }
}

/** Keep one param per name in the path, in path order, keeping the types already set; query params follow. */
export function syncPathParams(endpoint: ContractEndpoint): ContractEndpoint {
  const names = [...new Set(pathParamNames(endpoint.path))]
  const old = new Map(endpoint.params.filter((p) => p.in === 'path').map((p) => [p.name, p]))
  const path: ContractParam[] = names.map((name) => ({ ...(old.get(name) ?? { name, in: 'path', shape: { kind: 'string' } }), required: true }))
  return { ...endpoint, params: [...path, ...endpoint.params.filter((p) => p.in === 'query')] }
}

/* ---------- statuses and responses ---------- */

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  301: 'Moved permanently',
  304: 'Not modified',
  400: 'Bad request',
  401: 'Not signed in',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  422: 'The request has errors',
  429: 'Too many requests',
  500: 'Server error',
  502: 'Bad gateway',
  503: 'Unavailable',
}

/** A default description for a status: 404 → "Not found". */
export function statusText(status: ResponseStatus): string {
  if (status === 'default') return 'Unexpected error'
  return STATUS_TEXT[status] ?? (status < 300 ? 'Success' : status < 400 ? 'Redirect' : status < 500 ? 'Client error' : 'Server error')
}

export const isSuccess = (status: ResponseStatus) => typeof status === 'number' && status >= 200 && status < 300

/** The response a client returns: the lowest 2xx. */
export function successResponse(endpoint: ContractEndpoint): ContractResponse | undefined {
  return endpoint.responses.filter((r) => isSuccess(r.status)).sort((a, b) => (a.status as number) - (b.status as number))[0]
}

/** Status codes sorted the way people read them, `default` last. */
export const statusOrder = (a: ResponseStatus, b: ResponseStatus) => (a === 'default' ? 1 : b === 'default' ? -1 : a - b)

/* ---------- endpoints ---------- */

export function newEndpoint(id: string, method: HttpMethod = 'GET', path = '/resources', resource?: string): ContractEndpoint {
  return syncPathParams({
    id,
    method,
    path,
    summary: defaultSummary(method, path),
    resource: resource ?? resourceOf(path),
    params: [],
    responses: [{ status: method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200, description: statusText(method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200) }],
  })
}

/** The function name an endpoint gets when no name is set: from its method and path. */
export const derivedName = (e: ContractEndpoint) => fetchFunctionName(e.method, openApiPath(e.path) || '/')

/**
 * The generated function name of every endpoint, by id. Names set by hand are
 * kept as they are (clashes between them are problems); made-up ones get a
 * number when they'd clash, e.g. `getOrder2`.
 */
export function functionNames(contract: Contract): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set(contract.endpoints.map((e) => e.operationId?.trim()).filter((n): n is string => Boolean(n && isIdentifier(n))))
  for (const e of contract.endpoints) {
    const own = e.operationId?.trim()
    if (own && isIdentifier(own)) {
      out.set(e.id, own)
      continue
    }
    const base = derivedName(e)
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`
    taken.add(name)
    out.set(e.id, name)
  }
  return out
}

export interface ResourceGroup {
  name: string
  endpoints: ContractEndpoint[]
}

/** Endpoints grouped by resource, in the order each resource first appears. */
export function resourceGroups(contract: Contract): ResourceGroup[] {
  const groups = new Map<string, ContractEndpoint[]>()
  for (const e of contract.endpoints) {
    const name = e.resource.trim() || 'General'
    groups.set(name, [...(groups.get(name) ?? []), e])
  }
  return [...groups].map(([name, endpoints]) => ({ name, endpoints }))
}

export function updateEndpoint(contract: Contract, id: string, change: (e: ContractEndpoint) => ContractEndpoint): Contract {
  return { ...contract, endpoints: contract.endpoints.map((e) => (e.id === id ? change(e) : e)) }
}

/* ---------- types ---------- */

/** Every shape in the contract, rewritten. */
function mapShapes(contract: Contract, fn: (s: Shape) => Shape): Contract {
  return {
    ...contract,
    types: contract.types.map((t) => ({ ...t, fields: t.fields.map((f) => ({ ...f, shape: fn(f.shape) })) })),
    endpoints: contract.endpoints.map((e) => ({
      ...e,
      params: e.params.map((p) => ({ ...p, shape: fn(p.shape) })),
      ...(e.body ? { body: { ...e.body, shape: fn(e.body.shape) } } : {}),
      responses: e.responses.map((r) => (r.body ? { ...r, body: fn(r.body) } : r)),
    })),
  }
}

/** A type name not used yet: `Order`, then `Order2`. */
export function uniqueTypeName(contract: Contract, wanted: string): string {
  const base = pascalCase(wanted)
  const taken = new Set(contract.types.map((t) => t.name))
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`
  return name
}

/** Rename a type and every ref to it. */
export function renameContractType(contract: Contract, from: string, to: string): Contract {
  if (from === to) return contract
  const renamed = { ...contract, types: contract.types.map((t) => (t.name === from ? { ...t, name: to } : t)) }
  return mapShapes(renamed, (s) => mapRefs(s, (name) => ({ kind: 'ref', name: name === from ? to : name })))
}

/** Where a type is used, for "Used by …" before deleting it. */
export function typeUsage(contract: Contract, name: string): string[] {
  const uses = (s: Shape | undefined) => Boolean(s && refsOf(s).includes(name))
  const out: string[] = []
  for (const t of contract.types) if (t.name !== name && t.fields.some((f) => uses(f.shape))) out.push(t.name)
  for (const e of contract.endpoints)
    if (e.params.some((p) => uses(p.shape)) || uses(e.body?.shape) || e.responses.some((r) => uses(r.body))) out.push(`${e.method} ${e.path}`)
  return out
}

/* ---------- from the API explorer ---------- */

export interface AddedSchema {
  contract: Contract
  endpointId: string
  /** incoming type names that clashed with a different type already in the contract, and what they're called now */
  renamed: [string, string][]
  /** incoming types that were already in the contract, exactly */
  reused: string[]
}

const sameFields = (a: ObjectType, b: ObjectType) =>
  a.fields.length === b.fields.length && a.fields.every((f, i) => f.key === b.fields[i].key && f.optional === b.fields[i].optional && sameShape(f.shape, b.fields[i].shape))

/** Split a URL from the explorer into the contract's base URL and the endpoint's path and query keys. */
function splitUrl(url: string, baseUrl: string, firstEndpoint: boolean): { baseUrl: string; path: string; query: string[] } {
  let path = url.trim() || '/'
  let origin = ''
  let query: string[] = []
  try {
    const u = new URL(path)
    origin = u.origin
    path = decodeURIComponent(u.pathname)
    query = [...u.searchParams.keys()]
  } catch {
    const [p, q] = path.split('?')
    path = p
    query = q ? [...new URLSearchParams(q).keys()] : []
  }
  let base = baseUrl
  if (!base && firstEndpoint && origin) {
    // keep a version prefix in the base URL: https://api.example.com/v1/orders → base …/v1, path /orders
    const prefix = /^\/(?:api\/)?v\d+(?=\/)|^\/api(?=\/)/.exec(path)?.[0] ?? ''
    base = origin + prefix
    path = path.slice(prefix.length)
  } else if (base) {
    const basePath = (() => {
      try {
        return new URL(base).pathname.replace(/\/$/, '')
      } catch {
        return base.replace(/\/$/, '')
      }
    })()
    const full = origin ? origin + path : path
    if (full.startsWith(base.replace(/\/$/, '') + '/')) path = full.slice(base.replace(/\/$/, '').length)
    else if (basePath && path.startsWith(basePath + '/')) path = path.slice(basePath.length)
  }
  if (!path.startsWith('/')) path = `/${path}`
  return { baseUrl: base, path, query: [...new Set(query)] }
}

/**
 * Add the API explorer's schema to the contract as one endpoint whose
 * response is the sample. Its types join the contract's: a type that's
 * already there (same name, same fields) is reused; a different one with the
 * same name gets a new name.
 */
export function addSchemaEndpoint(contract: Contract, schema: Schema, request: { id: string; method: HttpMethod; url: string }): AddedSchema {
  const names = new Map<string, string>()
  const types = [...contract.types]
  const renamed: [string, string][] = []
  const reused: string[] = []
  const rename = (s: Shape) => mapRefs(s, (name) => ({ kind: 'ref', name: names.get(name) ?? name }))
  for (const type of typesInDependencyOrder(schema.types)) {
    const incoming: ObjectType = { name: type.name, fields: type.fields.map((f) => ({ ...f, shape: rename(f.shape) })) }
    const existing = types.find((t) => t.name === type.name)
    if (existing && sameFields(existing, incoming)) {
      reused.push(type.name)
      continue
    }
    if (existing) {
      const name = uniqueTypeName({ ...contract, types }, type.name)
      names.set(type.name, name)
      renamed.push([type.name, name])
      incoming.name = name
    }
    types.push(incoming)
  }
  const { baseUrl, path, query } = splitUrl(request.url, contract.baseUrl, contract.endpoints.length === 0)
  const status = request.method === 'POST' ? 201 : 200
  const endpoint = syncPathParams({
    ...newEndpoint(request.id, request.method, path),
    params: query.map((name) => ({ name, in: 'query', shape: { kind: 'string' }, required: false })),
    responses: [{ status, description: statusText(status), body: rename(schema.root) }],
  })
  return { contract: { ...contract, baseUrl, types, endpoints: [...contract.endpoints, endpoint] }, endpointId: endpoint.id, renamed, reused }
}

/* ---------- problems ---------- */

export type ContractTarget = { kind: 'endpoint'; id: string } | { kind: 'type'; name: string } | { kind: 'contract' }

export interface ContractProblem {
  target: ContractTarget
  message: string
  /** a ref to a type that's gone: code still builds (it becomes `unknown`); every other problem leaves its endpoint or field out */
  missingType?: boolean
}

const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Everything that keeps the contract from being exported as it is, in plain words. */
export function contractProblems(contract: Contract): ContractProblem[] {
  const out: ContractProblem[] = []
  const typeNames = new Set(contract.types.map((t) => t.name))
  const missing = (s: Shape | undefined) => (s ? refsOf(s).filter((n) => !typeNames.has(n)) : [])
  const gone = (target: ContractTarget, names: string[]) => {
    for (const n of new Set(names)) out.push({ target, message: `Points at ${n}, which isn’t a type any more. Pick another type.`, missingType: true })
  }

  const seenTypes = new Set<string>()
  for (const t of contract.types) {
    const target: ContractTarget = { kind: 'type', name: t.name }
    if (!TYPE_NAME.test(t.name)) out.push({ target, message: 'Type names are letters, digits and underscores, starting with a letter, like Order.' })
    else if (seenTypes.has(t.name)) out.push({ target, message: `Two types are called ${t.name}. Rename one.` })
    seenTypes.add(t.name)
    const keys = new Set<string>()
    for (const f of t.fields) {
      if (!f.key.trim()) out.push({ target, message: 'A field has no name.' })
      else if (keys.has(f.key)) out.push({ target, message: `Two fields are called ${f.key}.` })
      keys.add(f.key)
    }
    gone(
      target,
      t.fields.flatMap((f) => missing(f.shape)),
    )
  }

  const seenRoutes = new Map<string, ContractEndpoint>()
  const ownNames = new Map<string, ContractEndpoint>()
  for (const e of contract.endpoints) {
    const target: ContractTarget = { kind: 'endpoint', id: e.id }
    const say = (message: string) => out.push({ target, message })
    if (!e.path.startsWith('/')) say('Start the path with a slash, like /orders.')
    if (/[?#]/.test(e.path)) say('Put query params in the list below, not in the path.')
    if (/\s/.test(e.path)) say('Paths can’t have spaces.')
    const inPath = pathParamNames(e.path)
    const twice = inPath.find((n, i) => inPath.indexOf(n) !== i)
    if (twice) say(`{${twice}} is in the path twice.`)
    const route = `${e.method} ${pathPattern(e.path)}`
    const first = seenRoutes.get(route)
    if (first) say(`${e.method} ${openApiPath(first.path)} is already an endpoint.`)
    else seenRoutes.set(route, e)

    const own = e.operationId?.trim()
    if (own) {
      if (!isIdentifier(own)) say('The function name must be a valid name in code, like getOrder.')
      else if (ownNames.has(own)) say(`Another endpoint’s function is also called ${own}.`)
      else ownNames.set(own, e)
    }

    const query = new Set<string>()
    for (const p of e.params) {
      if (p.in === 'path') {
        if (!isParamShape(p.shape, false)) say(`Path param ${p.name} must be a string, number, boolean or enum.`)
        continue
      }
      if (!p.name.trim()) say('A query param has no name.')
      else if (query.has(p.name) || inPath.includes(p.name)) say(`Two params are called ${p.name}.`)
      else if (!isParamShape(p.shape, true)) say(`Query param ${p.name} must be a string, number, boolean or enum, or a list of them.`)
      query.add(p.name)
    }

    if (e.body && !hasRequestBody(e.method)) say(`${e.method} requests don’t send a body. Remove it, or use POST, PUT or PATCH.`)
    if (!e.responses.length) say('Add at least one response.')
    const statuses = new Set<ResponseStatus>()
    for (const r of e.responses) {
      if (r.status !== 'default' && !(Number.isInteger(r.status) && r.status >= 100 && r.status <= 599)) say('Status codes go from 100 to 599.')
      else if (statuses.has(r.status)) say(`Two responses are for ${r.status}.`)
      statuses.add(r.status)
    }
    gone(target, [...e.params.flatMap((p) => missing(p.shape)), ...missing(e.body?.shape), ...e.responses.flatMap((r) => missing(r.body))])
  }
  return out
}

/**
 * The contract the code generators see: types with bad or repeated names and
 * endpoints with problems are left out, and refs to missing types become
 * `unknown`, so the code always compiles. `left` counts what was left out.
 */
export function usableContract(contract: Contract): { contract: Contract; leftOut: { endpoints: number; types: number } } {
  const problems = contractProblems(contract)
  const broken = new Set(problems.filter((p) => !p.missingType && p.target.kind === 'endpoint').map((p) => (p.target as { id: string }).id))
  const seen = new Set<string>()
  const types: ObjectType[] = []
  for (const t of contract.types) {
    if (!TYPE_NAME.test(t.name) || seen.has(t.name)) continue
    seen.add(t.name)
    const keys = new Set<string>()
    types.push({ ...t, fields: t.fields.filter((f) => f.key.trim() && !keys.has(f.key) && keys.add(f.key)) })
  }
  const endpoints = contract.endpoints.filter((e) => !broken.has(e.id))
  const kept = new Set(types.map((t) => t.name))
  const clean = mapShapes({ ...contract, types, endpoints }, (s) => mapRefs(s, (name) => (kept.has(name) ? { kind: 'ref', name } : { kind: 'unknown' })))
  return { contract: clean, leftOut: { endpoints: contract.endpoints.length - endpoints.length, types: contract.types.length - types.length } }
}
