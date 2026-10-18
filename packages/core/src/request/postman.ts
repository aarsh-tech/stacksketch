import { emptyRequest, splitQuery } from './model'
import type { ApiRequest, Environment, KeyValue, RequestAuth } from './types'

/**
 * Postman collections (v2.0 and v2.1) and environments in and out, so a team
 * can bring what it already has. Postman writes variables as `{{name}}` too,
 * so they carry over as they are. Scripts aren't run; they're listed as
 * skipped.
 */

interface PmKeyValue {
  key?: string
  value?: unknown
  disabled?: boolean
}

interface PmUrl {
  raw?: string
  protocol?: string
  host?: string | string[]
  port?: string
  path?: string | string[]
  query?: PmKeyValue[]
  variable?: PmKeyValue[]
}

interface PmAuth {
  type?: string
  bearer?: PmKeyValue[] | Record<string, unknown>
  basic?: PmKeyValue[] | Record<string, unknown>
  apikey?: PmKeyValue[] | Record<string, unknown>
}

interface PmRequest {
  method?: string
  header?: PmKeyValue[] | string
  url?: string | PmUrl
  auth?: PmAuth
  description?: string | { content?: string }
  body?: { mode?: string; raw?: string; urlencoded?: PmKeyValue[]; options?: { raw?: { language?: string } } }
}

interface PmItem {
  name?: string
  item?: PmItem[]
  request?: PmRequest | string
  event?: unknown[]
  auth?: PmAuth
}

interface PmCollection {
  info?: { name?: string; schema?: string }
  item?: PmItem[]
  variable?: PmKeyValue[]
  auth?: PmAuth
}

export interface PostmanImport {
  name: string
  requests: ApiRequest[]
  /** the collection's own variables, as an environment */
  environment?: Environment
  /** what didn't carry over, in plain words */
  skipped: string[]
}

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

const kv = (list: PmKeyValue[] | undefined): KeyValue[] => (Array.isArray(list) ? list.filter((r) => r.key).map((r) => ({ key: r.key ?? '', value: str(r.value), enabled: !r.disabled })) : [])

/** Postman's auth fields come as a list of { key, value } (v2.1) or an object (v2.0). */
function authField(fields: PmKeyValue[] | Record<string, unknown> | undefined, key: string): string {
  if (!fields) return ''
  if (Array.isArray(fields)) return str(fields.find((f) => f.key === key)?.value)
  return str(fields[key])
}

function readAuth(auth: PmAuth | undefined, skipped: Set<string>): RequestAuth | undefined {
  if (!auth?.type) return undefined
  if (auth.type === 'noauth') return { kind: 'none' }
  if (auth.type === 'bearer') return { kind: 'bearer', token: authField(auth.bearer, 'token') }
  if (auth.type === 'basic') return { kind: 'basic', username: authField(auth.basic, 'username'), password: authField(auth.basic, 'password') }
  if (auth.type === 'apikey') return { kind: 'apiKey', name: authField(auth.apikey, 'key') || 'X-API-Key', value: authField(auth.apikey, 'value'), in: authField(auth.apikey, 'in') === 'query' ? 'query' : 'header' }
  skipped.add(`${auth.type} auth isn't supported yet; those requests are set to no auth.`)
  return undefined
}

function rawUrl(url: string | PmUrl | undefined): { url: string; params: KeyValue[] } {
  if (!url) return { url: '', params: [] }
  if (typeof url === 'string') return splitQuery(url)
  let raw = url.raw
  if (!raw) {
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
    const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '')
    raw = `${url.protocol ? `${url.protocol}://` : ''}${host}${url.port ? `:${url.port}` : ''}${path ? `/${path}` : ''}`
  }
  const split = splitQuery(raw)
  // `query` keeps disabled rows that `raw` leaves out
  const params = url.query ? kv(url.query) : split.params
  // `:id` path variables with values become the values themselves
  let base = split.url
  for (const v of url.variable ?? []) if (v.key && str(v.value)) base = base.replace(new RegExp(`:${v.key}(?=/|$)`), str(v.value))
  return { url: base, params }
}

