import { describe, expect, it } from 'vitest'

import {
  buildRequest,
  checkContract,
  checkShape,
  emptyRequest,
  findEndpoint,
  fromPostmanCollection,
  fromPostmanEnvironment,
  interpolate,
  newEndpoint,
  requestFromCurl,
  requestFromEndpoint,
  requestProblem,
  runAssertions,
  runCaptures,
  runReport,
  runRequests,
  sendWithFetch,
  setVariables,
  splitQuery,
  toCurl,
  toFetchSnippet,
  toPostmanCollection,
  valueAtPath,
  variablesOf,
  variablesUsed,
} from './index'
import type { ApiRequest, Contract, Environment, SendRequest, SendResult, Shape, SuccessfulResult } from './index'

const ref = (name: string): Shape => ({ kind: 'ref', name })
const int: Shape = { kind: 'number', integer: true }

const shop = (): Contract => ({
  version: 1,
  title: 'Shop',
  apiVersion: '1',
  baseUrl: 'https://api.example.in/v1',
  types: [
    {
      name: 'Order',
      fields: [
        { key: 'id', shape: int, optional: false },
        { key: 'status', shape: { kind: 'enum', values: ['pending', 'shipped'] }, optional: false },
        { key: 'email', shape: { kind: 'string', format: 'email' }, optional: true },
        { key: 'note', shape: { kind: 'union', options: [{ kind: 'string' }, { kind: 'null' }] }, optional: false },
      ],
    },
    { name: 'OrderList', fields: [{ key: 'orders', shape: { kind: 'array', items: ref('Order') }, optional: false }] },
    { name: 'NewOrder', fields: [{ key: 'status', shape: { kind: 'enum', values: ['pending'] }, optional: false }] },
  ],
  endpoints: [
    {
      ...newEndpoint('list', 'GET', '/orders'),
      params: [
        { name: 'status', in: 'query', shape: { kind: 'enum', values: ['pending', 'shipped'] }, required: false },
        { name: 'page', in: 'query', shape: int, required: true },
      ],
      responses: [{ status: 200, description: '', body: ref('OrderList') }],
    },
    { ...newEndpoint('create', 'POST', '/orders'), body: { shape: ref('NewOrder'), required: true }, responses: [{ status: 201, description: '', body: ref('Order') }] },
    {
      ...newEndpoint('get', 'GET', '/orders/{id}'),
      params: [{ name: 'id', in: 'path', shape: int, required: true }],
      responses: [
        { status: 200, description: '', body: ref('Order') },
        { status: 'default', description: 'Error', body: { kind: 'unknown' } },
      ],
    },
    { ...newEndpoint('latest', 'GET', '/orders/latest'), responses: [{ status: 200, description: '', body: ref('Order') }] },
    { ...newEndpoint('delete', 'DELETE', '/orders/{id}'), responses: [{ status: 204, description: '' }] },
  ],
})

const ok = (body: unknown, patch: Partial<SuccessfulResult> = {}): SuccessfulResult => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: true, status: 200, statusText: 'OK', headers: [['Content-Type', 'application/json']], body: text, ms: 120, size: text.length, url: 'https://api.example.in/v1/orders/1', ...patch }
}

describe('variables', () => {
  it('fills {{names}} and lists the ones it can’t', () => {
    expect(interpolate('{{base}}/orders/{{ id }}?t={{token}}', { base: 'https://x.dev', id: '7' })).toEqual({ text: 'https://x.dev/orders/7?t={{token}}', missing: ['token'] })
  })

  it('reads only ticked rows, and finds every variable a request uses', () => {
    const env: Environment = { id: 'e', name: 'Local', variables: [{ key: 'a', value: '1', enabled: true }, { key: 'b', value: '2', enabled: false }] }
    expect(variablesOf(env)).toEqual({ a: '1' })
    const r = emptyRequest('r', { url: '{{base}}/x', headers: [{ key: 'X-Team', value: '{{team}}', enabled: true }], auth: { kind: 'bearer', token: '{{token}}' } })
    expect(variablesUsed(r)).toEqual(['base', 'team', 'token'])
  })

  it('sets captured values, updating rows that exist', () => {
    const env: Environment = { id: 'e', name: 'Local', variables: [{ key: 'token', value: 'old', enabled: false }] }
    expect(setVariables(env, [{ variable: 'token', value: 'new' }, { variable: 'id', value: '9' }]).variables).toEqual([
      { key: 'token', value: 'new', enabled: true },
      { key: 'id', value: '9', enabled: true },
    ])
  })
})

