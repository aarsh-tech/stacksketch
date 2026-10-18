import { toMock } from '../generate/mock'
import { hasRequestBody, isSuccess, openApiPath, pathParamNames, statusText, successResponse, upgradeContract, usableContract } from '../contract/model'
import type { Contract, ContractEndpoint, ResponseStatus } from '../contract/types'
import { fromOpenApi } from '../openapi/import'
import type { ObjectType, Shape } from '../types'

/**
 * A fake API served from a contract: every endpoint answers with data from the
 * mock generator, shaped like its success response. Pure: the CLI turns HTTP
 * requests into `MockRequest`s and writes back the `MockResponse`.
 */

export interface MockRequest {
  method: string
  /** the path and query, e.g. `/v1/orders?status=open` */
  url: string
  /** parsed JSON, if the request had a body */
  body?: unknown
  headers?: Record<string, string | undefined>
}

export interface MockResponse {
  status: number
  headers: Record<string, string>
  /** JSON to send; none for 204 and other empty responses */
  body?: unknown
  /** wait this long before answering, in milliseconds */
  delay: number
}

export interface MockServerOptions {
  /** same seed, same data */
  seed?: number
  /** added to every response, unless the endpoint sets its own */
  delay?: number
  /** POST then GET returns what was created; PUT, PATCH and DELETE change it */
  crud?: boolean
  /** paths start after this, e.g. `/v1`; taken from the base URL when not set */
  basePath?: string
}

export interface MockRoute {
  method: string
  path: string
  summary: string
}

export interface MockApi {
  handle: (req: MockRequest) => MockResponse
  routes: MockRoute[]
  /** forget everything created through CRUD */
  reset: () => void
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
}

/* ---------- reading a contract file ---------- */

/** A saved contract (from the workbench) or an OpenAPI 3 document, already parsed from JSON or YAML. */
export function readContractFile(value: unknown): { contract: Contract; warnings: string[] } {
  if (typeof value === 'object' && value !== null && 'openapi' in value) {
    let n = 0
    return fromOpenApi(value, () => `e${++n}`)
  }
  const c = value as Contract
  if (!c || typeof c !== 'object' || !Array.isArray(c.endpoints) || !Array.isArray(c.types) || typeof c.version !== 'number')
    throw new Error('This isn’t a contract file. Export one from the API contract in Stacksketch (Download contract.json), or pass an OpenAPI 3 file.')
  return { contract: upgradeContract(c), warnings: [] }
}

/* ---------- routing ---------- */

interface Route {
  endpoint: ContractEndpoint
  pattern: RegExp
  names: string[]
  /** static segments outrank params: `/orders/new` before `/orders/{id}` */
  rank: number
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function route(endpoint: ContractEndpoint, basePath: string): Route {
  const path = openApiPath(endpoint.path).replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)
  const source = segments.map((s) => (/^\{\w+\}$/.test(s) ? '/([^/]+)' : `/${escape(s)}`)).join('')
  return {
    endpoint,
    pattern: new RegExp(`^${escape(basePath)}${source || ''}/?$`),
    names: pathParamNames(path),
    rank: segments.filter((s) => !s.startsWith('{')).length * 100 - segments.length,
  }
}

/** `/orders/{id}` → `/orders`: the collection an item path belongs to, or null when the path doesn't end in a param. */
const collectionOf = (path: string) => (/\/\{\w+\}\/?$/.test(path) ? path.replace(/\/\{\w+\}\/?$/, '') || '/' : null)

