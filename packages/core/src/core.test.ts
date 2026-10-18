import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { fetchFunctionName, inferSchema, itemName, parseJson, pascalCase, toFetch, toJsonSchema, toMock, toTypeScript, toZod, typesTopDown } from './index'

const orders = {
  page: 1,
  total: 42,
  orders: [
    {
      id: 101,
      status: 'shipped',
      createdAt: '2026-03-01T10:15:00Z',
      customer: { id: 'c_1', name: 'Diya Shah', email: 'diya@example.com' },
      items: [{ sku: 'LMP-1001', qty: 2, price: 499.5 }],
      coupon: null,
    },
    {
      id: 102,
      status: 'pending',
      createdAt: '2026-03-02T08:00:00+05:30',
      customer: { id: 'c_2', name: 'Rohan Mehta', email: 'rohan@example.com', phone: '+91 98765 43210' },
      items: [],
      coupon: 'DIWALI10',
    },
  ],
}

/** Run generated Zod code against the real library and return the root schema. */
function evalZod(code: string, exportName: string): z.ZodType {
  const js = code
    .replace(/^import .*$/m, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^export const /gm, 'const ')
  return new Function('z', `${js}\nreturn ${exportName}`)(z) as z.ZodType
}

describe('names', () => {
  it('makes type names from keys', () => {
    expect(pascalCase('created_at')).toBe('CreatedAt')
    expect(pascalCase('order-lines')).toBe('OrderLines')
    expect(pascalCase('2fa')).toBe('T2fa')
    expect(itemName('categories')).toBe('Category')
    expect(itemName('orderLines')).toBe('OrderLine')
    expect(itemName('addresses')).toBe('Address')
    expect(itemName('children')).toBe('Child')
    expect(itemName('data')).toBe('DataItem')
    expect(itemName('status')).toBe('StatusItem')
  })
})

describe('inferSchema', () => {
  const schema = inferSchema([orders], 'OrdersResponse')

  it('names nested objects after their keys', () => {
    expect(typesTopDown(schema).map((t) => t.name)).toEqual(['OrdersResponse', 'Order', 'Customer', 'OrderItem'])
  })

  it('marks keys missing from some items optional, and null-or-value keys nullable', () => {
    const customer = schema.types.find((t) => t.name === 'Customer')!
    expect(customer.fields.find((f) => f.key === 'phone')?.optional).toBe(true)
    expect(customer.fields.find((f) => f.key === 'email')?.optional).toBe(false)
    const order = schema.types.find((t) => t.name === 'Order')!
    expect(order.fields.find((f) => f.key === 'coupon')?.shape).toMatchObject({
      kind: 'union',
      options: [{ kind: 'string' }, { kind: 'null' }],
    })
  })

  it('detects string formats and integer vs decimal numbers', () => {
    const order = schema.types.find((t) => t.name === 'Order')!
    expect(order.fields.find((f) => f.key === 'createdAt')?.shape).toMatchObject({ kind: 'string', format: 'date-time' })
    const item = schema.types.find((t) => t.name === 'OrderItem')!
    expect(item.fields.find((f) => f.key === 'qty')?.shape).toMatchObject({ kind: 'number', integer: true })
    expect(item.fields.find((f) => f.key === 'price')?.shape).toMatchObject({ kind: 'number', integer: false })
  })

  it('names the items of an array root after the root', () => {
    const list = inferSchema([[{ id: 1 }, { id: 2, tag: 'x' }]], 'User')
    expect(list.root).toEqual({ kind: 'array', items: { kind: 'ref', name: 'User' } })
    expect(toTypeScript(list)).toContain('export type UserList = User[]')
  })

  it('reuses one type for identical structures and splits different ones', () => {
    const s = inferSchema([{ billing: { city: 'Rajkot' }, shipping: { city: 'Pune' }, a: { x: { v: 1 } }, b: { x: { w: 'q' } } }])
    expect(s.types.map((t) => t.name).sort()).toEqual(['A', 'B', 'Billing', 'Root', 'Shipping', 'X', 'X2'])
  })

  it('prefixes vague names with their parent, except at the root', () => {
    const s = inferSchema([{ data: [{ id: 1, meta: { tag: 'a' }, children: [{ id: 2 }] }] }], 'UsersResponse')
    expect(s.types.map((t) => t.name)).toEqual(['DataItemMeta', 'DataItemChild', 'DataItem', 'UsersResponse'])
  })

  it('handles empty arrays and mixed arrays', () => {
    const s = inferSchema([{ tags: [], mixed: [1, 'a', null] }])
    expect(toTypeScript(s)).toContain('tags: unknown[]')
    expect(toTypeScript(s)).toContain('mixed: (string | number | null)[]')
  })
})

