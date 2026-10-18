import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import * as zod from 'zod'

import {
  addSchemaEndpoint,
  contractProblems,
  defaultSummary,
  emptyContract,
  fromOpenApi,
  functionNames,
  inferSchema,
  newEndpoint,
  openApiPath,
  pathParamNames,
  renameContractType,
  resourceGroups,
  resourceOf,
  sameShape,
  shapeFromParts,
  shapeLabel,
  shapeParts,
  syncPathParams,
  toContractClient,
  toContractTypes,
  toContractZod,
  toOpenApi,
  toYaml,
  typeUsage,
  usableContract,
} from './index'
import type { Contract, ContractEndpoint, Shape } from './index'
import { typecheck } from './typecheck.testutil'

const ref = (name: string): Shape => ({ kind: 'ref', name })
const str: Shape = { kind: 'string' }
const int: Shape = { kind: 'number', integer: true }
const list = (items: Shape): Shape => ({ kind: 'array', items })
const nullable = (s: Shape): Shape => ({ kind: 'union', options: [s, { kind: 'null' }] })

let n = 0
const nextId = () => `e${++n}`

/** A small shop API: list, create, get, update and delete orders, and a tree of categories. */
const shop = (): Contract => ({
  version: 1,
  title: 'Wholesale shop',
  apiVersion: '2.1.0',
  baseUrl: 'https://api.example.com/v1/',
  description: 'Orders for the wholesale shop.',
  types: [
    {
      name: 'Order',
      fields: [
        { key: 'id', shape: { kind: 'string', format: 'uuid' }, optional: false },
        { key: 'status', shape: { kind: 'enum', values: ['pending', 'shipped'] }, optional: false },
        { key: 'placedAt', shape: { kind: 'string', format: 'date-time' }, optional: false },
        { key: 'buyer', shape: ref('Buyer'), optional: false },
        { key: 'items', shape: list(ref('OrderItem')), optional: false },
        { key: 'notes', shape: nullable(str), optional: true },
      ],
    },
    {
      name: 'Buyer',
      fields: [
        { key: 'id', shape: int, optional: false },
        { key: 'email', shape: { kind: 'string', format: 'email' }, optional: false },
      ],
    },
    {
      name: 'OrderItem',
      fields: [
        { key: 'sku', shape: str, optional: false },
        { key: 'quantity', shape: int, optional: false },
        { key: 'unit-price', shape: { kind: 'number', integer: false }, optional: false },
      ],
    },
    {
      name: 'OrderList',
      fields: [
        { key: 'orders', shape: list(ref('Order')), optional: false },
        { key: 'total', shape: int, optional: false },
      ],
    },
    {
      name: 'NewOrder',
      fields: [
        { key: 'buyerId', shape: int, optional: false },
        { key: 'items', shape: list(ref('OrderItem')), optional: false },
        { key: 'notes', shape: str, optional: true },
      ],
    },
    {
      name: 'Problem',
      fields: [
        { key: 'code', shape: str, optional: false },
        { key: 'message', shape: str, optional: false },
      ],
    },
    {
      name: 'Category',
      fields: [
        { key: 'name', shape: str, optional: false },
        { key: 'children', shape: list(ref('Category')), optional: false },
      ],
    },
  ],
  endpoints: [
    {
      id: 'list',
      method: 'GET',
      path: '/orders',
      summary: 'List orders',
      resource: 'Orders',
      params: [
        { name: 'status', in: 'query', shape: { kind: 'enum', values: ['pending', 'shipped'] }, required: false, description: 'Only orders in this status' },
        { name: 'page', in: 'query', shape: int, required: false },
        { name: 'tag', in: 'query', shape: list(str), required: false },
      ],
      responses: [
        { status: 200, description: 'A page of orders', body: ref('OrderList') },
        { status: 'default', description: 'Something went wrong', body: ref('Problem') },
      ],
    },
    {
      id: 'create',
      method: 'POST',
      path: '/orders',
      summary: 'Place an order',
      description: 'Checks stock first.\nFails with 422 when an item is out of stock.',
      resource: 'Orders',
      params: [],
      body: { shape: ref('NewOrder'), required: true },
      responses: [
        { status: 422, description: 'Out of stock', body: ref('Problem') },
        { status: 201, description: 'The new order', body: ref('Order') },
      ],
    },
    {
      id: 'get',
      method: 'GET',
      path: '/orders/:orderId',
      summary: 'Get an order',
      resource: 'Orders',
      params: [{ name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true }],
      responses: [
        { status: 200, description: 'The order', body: ref('Order') },
        { status: 404, description: 'No such order', body: ref('Problem') },
      ],
    },
    {
      id: 'update',
      method: 'PATCH',
      path: '/orders/{orderId}',
      summary: 'Change an order',
      resource: 'Orders',
      operationId: 'changeOrder',
      params: [
        { name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true },
        { name: 'notify', in: 'query', shape: { kind: 'boolean' }, required: true },
      ],
      body: { shape: ref('NewOrder'), required: false },
      responses: [{ status: 200, description: 'The changed order', body: ref('Order') }],
    },
    {
      id: 'delete',
      method: 'DELETE',
      path: '/orders/{orderId}',
      summary: 'Cancel an order',
      resource: 'Orders',
      params: [{ name: 'orderId', in: 'path', shape: { kind: 'string', format: 'uuid' }, required: true }],
      responses: [{ status: 204, description: 'Cancelled' }],
    },
    {
      id: 'tree',
      method: 'GET',
      path: '/categories',
      summary: 'The category tree',
      resource: 'Catalogue',
      params: [],
      responses: [{ status: 200, description: 'Every top-level category', body: list(ref('Category')) }],
    },
  ],
})