describe('building a request', () => {
  it('moves a typed query string into rows', () => {
    expect(splitQuery('https://x.dev/orders?status=open&q=a%20b&flag')).toEqual({
      url: 'https://x.dev/orders',
      params: [
        { key: 'status', value: 'open', enabled: true },
        { key: 'q', value: 'a b', enabled: true },
        { key: 'flag', value: '', enabled: true },
      ],
    })
  })

  it('puts params, auth and the content type where they go', () => {
    const r = emptyRequest('r', {
      method: 'post',
      url: '{{base}}/orders',
      params: [
        { key: 'dry run', value: 'yes & no', enabled: true },
        { key: 'skip', value: '1', enabled: false },
      ],
      headers: [{ key: 'X-Team', value: 'web', enabled: true }],
      auth: { kind: 'bearer', token: '{{token}}' },
      body: { kind: 'json', text: '{ "status": "{{status}}" }', form: [] },
    })
    const built = buildRequest(r, { base: 'localhost:3000', token: 'abc', status: 'pending' })
    expect(built).toEqual({
      method: 'POST',
      url: 'http://localhost:3000/orders?dry%20run=yes%20%26%20no',
      headers: [
        ['X-Team', 'web'],
        ['Authorization', 'Bearer abc'],
        ['Content-Type', 'application/json'],
      ],
      body: '{ "status": "pending" }',
      missing: [],
    })
    expect(requestProblem(built, 'json')).toBeNull()
  })

  it('does basic auth, API keys in the query and form bodies', () => {
    const basic = buildRequest(emptyRequest('r', { url: 'https://x.dev', auth: { kind: 'basic', username: 'asha', password: 'pässword' } }), {})
    expect(basic.headers).toEqual([['Authorization', `Basic ${Buffer.from('asha:pässword').toString('base64')}`]])
    const key = buildRequest(emptyRequest('r', { url: 'x.dev/a?b=1', auth: { kind: 'apiKey', name: 'key', value: 's3cret', in: 'query' } }), {})
    expect(key.url).toBe('https://x.dev/a?b=1&key=s3cret')
    const form = buildRequest(emptyRequest('r', { method: 'POST', url: 'https://x.dev', body: { kind: 'form', text: '', form: [{ key: 'name', value: 'A&B', enabled: true }] } }), {})
    expect(form.body).toBe('name=A%26B')
    expect(form.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
  })

  it('leaves the body off GET, and keeps a Content-Type you set', () => {
    const get = buildRequest(emptyRequest('r', { url: 'https://x.dev', body: { kind: 'json', text: '{}', form: [] } }), {})
    expect(get.body).toBeUndefined()
    const own = buildRequest(emptyRequest('r', { method: 'PUT', url: 'https://x.dev', headers: [{ key: 'content-type', value: 'application/merge-patch+json', enabled: true }], body: { kind: 'json', text: '{}', form: [] } }), {})
    expect(own.headers).toEqual([['content-type', 'application/merge-patch+json']])
  })

  it('says what stops it being sent', () => {
    expect(requestProblem(buildRequest(emptyRequest('r', { url: '{{base}}/x' }), {}), 'none')).toMatch(/No value for \{\{base\}\}/)
    expect(requestProblem(buildRequest(emptyRequest('r'), {}), 'none')).toMatch(/Type the URL/)
    expect(requestProblem(buildRequest(emptyRequest('r', { url: 'ftp://x.dev' }), {}), 'none')).toMatch(/Only http and https/)
    const bad = buildRequest(emptyRequest('r', { method: 'POST', url: 'https://x.dev', body: { kind: 'json', text: '{ nope', form: [] } }), {})
    expect(requestProblem(bad, 'json')).toMatch(/JSON body isn't valid/)
  })
})

describe('cURL and fetch', () => {
  it('round-trips through a cURL command', () => {
    const r = emptyRequest('r', {
      method: 'POST',
      url: 'https://x.dev/orders',
      params: [{ key: 'v', value: '2', enabled: true }],
      headers: [{ key: 'X-Note', value: "it's fine", enabled: true }],
      auth: { kind: 'bearer', token: 'abc' },
      body: { kind: 'json', text: '{\n  "status": "pending"\n}', form: [] },
    })
    const curl = toCurl(buildRequest(r, {}))
    expect(curl).toContain("-H 'X-Note: it'\\''s fine'")
    const back = requestFromCurl(curl, 'r2')
    expect(back).toMatchObject({ method: 'POST', url: 'https://x.dev/orders', params: r.params, auth: { kind: 'bearer', token: 'abc' }, body: { kind: 'json', text: '{\n  "status": "pending"\n}' } })
    expect(back.headers).toEqual([{ key: 'X-Note', value: "it's fine", enabled: true }])
  })

  it('reads form bodies from cURL', () => {
    const r = requestFromCurl("curl https://x.dev/login -d 'user=asha&pass=a%26b'", 'r')
    expect(r.method).toBe('POST')
    expect(r.body).toEqual({ kind: 'form', text: '', form: [{ key: 'user', value: 'asha', enabled: true }, { key: 'pass', value: 'a&b', enabled: true }] })
  })

  it('writes a fetch call that runs', async () => {
    const built = buildRequest(emptyRequest('r', { method: 'POST', url: 'https://x.dev/orders', body: { kind: 'json', text: '{"a":1}', form: [] } }), {})
    const calls: [string, RequestInit][] = []
    const fakeFetch = (url: string, init: RequestInit) => {
      calls.push([url, init])
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
    }
    const run = new Function('fetch', `return (async () => { ${toFetchSnippet(built)}; return data })()`) as (f: typeof fakeFetch) => Promise<unknown>
    await expect(run(fakeFetch)).resolves.toEqual({ ok: true })
    expect(calls[0][0]).toBe('https://x.dev/orders')
    expect(calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ a: 1 })
  })
})

describe('requests from the contract', () => {
  it('fills path params, ticks required query params and makes a body', () => {
    const c = shop()
    const get = requestFromEndpoint(c, c.endpoints[2], 'r')
    expect(get).toMatchObject({ method: 'GET', url: '{{baseUrl}}/orders/1', folder: 'Orders', endpointId: 'get' })
    expect(get.assertions.map((a) => [a.target, a.value])).toEqual([
      ['contract', ''],
      ['status', '200'],
    ])
    const list = requestFromEndpoint(c, c.endpoints[0], 'r')
    expect(list.params).toEqual([
      { key: 'status', value: 'pending', enabled: false },
      { key: 'page', value: '1', enabled: true },
    ])
    const create = requestFromEndpoint(c, c.endpoints[1], 'r')
    expect(create.body.kind).toBe('json')
    expect(checkShape(ref('NewOrder'), JSON.parse(create.body.text), c.types)).toEqual([])
  })

  it('finds the endpoint a URL hits, fixed segments first', () => {
    const c = shop()
    expect(findEndpoint(c, 'GET', 'https://api.example.in/v1/orders/42')?.id).toBe('get')
    expect(findEndpoint(c, 'GET', 'http://localhost:4010/v1/orders/latest?x=1')?.id).toBe('latest')
    expect(findEndpoint(c, 'DELETE', 'https://api.example.in/v1/orders/42')?.id).toBe('delete')
    expect(findEndpoint(c, 'PUT', 'https://api.example.in/v1/orders/42')).toBeUndefined()
  })
})

describe('checking responses against the contract', () => {
  it('passes a response that fits', () => {
    const c = shop()
    const check = checkContract(c, c.endpoints[2], 200, { id: 1, status: 'shipped', note: null })
    expect(check).toMatchObject({ ok: true, issues: [] })
  })

  it('doesn’t treat the range a sample had as a limit', () => {
    const range: Shape = { kind: 'number', integer: true, min: 1, max: 5 }
    expect(checkShape(range, 500, [])).toEqual([])
  })

  it('lists every way a body breaks its type', () => {
    const c = shop()
    const body = { orders: [{ id: 1.5, status: 'lost', email: 'nope', note: 3, extra: true }, { status: 'pending', note: 'x' }, 'oops'] }
    const { ok: fine, issues } = checkContract(c, c.endpoints[0], 200, body)
    expect(fine).toBe(false)
    expect(issues.map((i) => `${i.severity} ${i.path}: ${i.message}`)).toEqual([
      'error $.orders[0].id: Expected a whole number, got 1.5.',
      'error $.orders[0].status: Expected one of "pending", "shipped", got the string "lost".',
      'error $.orders[0].email: Expected a email, got the string "nope".',
      'error $.orders[0].note: Expected string | null, got the number 3.',
      'warning $.orders[0].extra: Not in the contract: Order has no extra.',
      'error $.orders[1].id: Missing: Order needs id (integer).',
      'error $.orders[2]: Expected Order (an object), got the string "oops".',
    ])
  })

  it('checks the status, default responses and empty bodies', () => {
    const c = shop()
    expect(checkContract(c, c.endpoints[0], 500, {}).issues[0].message).toBe("The contract doesn't list 500 Server error for GET /orders. It lists: 200.")
    expect(checkContract(c, c.endpoints[2], 404, { message: 'gone' }).ok).toBe(true)
    expect(checkContract(c, c.endpoints[4], 204, undefined).ok).toBe(true)
    expect(checkContract(c, c.endpoints[2], 200, undefined, '<html>').issues[0].message).toBe("Expected a JSON Order, but the body isn't JSON.")
  })
})

describe('tests on a response', () => {
  it('reads values by path', () => {
    const v = { data: { items: [{ id: 1 }, { id: 2 }], 'odd key': 'x' } }
    expect(valueAtPath(v, 'data.items[1].id')).toEqual({ found: true, value: 2 })
    expect(valueAtPath(v, '$.data.items.0.id')).toEqual({ found: true, value: 1 })
    expect(valueAtPath(v, 'data.items[-1].id')).toEqual({ found: true, value: 2 })
    expect(valueAtPath(v, 'data["odd key"]')).toEqual({ found: true, value: 'x' })
    expect(valueAtPath(v, 'data.nope')).toEqual({ found: false })
    expect(valueAtPath(v, '')).toEqual({ found: true, value: v })
  })

  it('runs every kind of check', () => {
    const c = shop()
    const r = emptyRequest('r', {
      endpointId: 'get',
      assertions: [
        { id: '1', target: 'status', path: '', op: 'equals', value: '200', enabled: true },
        { id: '2', target: 'time', path: '', op: 'lessThan', value: '100', enabled: true },
        { id: '3', target: 'header', path: 'content-type', op: 'contains', value: 'json', enabled: true },
        { id: '4', target: 'body', path: 'id', op: 'equals', value: '1', enabled: true },
        { id: '5', target: 'body', path: 'status', op: 'matches', value: '^ship', enabled: true },
        { id: '6', target: 'body', path: 'missing', op: 'exists', value: '', enabled: true },
        { id: '7', target: 'contract', path: '', op: 'matches', value: '', enabled: true },
        { id: '8', target: 'status', path: '', op: 'equals', value: '500', enabled: false },
      ],
    })
    const results = runAssertions(r, ok({ id: 1, status: 'shipped', note: null }), c)
    expect(results.map((x) => [x.label, x.pass, x.detail])).toEqual([
      ['Status equals 200', true, undefined],
      ['Time (ms) is less than 100', false, 'Got 120.'],
      ['Header content-type contains json', true, undefined],
      ['Body id equals 1', true, undefined],
      ['Body status matches /^ship/', true, undefined],
      ['Body missing exists', false, 'Got nothing there.'],
      ['Response matches the API contract (GET /orders/{id})', true, undefined],
    ])
  })

  it('finds the endpoint by URL when a request isn’t linked to one', () => {
    const r = emptyRequest('r', { assertions: [{ id: '1', target: 'contract', path: '', op: 'matches', value: '', enabled: true }] })
    const [result] = runAssertions(r, ok({ id: 'x', status: 'shipped', note: null }), shop())
    expect(result.pass).toBe(false)
    expect(result.detail).toBe('1 problem: $.id Expected integer, got the string "x".')
    const [none] = runAssertions(r, ok({}, { url: 'https://api.example.in/v1/users' }), shop())
    expect(none.detail).toMatch(/No endpoint in the API contract matches GET \/v1\/users/)
  })

  it('captures values for the next request', () => {
    const captures = [
      { id: '1', from: 'body' as const, path: 'token', variable: 'token', enabled: true },
      { id: '2', from: 'header' as const, path: 'x-request-id', variable: 'rid', enabled: true },
      { id: '3', from: 'body' as const, path: 'user.id', variable: 'userId', enabled: true },
    ]
    expect(runCaptures(captures, ok({ token: 'abc' }, { headers: [['X-Request-Id', 'r-1']] }))).toEqual({
      set: [
        { variable: 'token', value: 'abc' },
        { variable: 'rid', value: 'r-1' },
      ],
      failed: ['userId: nothing at user.id'],
    })
  })
})

describe('running a collection', () => {
  it('passes captured values along and reports each step', async () => {
    const requests: ApiRequest[] = [
      emptyRequest('login', {
        name: 'Log in',
        method: 'POST',
        url: '{{base}}/login',
        body: { kind: 'json', text: '{"user":"asha"}', form: [] },
        captures: [{ id: 'c', from: 'body', path: 'token', variable: 'token', enabled: true }],
        assertions: [{ id: 'a', target: 'status', path: '', op: 'equals', value: '200', enabled: true }],
      }),
      emptyRequest('me', { name: 'Who am I', url: '{{base}}/me', auth: { kind: 'bearer', token: '{{token}}' }, assertions: [{ id: 'a', target: 'body', path: 'name', op: 'equals', value: 'Asha', enabled: true }] }),
      emptyRequest('nope', { name: 'Broken', url: '{{nowhere}}/x' }),
    ]
    const sent: SendRequest[] = []
    const send = (r: SendRequest): Promise<SendResult> => {
      sent.push(r)
      return Promise.resolve(r.url.endsWith('/login') ? ok({ token: 't-1' }) : ok({ name: 'Asha' }))
    }
    const env: Environment = { id: 'e', name: 'Local', variables: [{ key: 'base', value: 'http://localhost:3000', enabled: true }] }
    const { steps, environment } = await runRequests(requests, env, send)
    expect(sent[1].headers).toEqual([['Authorization', 'Bearer t-1']])
    expect(steps.map((s) => [s.name, s.pass, s.skipped ?? ''])).toEqual([
      ['Log in', true, ''],
      ['Who am I', true, ''],
      ['Broken', false, 'No value for {{nowhere}}. Add it to the environment, or pick another environment.'],
    ])
    expect(variablesOf(environment)).toEqual({ base: 'http://localhost:3000', token: 't-1' })
    expect(runReport('Shop', steps, new Date('2026-10-18T09:30:00Z'))).toContain('2 of 3 requests passed · 2026-10-18 09:30 UTC')
  })

  it('stops at the first failure when asked', async () => {
    const requests = [emptyRequest('a', { url: 'https://x.dev/a' }), emptyRequest('b', { url: 'https://x.dev/b' })]
    const send = (): Promise<SendResult> => Promise.resolve({ ok: false, kind: 'network', error: 'Connection refused' })
    const { steps } = await runRequests(requests, { id: 'e', name: 'E', variables: [] }, send, { stopOnFailure: true })
    expect(steps).toHaveLength(1)
  })
})

describe('Postman', () => {
  let n = 0
  const ids = () => `id${++n}`

  it('imports a v2.1 collection with folders, auth, bodies and variables', () => {
    const collection = {
      info: { name: 'Shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      variable: [{ key: 'baseUrl', value: 'https://api.shop.in' }],
      item: [
        {
          name: 'Orders',
          item: [
            {
              name: 'List orders',
              event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
              request: { method: 'GET', header: [{ key: 'Accept', value: 'application/json' }], url: { raw: '{{baseUrl}}/orders?page=1&status=open', query: [{ key: 'page', value: '1' }, { key: 'status', value: 'open', disabled: true }] } },
            },
            { name: 'Get order', request: { method: 'GET', url: { raw: '{{baseUrl}}/orders/:id', variable: [{ key: 'id', value: '42' }] } } },
          ],
        },
        { name: 'Log in', request: { method: 'POST', auth: { type: 'noauth' }, url: '{{baseUrl}}/login', body: { mode: 'raw', raw: '{"user":"asha"}', options: { raw: { language: 'json' } } } } },
        { name: 'Upload', request: { method: 'POST', url: '{{baseUrl}}/files', body: { mode: 'formdata', formdata: [] } } },
      ],
    }
    const imported = fromPostmanCollection(collection, ids)
    expect(imported.name).toBe('Shop API')
    expect(imported.environment?.variables).toEqual([{ key: 'baseUrl', value: 'https://api.shop.in', enabled: true }])
    expect(imported.requests.map((r) => [r.folder, r.name, r.method, r.url, r.auth.kind, r.body.kind])).toEqual([
      ['Orders', 'List orders', 'GET', '{{baseUrl}}/orders', 'bearer', 'none'],
      ['Orders', 'Get order', 'GET', '{{baseUrl}}/orders/42', 'bearer', 'none'],
      ['', 'Log in', 'POST', '{{baseUrl}}/login', 'none', 'json'],
      ['', 'Upload', 'POST', '{{baseUrl}}/files', 'bearer', 'none'],
    ])
    expect(imported.requests[0].params).toEqual([{ key: 'page', value: '1', enabled: true }, { key: 'status', value: 'open', enabled: false }])
    expect(imported.skipped).toHaveLength(2)
  })

  it('exports a collection Postman can read back', () => {
    const requests = [
      emptyRequest('a', { name: 'Create', folder: 'Orders', method: 'POST', url: '{{baseUrl}}/orders', auth: { kind: 'bearer', token: '{{token}}' }, body: { kind: 'json', text: '{"a":1}', form: [] } }),
      emptyRequest('b', { name: 'Health', url: '{{baseUrl}}/health', params: [{ key: 'full', value: '1', enabled: true }] }),
    ]
    const back = fromPostmanCollection(JSON.parse(JSON.stringify(toPostmanCollection('Shop', requests))), ids)
    expect(back.requests.map((r) => [r.folder, r.name, r.method, r.url, r.auth, r.body.text, r.params])).toEqual([
      ['Orders', 'Create', 'POST', '{{baseUrl}}/orders', { kind: 'bearer', token: '{{token}}' }, '{"a":1}', []],
      ['', 'Health', 'GET', '{{baseUrl}}/health', { kind: 'none' }, '', [{ key: 'full', value: '1', enabled: true }]],
    ])
  })

  it('imports an environment, and says when a file isn’t one', () => {
    expect(fromPostmanEnvironment({ name: 'Staging', values: [{ key: 'baseUrl', value: 'https://staging.shop.in', enabled: true }, { key: 'x', value: '', enabled: false }] }, 'e')).toEqual({
      id: 'e',
      name: 'Staging',
      variables: [
        { key: 'baseUrl', value: 'https://staging.shop.in', enabled: true },
        { key: 'x', value: '', enabled: false },
      ],
    })
    expect(() => fromPostmanCollection({ hello: 1 }, ids)).toThrow(/isn’t a Postman collection/)
  })
})

describe('sending', () => {
  it('turns a response into a result, Set-Cookie lines and all', async () => {
    const fakeFetch = ((_url: string, init: RequestInit) => {
      expect(init).toMatchObject({ method: 'POST', credentials: 'omit', body: '{}' })
      const headers = new Headers([['content-type', 'application/json']])
      headers.append('set-cookie', 'a=1')
      headers.append('set-cookie', 'b=2')
      return Promise.resolve(new Response('{"ok":true}', { status: 201, statusText: 'Created', headers }))
    }) as unknown as typeof fetch
    const r = await sendWithFetch(fakeFetch, { method: 'POST', url: 'http://localhost:3000/x', headers: [], body: '{}' }, 'proxy')
    expect(r).toMatchObject({ ok: true, status: 201, statusText: 'Created', body: '{"ok":true}', size: 11 })
    expect(r.ok && r.headers.filter(([k]) => k === 'set-cookie')).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ])
  })

  it('summarises binary bodies', async () => {
    const fakeFetch = (() => Promise.resolve(new Response(new Uint8Array(2048), { headers: { 'content-type': 'image/png' } }))) as unknown as typeof fetch
    const r = await sendWithFetch(fakeFetch, { method: 'GET', url: 'https://x.dev/a.png', headers: [] }, 'proxy')
    expect(r.ok && r.body).toBe('[2.0 KB of image/png, not shown]')
  })

  it('explains refused connections, CORS and timeouts', async () => {
    const refused = (() => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))) as unknown as typeof fetch
    expect(await sendWithFetch(refused, { method: 'GET', url: 'http://localhost:9/x', headers: [] }, 'proxy')).toEqual({
      ok: false,
      kind: 'network',
      error: 'Nothing is listening at localhost:9. Is the server running, and on that port?',
    })
    const blocked = (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch
    expect(await sendWithFetch(blocked, { method: 'GET', url: 'https://x.dev', headers: [] }, 'page')).toMatchObject({ ok: false, kind: 'cors' })
    const slow = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch
    expect(await sendWithFetch(slow, { method: 'GET', url: 'https://x.dev', headers: [], timeout: 20 }, 'extension')).toMatchObject({ ok: false, kind: 'timeout' })
    expect(await sendWithFetch(slow, { method: 'GET', url: 'nope', headers: [] }, 'page')).toMatchObject({ ok: false, kind: 'invalid' })
  })
})
