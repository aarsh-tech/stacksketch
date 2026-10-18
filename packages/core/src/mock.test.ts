import { describe, expect, it } from 'vitest'

import { createMockApi, newEndpoint, readContractFile, toOpenApi } from './index'
import type { Contract, Shape } from './index'

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
        { key: 'total', shape: { kind: 'number', integer: false }, optional: false },
      ],
    },
    { name: 'OrderList', fields: [{ key: 'orders', shape: { kind: 'array', items: ref('Order') }, optional: false }] },
    { name: 'Problem', fields: [{ key: 'message', shape: { kind: 'string' }, optional: false }] },
  ],
  endpoints: [
    { ...newEndpoint('list', 'GET', '/orders'), responses: [{ status: 200, description: '', body: ref('OrderList') }] },
    { ...newEndpoint('create', 'POST', '/orders'), body: { shape: ref('Order'), required: true }, responses: [{ status: 201, description: '', body: ref('Order') }] },
    {
      ...newEndpoint('get', 'GET', '/orders/{id}'),
      params: [{ name: 'id', in: 'path', shape: int, required: true }],
      responses: [
        { status: 200, description: '', body: ref('Order') },
        { status: 404, description: 'No such order', body: ref('Problem') },
      ],
    },
    { ...newEndpoint('patch', 'PATCH', '/orders/{id}'), responses: [{ status: 200, description: '', body: ref('Order') }] },
    { ...newEndpoint('delete', 'DELETE', '/orders/{id}'), responses: [{ status: 204, description: '' }] },
    { ...newEndpoint('latest', 'GET', '/orders/latest'), responses: [{ status: 200, description: '', body: ref('Order') }], mock: { delay: 800 } },
    { ...newEndpoint('broken', 'GET', '/broken'), responses: [{ status: 200, description: '' }], mock: { status: 503 } },
  ],
})

const order = { id: 4242, status: 'shipped', total: 10 }

describe('mock API', () => {
  it('serves every endpoint under the base path, with CORS', () => {
    const api = createMockApi(shop())
    const r = api.handle({ method: 'GET', url: '/v1/orders' })
    expect(r.status).toBe(200)
    expect(r.headers['Access-Control-Allow-Origin']).toBe('*')
    expect((r.body as { orders: unknown[] }).orders.length).toBeGreaterThan(0)
    expect(api.handle({ method: 'OPTIONS', url: '/v1/orders' }).status).toBe(204)
    expect(api.routes.map((x) => `${x.method} ${x.path}`)).toContain('GET /v1/orders/{id}')
  })

  it('gives the same data for the same URL, with path params filled in', () => {
    const a = createMockApi(shop()).handle({ method: 'GET', url: '/v1/orders/3' })
    const b = createMockApi(shop()).handle({ method: 'GET', url: '/v1/orders/3' })
    expect(a.body).toEqual(b.body)
    expect(a.body).toMatchObject({ id: 3 })
  })

  it('matches static segments before params', () => {
    const r = createMockApi(shop()).handle({ method: 'GET', url: '/v1/orders/latest' })
    expect(r.delay).toBe(800)
    expect(typeof (r.body as { id: unknown }).id).toBe('number')
  })

  it('answers unknown routes, wrong methods and missing bodies in plain words', () => {
    const api = createMockApi(shop())
    expect(api.handle({ method: 'GET', url: '/v1/nope' })).toMatchObject({ status: 404, body: { message: 'No endpoint for GET /v1/nope in the contract.' } })
    expect(api.handle({ method: 'PUT', url: '/v1/orders' })).toMatchObject({ status: 405, headers: { Allow: 'GET, POST' } })
    expect(api.handle({ method: 'POST', url: '/v1/orders' })).toMatchObject({ status: 400 })
  })

  it('forces statuses and delays per endpoint, by query or by header', () => {
    const api = createMockApi(shop(), { delay: 100 })
    expect(api.handle({ method: 'GET', url: '/v1/broken' })).toMatchObject({ status: 503, body: { message: 'Unavailable' } })
    const missing = api.handle({ method: 'GET', url: '/v1/orders/9?__status=404&__delay=2000' })
    expect(missing).toMatchObject({ status: 404, delay: 2000 })
    expect(typeof (missing.body as { message: unknown }).message).toBe('string')
    expect(api.handle({ method: 'GET', url: '/v1/orders/9', headers: { 'x-mock-status': '500' } }).status).toBe(500)
    expect(api.handle({ method: 'GET', url: '/v1/orders' }).delay).toBe(100)
  })

  it('remembers what was created, changed and deleted', () => {
    const api = createMockApi(shop())
    const created = api.handle({ method: 'POST', url: '/v1/orders', body: { ...order, status: 'pending' } })
    expect(created).toMatchObject({ status: 201, body: { id: 4242, total: 10 } })
    expect((api.handle({ method: 'GET', url: '/v1/orders' }).body as { orders: unknown[] }).orders[0]).toEqual(created.body)
    expect(api.handle({ method: 'PATCH', url: '/v1/orders/4242', body: { status: 'shipped' } }).body).toEqual(order)
    expect(api.handle({ method: 'GET', url: '/v1/orders/4242' }).body).toEqual(order)
    const gone = api.handle({ method: 'DELETE', url: '/v1/orders/4242' })
    expect(gone.status).toBe(204)
    expect(gone).not.toHaveProperty('body')
    expect(api.handle({ method: 'GET', url: '/v1/orders/4242' }).body).not.toEqual(order)
    expect(createMockApi(shop(), { crud: false }).handle({ method: 'POST', url: '/v1/orders', body: { total: 1 } }).body).not.toMatchObject({ total: 1 })
  })

  it('reads contract files and OpenAPI documents', () => {
    expect(readContractFile(JSON.parse(JSON.stringify(shop()))).contract.endpoints).toHaveLength(7)
    expect(readContractFile(toOpenApi(shop())).contract.endpoints).toHaveLength(7)
    expect(() => readContractFile({ hello: 1 })).toThrow('This isn’t a contract file.')
  })
})