/** Type-check the three generated files together under strict settings. */
function compiles(contract: Contract, validate = true): string[] {
  return typecheck(
    {
      'types.ts': toContractTypes(contract),
      'schema.ts': toContractZod(contract),
      'client.ts': toContractClient(contract, { validate }),
    },
    { noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, exactOptionalPropertyTypes: true },
  )
}

interface Call {
  url: string
  method: string
  headers: Headers
  body?: string | null
}

/** Run the generated client against a stubbed fetch, with the real Zod. */
function loadClient(contract: Contract, reply: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const call: Call = { url, method: String(init.method), headers: new Headers(init.headers), body: init.body as string | undefined }
    calls.push(call)
    const r = reply(call)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.status === 404 ? 'Not Found' : 'OK',
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    }
  }
  const run = (code: string, deps: Record<string, unknown>) => {
    const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} as Record<string, unknown> }
    new Function('require', 'module', 'exports', 'fetch', js)((name: string) => deps[name], module, module.exports, fetch)
    return module.exports
  }
  const schema = run(toContractZod(contract), { zod })
  const client = run(toContractClient(contract), { zod, './schema': schema }) as Record<string, (...args: unknown[]) => Promise<unknown>> & {
    ApiError: new (...a: unknown[]) => Error
  }
  return { client, calls }
}

const order = {
  id: '3b241101-e2bb-4255-8caf-4136c566a962',
  status: 'pending',
  placedAt: '2026-10-12T09:41:00Z',
  buyer: { id: 7, email: 'diya@example.in' },
  items: [{ sku: 'LMP-1', quantity: 2, 'unit-price': 899.5 }],
}

