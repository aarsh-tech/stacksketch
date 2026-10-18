/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import * as yup from 'yup'

import {
  applyOverrides,
  editField,
  emptyOverrides,
  findDeclaration,
  goName,
  inferSchema,
  snakeCase,
  toAxios,
  toFetch,
  toGo,
  toMock,
  toPydantic,
  toQueryHook,
  toTypeScript,
  toValibot,
  toYup,
  toZod,
} from './index'
import type { Schema } from './index'

const orders = {
  page: 1,
  orders: [
    {
      id: 'b3f1c2d4-7a8e-4f21-9c3d-2e5a6b7c8d90',
      status: 'shipped',
      placedAt: '2026-10-12T09:41:00+05:30',
      date: '2026-10-12',
      buyer: { id: 2201, email: 'diya@shahtraders.in', 'first-name': 'Diya', class: 'A' },
      items: [{ sku: 'LMP-1001', unitPrice: 899.5, imageUrl: 'https://cdn.example.in/p/1.jpg' }],
      coupon: null,
      tags: ['new'],
    },
    {
      id: '0c9a8b7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d',
      status: 'pending',
      placedAt: '2026-10-13T16:05:00Z',
      date: '2026-10-13',
      buyer: { id: 2207, email: 'rohan@mehtahome.in', 'first-name': 'Rohan', class: 'B', phone: '+91 98250 11223' },
      items: [],
      coupon: 'DIWALI10',
      tags: [],
      gift: { note: 'Happy Diwali' },
    },
  ],
}

const base = inferSchema([orders], 'OrdersResponse')
// an enum too, so every generator sees one
const schema = applyOverrides(base, editField(emptyOverrides(), 'Order', 'status', { type: 'enum' }))
const list = inferSchema([[{ id: 1, name: 'a' }]], 'User')

/** Run generated schema code (`import * as x from 'lib'` + `export const`) against the real library. */
function evalSchemas<T>(code: string, lib: unknown, ident: string, exportName: string): T {
  const js = code
    .replace(/^import .*$/gm, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^export const /gm, 'const ')
  return new Function(ident, `${js}\nreturn ${exportName}`)(lib) as T
}

function broken() {
  const b = structuredClone(orders)
  b.orders[0].buyer.email = 'not-an-email'
  return b
}

describe('valibot', () => {
  it('accepts the sample and its mock data, and rejects a broken one', () => {
    const root = evalSchemas<v.GenericSchema>(toValibot(schema), v, 'v', 'ordersResponseSchema')
    expect(v.safeParse(root, orders).issues).toBeUndefined()
    expect(v.safeParse(root, broken()).success).toBe(false)
    expect(v.safeParse(root, { ...orders, orders: [{ ...orders.orders[0], status: 'lost' }] }).success).toBe(false)
    for (const seed of [1, 2, 3, 4]) expect(v.safeParse(root, toMock(schema, { seed })).issues).toBeUndefined()
    expect(v.safeParse(evalSchemas<v.GenericSchema>(toValibot(list), v, 'v', 'userListSchema'), [{ id: 1, name: 'b' }]).success).toBe(true)
  })
})

describe('yup', () => {
  const check = (s: yup.Schema, value: unknown) => {
    try {
      s.validateSync(value, { strict: true, abortEarly: false })
      return []
    } catch (e) {
      return (e as yup.ValidationError).errors
    }
  }
  it('accepts the sample and its mock data, and rejects a broken one', () => {
    const root = evalSchemas<yup.Schema>(toYup(schema), yup, 'yup', 'ordersResponseSchema')
    expect(check(root, orders)).toEqual([])
    expect(check(root, broken()).length).toBeGreaterThan(0)
    expect(check(root, { ...orders, orders: [{ ...orders.orders[0], status: 'lost' }] }).length).toBeGreaterThan(0)
    expect(check(root, { ...orders, orders: [{ ...orders.orders[0], coupon: undefined }] }).length).toBeGreaterThan(0)
    for (const seed of [1, 2, 3, 4]) expect(check(root, toMock(schema, { seed }))).toEqual([])
  })
  it('allows null in a nullable enum', () => {
    const s = applyOverrides(base, editField(editField(emptyOverrides(), 'Order', 'status', { type: 'enum' }), 'Order', 'status', { nullable: true }))
    const root = evalSchemas<yup.Schema>(toYup(s), yup, 'yup', 'ordersResponseSchema')
    expect(check(root, { ...orders, orders: [{ ...orders.orders[0], status: null }] })).toEqual([])
  })
})

