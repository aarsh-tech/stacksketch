import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  applyOverrides,
  countEdits,
  editField,
  emptyOverrides,
  enumCandidate,
  fetchFunctionName,
  findDeclaration,
  inferredName,
  inferSchema,
  itemName,
  parseJson,
  pascalCase,
  renameProblem,
  renameType,
  toFetch,
  toJsonSchema,
  toMock,
  toTypeScript,
  toZod,
  typesTopDown,
  upgradeSchema,
} from './index'
import type { Schema } from './index'

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

describe('findDeclaration', () => {
  const schema = inferSchema([orders], 'OrdersResponse')

  it('finds a type in TypeScript, Zod and JSON Schema output', () => {
    const ts = toTypeScript(schema)
    const at = findDeclaration(ts, 'Customer', 'typescript')!
    const lines = ts.split('\n')
    expect(lines[at.from - 1]).toBe('export interface Customer {')
    expect(lines[at.to - 1]).toBe('}')

    const zod = toZod(schema)
    const z2 = findDeclaration(zod, 'Customer', 'zod')!
    expect(zod.split('\n')[z2.from - 1]).toBe('export const customerSchema = z.object({')
    expect(zod.split('\n')[z2.to - 1]).toBe('export type Customer = z.infer<typeof customerSchema>')

    const json = JSON.stringify(toJsonSchema(schema), null, 2)
    const j = findDeclaration(json, 'Customer', 'jsonschema')!
    expect(json.split('\n')[j.from - 1]).toBe('    "Customer": {')
    expect(json.split('\n')[j.to - 1]).toMatch(/^ {4}\},?$/)
  })

  it('does not confuse a type with one whose name starts the same', () => {
    const ts = toTypeScript(schema)
    expect(ts.split('\n')[findDeclaration(ts, 'Order', 'typescript')!.from - 1]).toBe('export interface Order {')
    expect(findDeclaration(ts, 'Nope', 'typescript')).toBeNull()
  })
})

describe('overrides', () => {
  const inferred = inferSchema([orders], 'OrdersResponse')
  const fieldOf = (s: Schema, type: string, key: string) => s.types.find((t) => t.name === type)!.fields.find((f) => f.key === key)!

  it('turns sample strings into an enum in every output', () => {
    expect(enumCandidate('status', fieldOf(inferred, 'Order', 'status').shape)).toEqual(['shipped', 'pending'])
    const s = applyOverrides(inferred, editField(emptyOverrides(), 'Order', 'status', { type: 'enum' }))
    expect(fieldOf(s, 'Order', 'status').shape).toEqual({ kind: 'enum', values: ['shipped', 'pending'] })
    expect(toTypeScript(s)).toContain('status: "shipped" | "pending"')
    expect(toZod(s)).toContain('status: z.enum(["shipped", "pending"])')
    const root = evalZod(toZod(s), 'ordersResponseSchema')
    expect(root.safeParse(orders).success).toBe(true)
    expect(root.safeParse({ ...orders, orders: [{ ...orders.orders[0], status: 'lost' }] }).success).toBe(false)
    for (const seed of [1, 2, 3]) expect(root.safeParse(toMock(s, { seed })).success).toBe(true)
    const js = toJsonSchema(s) as { $defs: Record<string, { properties: Record<string, unknown> }> }
    expect(js.$defs.Order.properties.status).toEqual({ type: 'string', enum: ['shipped', 'pending'] })
  })

  it('only offers enums for short code-like values or enum-ish keys', () => {
    expect(enumCandidate('name', fieldOf(inferred, 'Customer', 'name').shape)).toBeNull()
    expect(enumCandidate('email', fieldOf(inferred, 'Customer', 'email').shape)).toBeNull()
    expect(enumCandidate('sku', fieldOf(inferred, 'OrderItem', 'sku').shape)).toBeNull()
  })

  it('marks fields optional, required or nullable, and changes types and formats', () => {
    let o = editField(emptyOverrides(), 'Customer', 'phone', { optional: false, nullable: true })
    o = editField(o, 'Customer', 'email', { format: null })
    o = editField(o, 'Order', 'coupon', { nullable: false })
    o = editField(o, 'OrderItem', 'qty', { type: 'number' })
    const ts = toTypeScript(applyOverrides(inferred, o))
    expect(ts).toContain('  phone: string | null\n')
    expect(ts).toContain('  email: string\n')
    expect(ts).toContain('  coupon: string\n')
    expect(toZod(applyOverrides(inferred, o))).toContain('qty: z.number(),')
    expect(countEdits(o)).toBe(4)
    expect(countEdits(editField(o, 'Customer', 'email', null))).toBe(3)
  })

  it('renames a type and every reference to it, and keeps edits when the sample changes', () => {
    const o = renameType(editField(emptyOverrides(), 'Customer', 'phone', { optional: false }), 'Customer', 'Client')
    const s = applyOverrides(inferred, o)
    expect(s.types.map((t) => t.name)).toContain('Client')
    expect(toTypeScript(s)).toContain('  customer: Client\n')
    expect(inferredName(o, 'Client')).toBe('Customer')
    expect(renameProblem(s, o, 'Customer', 'order')).toBe('Order is already the name of another type.')
    // a new sample of the same API: the edits still apply
    const next = inferSchema([{ ...orders, orders: [orders.orders[1]] }], 'OrdersResponse')
    expect(toTypeScript(applyOverrides(next, o))).toContain('export interface Client {\n  id: string\n  name: string\n  email: string // email\n  phone: string\n}')
  })

  it('ignores renames that would clash', () => {
    const s = applyOverrides(inferred, renameType(emptyOverrides(), 'Customer', 'Order'))
    expect(s.types.filter((t) => t.name === 'Order')).toHaveLength(1)
    expect(s.types.map((t) => t.name)).toContain('Customer')
  })

  it('loads v1 schemas', () => {
    expect(upgradeSchema({ ...inferred, version: 1 }).version).toBe(2)
    expect(() => upgradeSchema({ ...inferred, version: 3 })).toThrow(/newer Stacksketch/)
  })
})