describe('paths', () => {
  it('reads params in both styles and writes them the OpenAPI way', () => {
    expect(pathParamNames('/orders/{orderId}/items/:sku')).toEqual(['orderId', 'sku'])
    expect(openApiPath('/orders/:orderId/items/{sku}')).toBe('/orders/{orderId}/items/{sku}')
  })

  it('names resources and summaries from the path', () => {
    expect(resourceOf('/v1/order-lines/{id}')).toBe('Order lines')
    expect(resourceOf('/')).toBe('General')
    expect(defaultSummary('GET', '/orders')).toBe('List orders')
    expect(defaultSummary('GET', '/orders/{id}')).toBe('Get order')
    expect(defaultSummary('POST', '/orders')).toBe('Create order')
    expect(defaultSummary('DELETE', '/categories/:id')).toBe('Delete category')
  })

  it('keeps a path param per name in the path, with the type it had', () => {
    const e: ContractEndpoint = {
      ...newEndpoint('x', 'GET', '/orders/{orderId}'),
      params: [
        { name: 'q', in: 'query', shape: str, required: false },
        { name: 'orderId', in: 'path', shape: int, required: true },
        { name: 'gone', in: 'path', shape: str, required: true },
      ],
    }
    const synced = syncPathParams({ ...e, path: '/orders/{orderId}/items/{sku}' })
    expect(synced.params.map((p) => [p.name, p.in, p.shape.kind])).toEqual([
      ['orderId', 'path', 'number'],
      ['sku', 'path', 'string'],
      ['q', 'query', 'string'],
    ])
  })

  it('starts new endpoints with the status their method usually answers with', () => {
    expect(newEndpoint('a', 'POST', '/orders').responses[0].status).toBe(201)
    expect(newEndpoint('b', 'DELETE', '/orders/{id}').responses[0].status).toBe(204)
    expect(newEndpoint('c', 'GET', '/orders/{id}').params).toEqual([{ name: 'id', in: 'path', shape: str, required: true }])
  })
})

describe('names and groups', () => {
  it('derives function names, numbers clashes and keeps names set by hand', () => {
    const c = shop()
    const names = functionNames(c)
    expect([...names.values()]).toEqual(['getOrders', 'createOrder', 'getOrder', 'changeOrder', 'deleteOrder', 'getCategories'])
    const twice = { ...c, endpoints: [...c.endpoints, { ...c.endpoints[0], id: 'again', path: '/orders/' }] }
    expect(functionNames(twice).get('again')).toBe('getOrders2')
  })

  it('groups endpoints by resource in the order they first appear', () => {
    expect(resourceGroups(shop()).map((g) => [g.name, g.endpoints.length])).toEqual([
      ['Orders', 5],
      ['Catalogue', 1],
    ])
  })

  it('renames a type everywhere it is used', () => {
    const c = renameContractType(shop(), 'Problem', 'ApiProblem')
    expect(c.types.some((t) => t.name === 'Problem')).toBe(false)
    expect(c.endpoints[0].responses[1].body).toEqual(ref('ApiProblem'))
    expect(typeUsage(c, 'OrderItem')).toEqual(['Order', 'NewOrder'])
    expect(typeUsage(c, 'ApiProblem')).toEqual(['GET /orders', 'POST /orders', 'GET /orders/:orderId'])
  })
})

describe('shape parts', () => {
  it('splits a shape into base, list and nullable, and puts it back', () => {
    const shape = nullable(list(ref('Order')))
    const parts = shapeParts(shape)
    expect(parts).toEqual({ base: { ref: 'Order' }, list: true, nullable: true, values: [] })
    expect(shapeFromParts(parts!)).toEqual(shape)
    expect(shapeLabel(shape)).toBe('Order[] | null')
    expect(shapeParts({ kind: 'union', options: [str, int] })).toBeNull()
  })

  it('keeps sample values when only the list or null part changes', () => {
    const before: Shape = { kind: 'string', format: 'email', examples: ['a@b.in'] }
    expect(shapeFromParts({ base: 'email', list: true, nullable: false, values: [] }, before)).toEqual(list(before))
    expect(shapeFromParts({ base: 'uuid', list: false, nullable: false, values: [] }, before)).toEqual({ kind: 'string', format: 'uuid' })
  })
})