/** Type-check virtual files with the real compiler, resolving packages from this package's node_modules. */
function typecheck(files: Record<string, string>): string[] {
  const dir = fileURLToPath(new URL('./__tsc__/', import.meta.url)).replace(/\\/g, '/')
  const virtual = new Map(Object.entries(files).map(([name, code]) => [dir + name, code]))
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, lang, ...rest) => (virtual.has(name) ? ts.createSourceFile(name, virtual.get(name) as string, lang) : getSourceFile.call(host, name, lang, ...rest))
  host.fileExists = (name) => virtual.has(name) || fileExists.call(host, name)
  host.directoryExists = (name) => [...virtual.keys()].some((f) => f.startsWith(`${name.replace(/\/$/, '')}/`)) || ts.sys.directoryExists(name)
  host.readFile = (name) => virtual.get(name) ?? readFile.call(host, name)
  const program = ts.createProgram([...virtual.keys()], options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.slice(dir.length) ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
}

describe('TypeScript outputs compile', () => {
  it('types, Zod, Valibot, Yup, fetch, Axios and TanStack Query', () => {
    const files: Record<string, string> = {}
    const set = (dir: string, s: Schema, opts: Parameters<typeof toFetch>[1]) => {
      files[`${dir}/types.ts`] = toTypeScript(s)
      files[`${dir}/schema.ts`] = toZod(s)
      files[`${dir}/valibot.ts`] = toValibot(s)
      files[`${dir}/yup.ts`] = toYup(s)
      files[`${dir}/api.ts`] = toFetch(s, opts)
      files[`${dir}/axios.ts`] = toAxios(s, opts)
      files[`${dir}/query.ts`] = toQueryHook(s, opts)
    }
    set('get', schema, { method: 'GET', url: 'https://api.example.in/v1/stores/:storeId/orders' })
    set('post', schema, { method: 'POST', url: '/api/stores/{storeId}/orders/:orderId', validate: false })
    set('put', list, { method: 'PUT', url: '/users' })
    set('delete', list, { method: 'DELETE', url: '/users/:id' })
    expect(typecheck(files)).toEqual([])
  }, 60_000)

  it('names hooks and query keys from the path', () => {
    const get = toQueryHook(schema, { method: 'GET', url: 'https://api.example.in/v1/stores/:storeId/orders' })
    expect(get).toContain('export function useOrders(storeId: string | number) {')
    expect(get).toContain(`queryKey: ['stores', storeId, 'orders'] as const,`)
    expect(toQueryHook(list, { method: 'DELETE', url: '/users/:id' })).toContain('mutationFn: (id: string | number) => deleteUser(id),')
    expect(toAxios(schema, { method: 'POST', url: '/orders' })).toContain(`const { data } = await axios.post('/orders', body, config)`)
  })
})

const python = spawnSync('python', ['-c', 'import pydantic; assert pydantic.VERSION >= "2"'], { encoding: 'utf8' })