/* ---------- data ---------- */

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The value of a path param as its type wants it: `"7"` is 7 for an integer id. */
function coerce(value: string, shape: Shape | undefined): string | number | boolean {
  const s = shape?.kind === 'union' ? shape.options.find((o) => o.kind !== 'null') : shape
  if (s?.kind === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  if (s?.kind === 'boolean') return value === 'true'
  return value
}

/** Put path params into the object they name: `{orderId}` fills `orderId`, or `id` when that's the last param. */
function echoParams(data: unknown, params: Record<string, string | number | boolean>, last: string | undefined) {
  if (!isObject(data)) return data
  for (const [name, value] of Object.entries(params)) {
    if (name in data) data[name] = value
    else if (name === last && 'id' in data) data.id = value
  }
  return data
}

export function createMockApi(contract: Contract, options: MockServerOptions = {}): MockApi {
  const { contract: c } = usableContract(contract)
  const seed = options.seed ?? 1
  const basePath = (options.basePath ?? (() => {
    try {
      return new URL(c.baseUrl).pathname
    } catch {
      return c.baseUrl.startsWith('/') ? c.baseUrl : ''
    }
  })()).replace(/\/+$/, '')
  const types: ObjectType[] = c.types
  const routes = c.endpoints.map((e) => route(e, basePath)).sort((a, b) => b.rank - a.rank)
  /** collection path → items created through POST, newest last */
  const store = new Map<string, Record<string, unknown>[]>()

  const mock = (shape: Shape, key: string, url: string) => toMock({ version: 2, rootName: key, root: shape, types }, { seed: seed ^ hash(url), rootCount: 5 })

  const respond = (status: number, body: unknown, delay: number, extra: Record<string, string> = {}): MockResponse => ({
    status,
    headers: { ...CORS, ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...extra },
    ...(body === undefined ? {} : { body }),
    delay,
  })

  /** The id field of a created item and its next value. */
  const idOf = (item: Record<string, unknown>, param: string | undefined) => (param && param in item ? param : 'id' in item ? 'id' : param)

  const handle = (req: MockRequest): MockResponse => {
    const method = req.method.toUpperCase()
    const url = new URL(req.url, 'http://mock.local')
    const path = decodeURIComponent(url.pathname)
    const header = (name: string) => req.headers?.[name] ?? req.headers?.[name.toLowerCase()]
    if (method === 'OPTIONS') return respond(204, undefined, 0)

    const matches = routes.map((r) => ({ r, m: r.pattern.exec(path) })).filter((x) => x.m)
    const hit = matches.find((x) => x.r.endpoint.method === method)
    if (!hit) {
      if (matches.length)
        return respond(405, { message: `${path} doesn’t take ${method}. It takes ${[...new Set(matches.map((x) => x.r.endpoint.method))].join(', ')}.` }, 0, {
          Allow: [...new Set(matches.map((x) => x.r.endpoint.method))].join(', '),
        })
      return respond(404, { message: `No endpoint for ${method} ${path} in the contract.`, endpoints: routes.map((r) => `${r.endpoint.method} ${basePath}${openApiPath(r.endpoint.path)}`) }, 0)
    }

    const e = hit.r.endpoint
    const params: Record<string, string | number | boolean> = {}
    hit.r.names.forEach((name, i) => {
      params[name] = coerce(hit.m![i + 1], e.params.find((p) => p.in === 'path' && p.name === name)?.shape)
    })
    const last = hit.r.names.at(-1)

    // ?__status=500 and ?__delay=2000 (or x-mock-status / x-mock-delay headers) override everything, for building error and loading states
    const delayAsk = url.searchParams.get('__delay') ?? header('x-mock-delay')
    const statusAsk = url.searchParams.get('__status') ?? header('x-mock-status')
    const delay = delayAsk !== null && delayAsk !== undefined && Number.isFinite(Number(delayAsk)) ? Math.max(0, Number(delayAsk)) : (e.mock?.delay ?? options.delay ?? 0)
    const forced: ResponseStatus | undefined = statusAsk && /^[1-5]\d\d$/.test(statusAsk) ? Number(statusAsk) : e.mock?.status

    const answer = (status: ResponseStatus, body: unknown) => {
      const code = status === 'default' ? 500 : status
      return respond(code, code === 204 || code === 304 ? undefined : body, delay)
    }
    const bodyFor = (status: ResponseStatus) => {
      const r = e.responses.find((x) => x.status === status) ?? (isSuccess(status) ? undefined : e.responses.find((x) => x.status === 'default'))
      if (r?.body) return echoParams(mock(r.body, e.resource || 'response', `${method} ${url.pathname}${url.search} ${status}`), params, last)
      return isSuccess(status) ? undefined : { message: r?.description || statusText(status) }
    }

    if (forced !== undefined && !(isSuccess(forced) && forced === successResponse(e)?.status)) return answer(forced, bodyFor(forced))

    if (hasRequestBody(method as ContractEndpoint['method']) && e.body?.required && req.body === undefined)
      return answer(400, { message: `${method} ${openApiPath(e.path)} needs a JSON body. Send one with Content-Type: application/json.` })

    const ok = successResponse(e)
    const status = ok?.status ?? 200
    let data = bodyFor(status)

    if (options.crud ?? true) {
      const routePath = openApiPath(e.path).replace(/\/+$/, '') || '/'
      const collection = collectionOf(routePath)
      const items = store.get(collection ?? routePath)
      if (method === 'POST' && !collection) {
        // create: what the caller sent wins over made-up values
        const created = { ...(isObject(data) ? data : {}), ...(isObject(req.body) ? req.body : {}) }
        const list = store.get(routePath) ?? []
        list.push(created)
        store.set(routePath, list)
        data = created
      } else if (collection && last) {
        const id = params[last]
        const list = store.get(collection) ?? []
        const i = list.findIndex((item) => {
          const key = idOf(item, last)
          return key !== undefined && String(item[key]) === String(id)
        })
        if (i >= 0) {
          if (method === 'DELETE') {
            list.splice(i, 1)
            data = undefined
          } else if (method === 'PUT') data = list[i] = { ...(isObject(req.body) ? req.body : {}), [idOf(list[i], last) as string]: list[i][idOf(list[i], last) as string] }
          else if (method === 'PATCH') data = list[i] = { ...list[i], ...(isObject(req.body) ? req.body : {}) }
          else if (method === 'GET') data = list[i]
        } else if ((method === 'PUT' || method === 'PATCH') && isObject(data) && isObject(req.body)) data = { ...data, ...req.body, ...params }
      } else if (method === 'GET' && items?.length) {
        // a list: newest created items first, in the array the response holds
        if (Array.isArray(data)) data = [...[...items].reverse(), ...data]
        else if (isObject(data)) {
          const key = Object.keys(data).find((k) => Array.isArray(data && (data as Record<string, unknown>)[k]))
          if (key) data = { ...data, [key]: [...[...items].reverse(), ...(data[key] as unknown[])] }
        }
      }
    }
    return answer(status, data)
  }

  return {
    handle,
    routes: routes
      .map((r) => ({ method: r.endpoint.method, path: `${basePath}${openApiPath(r.endpoint.path)}`, summary: r.endpoint.summary }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    reset: () => store.clear(),
  }
}