describe('problems', () => {
  it('has none for a good contract', () => {
    expect(contractProblems(shop())).toEqual([])
  })

  it('says what is wrong, leaves those endpoints out, and the code still compiles', () => {
    const c = shop()
    c.types.push({ name: 'Order', fields: [] }, { name: '2fa', fields: [] })
    c.endpoints.push(
      { ...newEndpoint('dup', 'GET', '/orders/{id}'), responses: [{ status: 200, description: '' }] },
      { ...newEndpoint('bad', 'GET', 'orders?x=1'), body: { shape: str, required: true } },
      {
        ...newEndpoint('params', 'POST', '/things'),
        params: [{ name: 'filter', in: 'query', shape: ref('Order'), required: false }],
        responses: [
          { status: 200, description: '' },
          { status: 200, description: '' },
          { status: 99, description: '' },
        ],
      },
      { ...newEndpoint('gone', 'GET', '/gone'), responses: [{ status: 200, description: '', body: ref('Missing') }] },
    )
    const messages = contractProblems(c).map((p) => p.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'Two types are called Order. Rename one.',
        'Type names are letters, digits and underscores, starting with a letter, like Order.',
        'GET /orders/{orderId} is already an endpoint.',
        'Start the path with a slash, like /orders.',
        'Put query params in the list below, not in the path.',
        'GET requests don’t send a body. Remove it, or use POST, PUT or PATCH.',
        'Query param filter must be a string, number, boolean or enum, or a list of them.',
        'Two responses are for 200.',
        'Status codes go from 100 to 599.',
        'Points at Missing, which isn’t a type any more. Pick another type.',
      ]),
    )
    const { contract: usable, leftOut } = usableContract(c)
    expect(leftOut).toEqual({ endpoints: 3, types: 2 })
    // a missing type only makes that body unknown
    expect(usable.endpoints.find((e) => e.id === 'gone')?.responses[0].body).toEqual({ kind: 'unknown' })
    expect(compiles(c)).toEqual([])
  })
})

describe('from the API explorer', () => {
  const schema = inferSchema([{ orders: [{ id: 1, buyer: { name: 'Diya' } }], page: 1 }], 'OrdersResponse')

  it('adds an endpoint for the sample, splitting off the base URL and query', () => {
    const { contract, endpointId } = addSchemaEndpoint(emptyContract(), schema, { id: 'x', method: 'GET', url: 'https://api.example.in/v1/orders?page=2&status=open' })
    expect(contract.baseUrl).toBe('https://api.example.in/v1')
    const e = contract.endpoints.find((x) => x.id === endpointId)!
    expect(e.path).toBe('/orders')
    expect(e.params.map((p) => p.name)).toEqual(['page', 'status'])
    expect(e.responses).toEqual([{ status: 200, description: 'OK', body: ref('OrdersResponse') }])
    expect(contract.types.map((t) => t.name)).toEqual(['Buyer', 'Order', 'OrdersResponse'])
  })

  it('reuses types that match and renames ones that don’t', () => {
    const first = addSchemaEndpoint(emptyContract(), schema, { id: 'a', method: 'GET', url: 'https://api.example.in/v1/orders' }).contract
    const again = addSchemaEndpoint(first, schema, { id: 'b', method: 'GET', url: 'https://api.example.in/v1/orders/{id}' })
    expect(again.reused).toEqual(['Buyer', 'Order', 'OrdersResponse'])
    expect(again.contract.endpoints[1].path).toBe('/orders/{id}')
    const other = inferSchema([{ id: 'x', buyer: { name: 'Diya', vip: true } }], 'Order')
    const added = addSchemaEndpoint(first, other, { id: 'c', method: 'POST', url: '/orders' })
    expect(added.renamed).toEqual([
      ['Buyer', 'Buyer2'],
      ['Order', 'Order2'],
    ])
    expect(added.contract.types.find((t) => t.name === 'Order2')?.fields[1].shape).toEqual(ref('Buyer2'))
    expect(added.contract.endpoints[1].responses[0]).toMatchObject({ status: 201, body: ref('Order2') })
  })
})