describe('pydantic', () => {
  it('writes snake_case fields with aliases', () => {
    expect(snakeCase('imageUrl')).toBe('image_url')
    expect(snakeCase('first-name')).toBe('first_name')
    expect(snakeCase('class')).toBe('class_')
    expect(snakeCase('2fa')).toBe('field_2fa')
    const py = toPydantic(schema)
    expect(py).toContain('    placed_at: dt.datetime = Field(alias="placedAt")')
    expect(py).toContain('    date: dt.date')
    expect(py).toContain('    status: Literal["shipped", "pending"]')
    expect(py).toContain('    phone: str | None = None')
    expect(py).toContain('    gift: Gift | None = None')
    expect(toPydantic(list)).toContain('class UserList(RootModel[list[User]]):')
  })

  it.skipIf(python.status !== 0)('runs in Python and validates the sample and mock data', () => {
    const run = (code: string, root: string, data: unknown) =>
      spawnSync('python', ['-c', `${code}\nimport json, sys\nfor d in json.load(sys.stdin):\n    ${root}.model_validate(d)\nprint("ok")`], { input: JSON.stringify(data), encoding: 'utf8' })
    const r = run(toPydantic(schema), 'OrdersResponse', [orders, toMock(schema, { seed: 1 }), toMock(schema, { seed: 2 })])
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe('ok')
    const bad = run(toPydantic(schema), 'OrdersResponse', [{ ...orders, orders: [{ ...orders.orders[0], status: 'lost' }] }])
    expect(bad.stderr).toContain('ValidationError')
    expect(run(toPydantic(list), 'UserList', [[{ id: 1, name: 'a' }]]).stdout.trim()).toBe('ok')
  }, 30_000)
})

const go = spawnSync('go', ['version'], { encoding: 'utf8' })

describe('go', () => {
  it('writes structs with json tags, pointers for nullable values and enum types', () => {
    expect(goName('imageUrl')).toBe('ImageURL')
    expect(goName('user_id')).toBe('UserID')
    expect(goName('first-name')).toBe('FirstName')
    const code = toGo(schema)
    expect(code).toContain('import "time"')
    expect(code).toContain('type OrderStatus string')
    expect(code).toMatch(/\tOrderStatusShipped +OrderStatus = "shipped"/)
    expect(code).toMatch(/\tPlacedAt +time\.Time +`json:"placedAt"`/)
    expect(code).toMatch(/\tCoupon +\*string +`json:"coupon"`/)
    expect(code).toMatch(/\tPhone +\*string +`json:"phone,omitempty"`/)
    expect(code).toMatch(/\tGift +\**Gift +`json:"gift,omitempty"`/)
    expect(code).toMatch(/\tTags +\[\]string +`json:"tags"`/)
    expect(toGo(list)).toContain('type UserList []User')
  })

  it.skipIf(go.status !== 0)('is gofmt-clean and compiles', () => {
    const dir = fileURLToPath(new URL('./__go__/', import.meta.url))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(`${dir}/api.go`, toGo(schema))
    fs.writeFileSync(`${dir}/go.mod`, 'module example.com/api\n\ngo 1.21\n')
    try {
      expect(spawnSync('gofmt', ['-l', dir], { encoding: 'utf8' }).stdout).toBe('')
      expect(spawnSync('go', ['vet', './...'], { cwd: dir, encoding: 'utf8' }).status).toBe(0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})


describe('findDeclaration in the new outputs', () => {
  it('finds models in Pydantic, structs in Go and schemas in Valibot and Yup', () => {
    const lineAt = (code: string, at: { from: number; to: number } | null, which: 'from' | 'to') => (at ? code.split('\n')[at[which] - 1] : null)
    const py = toPydantic(schema)
    const p = findDeclaration(py, 'Buyer', 'pydantic')
    expect(lineAt(py, p, 'from')).toBe('class Buyer(BaseModel):')
    expect(lineAt(py, p, 'to')).toContain('phone: str | None = None')
    const goCode = toGo(schema)
    const g = findDeclaration(goCode, 'Buyer', 'go')
    expect(lineAt(goCode, g, 'from')).toBe('type Buyer struct {')
    expect(lineAt(goCode, g, 'to')).toBe('}')
    expect(lineAt(toValibot(schema), findDeclaration(toValibot(schema), 'Buyer', 'zod'), 'to')).toBe('export type Buyer = v.InferOutput<typeof buyerSchema>')
    expect(lineAt(toYup(schema), findDeclaration(toYup(schema), 'Buyer', 'zod'), 'from')).toBe('export const buyerSchema = yup.object({')
  })
})