describe('generators', () => {
  const schema = inferSchema([orders], 'OrdersResponse')

  it('writes TypeScript interfaces, root first', () => {
    const ts = toTypeScript(schema)
    expect(ts.indexOf('interface OrdersResponse')).toBeLessThan(ts.indexOf('interface Order {'))
    expect(ts).toContain('  orders: Order[]')
    expect(ts).toContain('  phone?: string')
    expect(ts).toContain('  coupon: string | null')
    expect(ts).toContain('  createdAt: string // date-time')
    expect(toTypeScript(inferSchema([{ 'first-name': 'a' }]))).toContain('"first-name": string')
  })

  it('writes Zod that accepts the sample it came from and rejects a broken one', () => {
    const root = evalZod(toZod(schema), 'ordersResponseSchema')
    expect(root.safeParse(orders).success).toBe(true)
    const broken = structuredClone(orders) as { orders: { customer: { email: string } }[] }
    broken.orders[0].customer.email = 'not-an-email'
    expect(root.safeParse(broken).success).toBe(false)
  })

  it('writes Zod for array roots', () => {
    const list = inferSchema([[{ id: 'a3bb189e-8bf9-3888-9912-ace4e6543002', at: '2026-01-01' }]], 'Event')
    const root = evalZod(toZod(list), 'eventListSchema')
    expect(root.safeParse([{ id: 'a3bb189e-8bf9-3888-9912-ace4e6543002', at: '2026-01-01' }]).success).toBe(true)
  })

  it('makes mock data that passes its own Zod schema, the same for the same seed', () => {
    const root = evalZod(toZod(schema), 'ordersResponseSchema')
    for (const seed of [1, 2, 3, 4, 5]) {
      const data = toMock(schema, { seed })
      const result = root.safeParse(data)
      expect(result.error?.issues ?? []).toEqual([])
    }
    expect(toMock(schema, { seed: 7 })).toEqual(toMock(schema, { seed: 7 }))
  })

  it('makes mock data reuse real enum-like values from the sample', () => {
    const data = toMock(schema, { seed: 3 }) as { orders: { status: string }[] }
    for (const o of data.orders) expect(['shipped', 'pending']).toContain(o.status)
  })

  it('writes JSON Schema with $defs and required keys', () => {
    const js = toJsonSchema(schema) as { $ref: string; $defs: Record<string, { required?: string[] }> }
    expect(js.$ref).toBe('#/$defs/OrdersResponse')
    expect(js.$defs.Customer.required).toEqual(['id', 'name', 'email'])
  })

  it('names fetch functions from the method and path', () => {
    expect(fetchFunctionName('GET', 'https://api.shop.in/v1/orders')).toBe('getOrders')
    expect(fetchFunctionName('GET', '/api/orders/:orderId')).toBe('getOrder')
    expect(fetchFunctionName('POST', '/api/orders')).toBe('createOrder')
    expect(fetchFunctionName('DELETE', '/categories/{id}')).toBe('deleteCategory')
  })

  it('writes a typed fetch function with path parameters', () => {
    const code = toFetch(schema, { method: 'GET', url: 'http://localhost:3000/api/stores/:storeId/orders' })
    expect(code).toContain('export async function getOrders(storeId: string | number, init?: RequestInit): Promise<OrdersResponse>')
    expect(code).toContain('`http://localhost:3000/api/stores/${encodeURIComponent(String(storeId))}/orders`')
    expect(code).toContain('ordersResponseSchema.parse(await res.json())')
    expect(toFetch(schema, { validate: false })).toContain("import type { OrdersResponse } from './types'")
  })
})

describe('parseJson', () => {
  it('reports where the JSON breaks', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": \n}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect([r.line, r.column, r.message]).toEqual([4, 1, "Unexpected '}'"])
  })

  it('explains the usual copy-paste mistakes', () => {
    const msg = (s: string) => {
      const r = parseJson(s)
      return r.ok ? '' : r.message
    }
    expect(msg('{"a": 1,}')).toBe("Trailing comma before '}'")
    expect(msg('[1, 2,]')).toBe("Trailing comma before ']'")
    expect(msg("{'a': 1}")).toBe('Use double quotes for property names')
    expect(msg('{a: 1}')).toContain('Expected a property name')
    expect(msg('{"a": 1 "b": 2}')).toBe('Missing comma between properties')
    expect(msg('{"a": undefined}')).toBe('undefined is not valid JSON')
    expect(msg('{"a": 1')).toContain("Expected ',' or '}'")
  })
})