describe('generated code', () => {
  it('compiles under strict settings, validated or not', () => {
    expect(compiles(shop(), true)).toEqual([])
    expect(compiles(shop(), false)).toEqual([])
  })

  it('compiles with no types or no endpoints', () => {
    expect(compiles(emptyContract())).toEqual([])
    expect(compiles({ ...shop(), endpoints: [] })).toEqual([])
    expect(compiles({ ...emptyContract(), endpoints: [newEndpoint('a', 'GET', '/health')] })).toEqual([])
  })

  it('types the request body and the arguments', () => {
    const code = toContractClient(shop())
    expect(code).toContain('export async function createOrder(body: NewOrder, init?: RequestInit): Promise<Order>')
    expect(code).toContain(
      'export async function changeOrder(orderId: string, body: NewOrder | undefined, query: { notify: boolean }, init?: RequestInit): Promise<Order>',
    )
    expect(code).toContain('export async function getOrders(query: { status?: "pending" | "shipped"; page?: number; tag?: string[] } = {}, init?: RequestInit): Promise<OrderList>')
    expect(code).toContain('export async function deleteOrder(orderId: string, init?: RequestInit): Promise<void>')
    expect(code).toContain(' * Throws ApiError on 422 Out of stock (body: Problem)')
  })

  it('writes recursive types as Zod getters', () => {
    const code = toContractZod(shop())
    expect(code).toContain('get children() {\n    return z.array(categorySchema)\n  },')
  })

  it('calls the API with the right URL, method and body, and checks what comes back', async () => {
    const { client, calls } = loadClient(shop(), (call) => {
      if (call.url.endsWith('/categories')) return { status: 200, body: [{ name: 'Lamps', children: [{ name: 'Brass', children: [] }] }] }
      if (call.method === 'DELETE') return { status: 204 }
      if (call.url.includes('missing')) return { status: 404, body: { code: 'not_found', message: 'No such order' } }
      if (call.url.includes('broken')) return { status: 200, body: { ...order, status: 'lost' } }
      return { status: call.method === 'POST' ? 201 : 200, body: call.url.includes('/orders?') ? { orders: [order], total: 1 } : order }
    })
    expect(await client.getOrders({ status: 'pending', tag: ['a', 'b'] })).toEqual({ orders: [order], total: 1 })
    expect(calls[0].url).toBe('https://api.example.com/v1/orders?status=pending&tag=a&tag=b')

    await client.createOrder({ buyerId: 7, items: [] })
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://api.example.com/v1/orders', body: '{"buyerId":7,"items":[]}' })
    expect(calls[1].headers.get('Content-Type')).toBe('application/json')

    await client.getOrder('a b/c')
    expect(calls[2].url).toBe('https://api.example.com/v1/orders/a%20b%2Fc')

    await client.changeOrder('o1', undefined, { notify: false })
    expect(calls[3]).toMatchObject({ method: 'PATCH', url: 'https://api.example.com/v1/orders/o1?notify=false', body: null })

    expect(await client.deleteOrder('o1')).toBeUndefined()
    expect(await client.getCategories()).toHaveLength(1)

    const error = await client.getOrder('missing').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(client.ApiError)
    expect(error).toMatchObject({ status: 404, body: { code: 'not_found', message: 'No such order' } })
    await expect(client.getOrder('broken')).rejects.toThrow(/Invalid option/)
  })

  it('picks another name for the error class and functions that clash with types', () => {
    const c = shop()
    c.types.push({ name: 'ApiError', fields: [{ key: 'code', shape: str, optional: false }] }, { name: 'GetCategories', fields: [] })
    c.endpoints.push({ ...newEndpoint('x', 'GET', '/errors'), operationId: 'GetCategories', responses: [{ status: 200, description: '', body: ref('ApiError') }] })
    const code = toContractClient(c)
    expect(code).toContain('export class ApiResponseError extends Error')
    expect(code).toContain('export async function GetCategoriesRequest(')
    expect(compiles(c)).toEqual([])
  })
})