/** Read a Postman collection (v2.0 or v2.1). Throws with a plain message when it isn't one. */
export function fromPostmanCollection(value: unknown, ids: () => string): PostmanImport {
  const c = value as PmCollection
  if (!c || typeof c !== 'object' || !Array.isArray(c.item))
    throw new Error('That isn’t a Postman collection: it has no item list. In Postman, use Export on the collection and pick Collection v2.1.')
  const skipped = new Set<string>()
  const requests: ApiRequest[] = []
  const rootAuth = readAuth(c.auth, skipped)
  const walk = (items: PmItem[], folder: string[], inherited: RequestAuth | undefined) => {
    for (const item of items) {
      const auth = readAuth(item.auth, skipped) ?? inherited
      if (Array.isArray(item.item)) {
        walk(item.item, [...folder, item.name ?? 'Folder'], auth)
        continue
      }
      if (!item.request) continue
      if (Array.isArray(item.event) && item.event.length) skipped.add('Pre-request and test scripts aren’t run here. Add checks on the Tests tab instead.')
      const r: PmRequest = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request
      const { url, params } = rawUrl(r.url)
      const headers = Array.isArray(r.header) ? kv(r.header) : []
      let body: ApiRequest['body'] = { kind: 'none', text: '', form: [] }
      const mode = r.body?.mode
      if (mode === 'raw') {
        const text = r.body?.raw ?? ''
        const json = r.body?.options?.raw?.language === 'json' || headers.some((h) => h.key.toLowerCase() === 'content-type' && /json/i.test(h.value)) || /^\s*[[{]/.test(text)
        body = { kind: json ? 'json' : 'text', text, form: [] }
      } else if (mode === 'urlencoded') body = { kind: 'form', text: '', form: kv(r.body?.urlencoded) }
      else if (mode && mode !== 'none') skipped.add(`${mode} bodies (like file uploads and form-data) aren’t supported yet; those requests are imported without a body.`)
      const requestAuth = readAuth(r.auth, skipped) ?? auth ?? rootAuth
      const description = typeof r.description === 'string' ? r.description : r.description?.content
      requests.push(
        emptyRequest(ids(), {
          name: item.name || url || 'Request',
          folder: folder.join(' / '),
          method: (r.method ?? 'GET').toUpperCase(),
          url,
          params,
          headers,
          auth: requestAuth ?? { kind: 'none' },
          body,
          ...(description ? { description } : {}),
        }),
      )
    }
  }
  walk(c.item, [], rootAuth)
  const variables = kv(c.variable)
  const name = c.info?.name || 'Imported collection'
  return { name, requests, ...(variables.length ? { environment: { id: ids(), name, variables } } : {}), skipped: [...skipped] }
}

/** Read a Postman environment export. */
export function fromPostmanEnvironment(value: unknown, id: string): Environment {
  const e = value as { name?: string; values?: (PmKeyValue & { enabled?: boolean })[] }
  if (!e || typeof e !== 'object' || !Array.isArray(e.values)) throw new Error('That isn’t a Postman environment: it has no values list.')
  return { id, name: e.name || 'Imported environment', variables: e.values.filter((v) => v.key).map((v) => ({ key: v.key ?? '', value: str(v.value), enabled: v.enabled !== false })) }
}

/** A Postman v2.1 collection, so the requests open in Postman (or anything that reads it) too. */
export function toPostmanCollection(name: string, requests: ApiRequest[]): unknown {
  type Folder = { name: string; item: unknown[] }
  const root: unknown[] = []
  const folders = new Map<string, Folder>()
  const toItem = (r: ApiRequest) => {
    const auth =
      r.auth.kind === 'bearer'
        ? { type: 'bearer', bearer: [{ key: 'token', value: r.auth.token, type: 'string' }] }
        : r.auth.kind === 'basic'
          ? { type: 'basic', basic: [{ key: 'username', value: r.auth.username, type: 'string' }, { key: 'password', value: r.auth.password, type: 'string' }] }
          : r.auth.kind === 'apiKey'
            ? { type: 'apikey', apikey: [{ key: 'key', value: r.auth.name }, { key: 'value', value: r.auth.value }, { key: 'in', value: r.auth.in }] }
            : { type: 'noauth' }
    const query = r.params.filter((p) => p.key)
    const raw = r.url + (query.some((p) => p.enabled) ? `?${query.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join('&')}` : '')
    const body =
      r.body.kind === 'json' || r.body.kind === 'text'
        ? { mode: 'raw', raw: r.body.text, ...(r.body.kind === 'json' ? { options: { raw: { language: 'json' } } } : {}) }
        : r.body.kind === 'form'
          ? { mode: 'urlencoded', urlencoded: r.body.form.map((f) => ({ key: f.key, value: f.value, ...(f.enabled ? {} : { disabled: true }) })) }
          : undefined
    return {
      name: r.name,
      request: {
        method: r.method,
        header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, ...(h.enabled ? {} : { disabled: true }) })),
        url: { raw, query: query.map((p) => ({ key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }) })) },
        auth,
        ...(body ? { body } : {}),
        ...(r.description ? { description: r.description } : {}),
      },
    }
  }
  for (const r of requests) {
    if (!r.folder) {
      root.push(toItem(r))
      continue
    }
    let f = folders.get(r.folder)
    if (!f) {
      f = { name: r.folder, item: [] }
      folders.set(r.folder, f)
      root.push(f)
    }
    f.item.push(toItem(r))
  }
  return { info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: root }
}