describe('OpenAPI export', () => {
  const doc = toOpenApi(shop()) as {
    openapi: string
    info: unknown
    servers: unknown
    tags: unknown
    paths: Record<string, Record<string, Record<string, unknown>>>
    components: { schemas: Record<string, unknown> }
  }

  it('writes info, servers, tags and one path per URL', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'Wholesale shop', version: '2.1.0', description: 'Orders for the wholesale shop.' })
    expect(doc.servers).toEqual([{ url: 'https://api.example.com/v1/' }])
    expect(doc.tags).toEqual([{ name: 'Orders' }, { name: 'Catalogue' }])
    expect(Object.keys(doc.paths)).toEqual(['/orders', '/orders/{orderId}', '/categories'])
    expect(Object.keys(doc.paths['/orders/{orderId}'])).toEqual(['get', 'patch', 'delete'])
  })

  it('writes params, bodies and responses with refs to components', () => {
    const create = doc.paths['/orders'].post
    expect(create.requestBody).toEqual({ required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } })
    expect(Object.keys(create.responses as object)).toEqual(['201', '422'])
    expect((doc.paths['/orders'].get.parameters as unknown[])[0]).toEqual({
      name: 'status',
      in: 'query',
      description: 'Only orders in this status',
      required: false,
      schema: { type: 'string', enum: ['pending', 'shipped'] },
    })
    expect(doc.paths['/orders/{orderId}'].delete.responses).toEqual({ '204': { description: 'Cancelled' } })
    expect(doc.components.schemas.Order).toMatchObject({ required: ['id', 'status', 'placedAt', 'buyer', 'items'] })
  })

  it('writes YAML that reads back as the same document', () => {
    expect(parseYaml(toYaml(doc))).toEqual(doc)
    const tricky = { a: 'yes', b: '012', c: 'x: y', d: '#tag', e: '', f: [], g: {}, h: [{ i: 1, j: [true, null] }], 'k l': '- m', n: 'trailing ', o: 'a\nb' }
    expect(parseYaml(toYaml(tricky))).toEqual(tricky)
  })

  it('reads back into the same contract', () => {
    const original = shop()
    const { contract, warnings } = fromOpenApi(JSON.parse(JSON.stringify(doc)), nextId)
    expect(warnings).toEqual([])
    expect(contract).toMatchObject({ title: original.title, apiVersion: original.apiVersion, baseUrl: original.baseUrl, description: original.description })
    expect(contract.types.map((t) => t.name)).toEqual(original.types.map((t) => t.name))
    for (const [i, t] of contract.types.entries())
      for (const [j, f] of t.fields.entries()) {
        const want = original.types[i].fields[j]
        expect([f.key, f.optional, sameShape(f.shape, want.shape)]).toEqual([want.key, want.optional, true])
      }
    const strip = (e: ContractEndpoint) => ({ ...e, id: '', path: openApiPath(e.path), responses: [...e.responses].sort((a, b) => String(a.status).localeCompare(String(b.status))) })
    expect(contract.endpoints.map(strip)).toEqual(original.endpoints.map(strip))
  })
})

describe('OpenAPI import', () => {
  const spec = `
openapi: 3.0.3
info:
  title: Pet store
  version: '1'
servers:
  - url: https://{region}.pets.example/api
    variables:
      region:
        default: eu
paths:
  /pets:
    parameters:
      - $ref: '#/components/parameters/Limit'
    get:
      operationId: list-pets
      tags: [Pets]
      parameters:
        - name: X-Request-Id
          in: header
          schema: { type: string }
        - name: filter
          in: query
          schema:
            type: object
            properties:
              colour: { type: string }
      responses:
        '200':
          description: The pets
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Pet' }
        4XX:
          $ref: '#/components/responses/Problem'
    post:
      summary: Add a pet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string }
                owner:
                  type: object
                  properties:
                    email: { type: string, format: email }
                tags:
                  type: array
                  items:
                    type: object
                    properties:
                      label: { type: string }
      responses:
        '201':
          description: Added
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Pet' }
    head:
      responses:
        '200': { description: ok }
  /pets/{petId}/photo:
    put:
      parameters:
        - name: petId
          in: path
          required: true
          schema: { type: integer }
      requestBody:
        content:
          multipart/form-data:
            schema: { type: object }
      responses:
        '204': { description: Saved }
components:
  parameters:
    Limit:
      name: limit
      in: query
      schema: { type: integer, minimum: 1, maximum: 100 }
  responses:
    Problem:
      description: A problem
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
  schemas:
    Pet:
      allOf:
        - $ref: '#/components/schemas/Named'
        - type: object
          required: [id, kind]
          properties:
            id: { type: integer }
            kind: { $ref: '#/components/schemas/Kind' }
            nickname: { type: string, nullable: true }
            size: { enum: [1, 2, 3] }
            meta:
              type: object
              additionalProperties: { type: string }
            friend:
              oneOf:
                - $ref: '#/components/schemas/Pet'
                - $ref: '#/components/schemas/Named'
    Named:
      type: object
      required: [name]
      properties:
        name: { type: string }
    Kind:
      type: string
      enum: [cat, dog]
    Problem:
      type: object
      properties:
        title: { type: string }
        status: { type: [integer, 'null'] }
`
  const { contract, warnings } = fromOpenApi(parseYaml(spec), nextId)

  it('reads info, the server with its variables filled in, and the endpoints', () => {
    expect(contract).toMatchObject({ title: 'Pet store', apiVersion: '1', baseUrl: 'https://eu.pets.example/api' })
    expect(contract.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['GET /pets', 'POST /pets', 'PUT /pets/{petId}/photo'])
    const pets = contract.endpoints[0]
    expect(pets).toMatchObject({ operationId: 'listPets', resource: 'Pets', summary: 'List pets' })
    expect(pets.params).toEqual([
      { name: 'limit', in: 'query', shape: { kind: 'number', integer: true, min: 1, max: 100 }, required: false },
      { name: 'filter', in: 'query', shape: str, required: false },
    ])
    expect(pets.responses).toEqual([
      { status: 200, description: 'The pets', body: list(ref('Pet')) },
      { status: 400, description: 'A problem', body: ref('Problem') },
    ])
    expect(contract.endpoints[2].params).toEqual([{ name: 'petId', in: 'path', shape: int, required: true }])
    expect(contract.endpoints[2].body).toBeUndefined()
  })

  it('makes object components into types and inlines the rest', () => {
    expect(contract.types.map((t) => t.name)).toEqual(['Pet', 'Named', 'Problem', 'CreatePetBody', 'Owner', 'Tag'])
    const pet = contract.types[0]
    expect(pet.fields.map((f) => [f.key, shapeLabel(f.shape), f.optional])).toEqual([
      ['name', 'string', false],
      ['id', 'integer', false],
      ['kind', 'enum', false],
      ['nickname', 'string | null', true],
      ['size', 'integer', true],
      ['meta', 'unknown', true],
      ['friend', 'Pet', true],
    ])
    expect(pet.fields[2].shape).toEqual({ kind: 'enum', values: ['cat', 'dog'] })
    expect(contract.types[2].fields[1].shape).toEqual(nullable(int))
    expect(contract.endpoints[1].body).toEqual({ shape: ref('CreatePetBody'), required: true })
    expect(contract.types.find((t) => t.name === 'CreatePetBody')?.fields.map((f) => shapeLabel(f.shape))).toEqual(['string', 'Owner', 'Tag[]'])
  })

  it('lists what it simplified or left out', () => {
    expect(warnings).toEqual([
      'Pet.size can only be 1, 2, 3; the shared schema keeps it as a number.',
      'Pet.meta is a map of keys to values, which a shared-schema type can’t hold yet, so it was read as any value.',
      'Pet.friend can be Pet or Named; it keeps Pet.',
      'Header params aren’t part of a contract yet, so X-Request-Id on GET /pets was left out.',
      'The filter param of GET /pets isn’t a plain value, so it was made a string.',
      'GET /pets has a response for any 4XX status; it was read as 400.',
      'HEAD /pets was left out: contracts have GET, POST, PUT, PATCH and DELETE endpoints.',
      'The request body of PUT /pets/{petId}/photo isn’t JSON (multipart/form-data), so it was left out.',
    ])
  })

  it('makes code that compiles', () => {
    expect(contractProblems(contract)).toEqual([])
    expect(compiles(contract)).toEqual([])
  })

  it('says what to do with files it can’t read', () => {
    expect(() => fromOpenApi({ swagger: '2.0' }, nextId)).toThrow('This is a Swagger 2.0 file. Convert it to OpenAPI 3 first')
    expect(() => fromOpenApi({ openapi: '4.0.0' }, nextId)).toThrow('OpenAPI 4.0.0 isn’t supported.')
    expect(() => fromOpenApi([], nextId)).toThrow('This isn’t an OpenAPI document')
  })
})
