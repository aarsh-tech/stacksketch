/// <reference types="node" />
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

import { contractProblems, dbCrudContract, dbProblems, parseDbml, readSchemasketchFile, tablesToTypes, toContractZod, toExpressRoutes, toNextRoutes, toPrisma, toSqlMigration } from './index'
import { typecheck } from './typecheck.testutil'

const { validate } = createRequire(import.meta.url)('@prisma/prisma-schema-wasm') as { validate: (params: string) => void }

/** Schemasketch's own sample, plus the awkward bits: a self-relation, two refs to one table, a composite key, a quoted name, comments and a many-to-many. */
const DBML = `// A small online bookshop
Project bookshop {
  database_type: 'PostgreSQL'
  Note: 'Orders, books and the people who buy them'
}

Enum order_status {
  pending
  paid
  shipped
  "on hold" [note: 'waiting for stock']
}

Table customers as C {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  full_name varchar(120) [not null, note: 'as on the card']
  referred_by integer [ref: > C.id] // who sent them
  created_at timestamp [default: \`now()\`]
  Note: 'One row per registered buyer'
}

Table addresses {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  line_1 varchar(200) [not null]
  city varchar(80)
}

Table orders {
  id uuid [pk, default: \`gen_random_uuid()\`]
  customer_id integer [not null]
  billing_address_id integer
  shipping_address_id integer
  status order_status [not null, default: 'pending']
  is_gift boolean [default: false]
  total decimal(10,2) [not null, default: 0]
  placed_at timestamp [default: \`now()\`]

  indexes {
    (customer_id, placed_at) [name: 'orders_by_customer']
    status
  }
}

Ref: orders.customer_id > customers.id [delete: cascade]
Ref billing: orders.billing_address_id > addresses.id
Ref { orders.shipping_address_id > addresses.id }

Table order_items {
  order_id uuid [ref: > orders.id]
  book_id integer [ref: > books.id]
  quantity integer [not null, default: 1]
  "unit price" decimal(10,2) [not null]

  indexes {
    (order_id, book_id) [pk]
  }
}

Table books [headercolor: #3B6EA5] {
  id integer [pk, increment]
  isbn varchar(13) [unique]
  title varchar(255) [not null]
  /* tags as an array */
  tags text[]
}

Table authors {
  id integer [pk, increment]
  name varchar(120) [not null]
}

Ref: books.id <> authors.id
`

const { model, problems } = parseDbml(DBML)

const prismaErrors = (schema: string): string => {
  try {
    validate(JSON.stringify({ prismaSchema: [['schema.prisma', schema]], noColor: true }))
    return ''
  } catch (e) {
    return String(e instanceof Error ? e.message : e)
  }
}

describe('reading DBML', () => {
  it('reads tables, columns, enums, indexes and every way of writing a relationship', () => {
    expect(problems).toEqual([])
    expect(model.name).toBe('bookshop')
    expect(model.tables.map((t) => t.name)).toEqual(['customers', 'addresses', 'orders', 'order_items', 'books', 'authors'])
    expect(model.enums).toEqual([{ name: 'order_status', schema: null, values: ['pending', 'paid', 'shipped', 'on hold'] }])
    const customers = model.tables[0]
    expect(customers).toMatchObject({ alias: 'C', note: 'One row per registered buyer' })
    expect(customers.columns[1]).toMatchObject({ name: 'email', type: 'varchar(255)', unique: true, notNull: true })
    expect(customers.columns[2].note).toBe('as on the card')
    expect(customers.columns[4].default).toEqual({ kind: 'expression', value: 'now()' })
    expect(model.tables[2].indexes).toEqual([
      { name: 'orders_by_customer', columns: ['customer_id', 'placed_at'], unique: false, pk: false },
      { name: null, columns: ['status'], unique: false, pk: false },
    ])
    expect(model.tables[3].columns[3].name).toBe('unit price')
    expect(model.refs.map((r) => `${r.from.table}.${r.from.columns} ${r.kind} ${r.to.table}.${r.to.columns}${r.onDelete ? ` (${r.onDelete})` : ''}`)).toEqual([
      'customers.referred_by > customers.id',
      'addresses.customer_id > customers.id',
      'orders.customer_id > customers.id (cascade)',
      'orders.billing_address_id > addresses.id',
      'orders.shipping_address_id > addresses.id',
      'order_items.order_id > orders.id',
      'order_items.book_id > books.id',
      'books.id <> authors.id',
    ])
  })

  it('says which lines it couldn’t read', () => {
    const bad = parseDbml('Table t {\n  id integer [pk]\n  ???\n}\nRef: a.b ~ c.d')
    expect(bad.problems).toEqual(['Line 3: couldn’t read “???” in t. Columns look like: email varchar(255) [not null].', 'Line 5: couldn’t read the relationship “a.b ~ c.d”. Write it like orders.customer_id > customers.id.'])
  })

  it('reads Schemasketch project files', () => {
    expect(readSchemasketchFile({ app: 'schemasketch', version: 1, name: 'Shop', source: 'Table a {\n id int [pk]\n}', positions: {} }).model).toMatchObject({ name: 'Shop', tables: [{ name: 'a' }] })
    expect(() => readSchemasketchFile({ app: 'other' })).toThrow('This isn’t a Schemasketch project file.')
  })
})

describe('types', () => {
  it('makes a shared-schema type per table', () => {
    const types = tablesToTypes(model)
    expect(types.map((t) => t.name)).toEqual(['Customer', 'Address', 'Order', 'OrderItem', 'Book', 'Author'])
    const order = types[2].fields
    expect(order.map((f) => f.key)).toEqual(['id', 'customerId', 'billingAddressId', 'shippingAddressId', 'status', 'isGift', 'total', 'placedAt'])
    expect(order[0].shape).toEqual({ kind: 'string', format: 'uuid' })
    expect(order[4].shape).toEqual({ kind: 'enum', values: ['pending', 'paid', 'shipped', 'on hold'] })
    expect(order[5].shape).toEqual({ kind: 'union', options: [{ kind: 'boolean' }, { kind: 'null' }] })
    expect(types[0].fields[1].shape).toEqual({ kind: 'string', format: 'email' })
  })
})

describe('Prisma', () => {
  it('passes Prisma’s own validation, for each provider', () => {
    for (const provider of ['postgresql', 'mysql', 'sqlite'] as const) expect(prismaErrors(toPrisma(model, provider))).toBe('')
  })

  it('names relations on both sides, and maps names back to the database', () => {
    const schema = toPrisma(model)
    expect(schema).toContain('  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)')
    expect(schema).toContain('  billingAddress Address? @relation("OrderBillingAddress", fields: [billingAddressId], references: [id])')
    expect(schema).toContain('  billingAddressOrders Order[] @relation("OrderBillingAddress")')
    expect(schema).toContain('  referredBy Int? @map("referred_by")')
    expect(schema).toContain('  @@id([orderId, bookId])')
    expect(schema).toContain('  onHold @map("on hold")')
    expect(schema).toContain('  status OrderStatus @default(pending)')
    expect(schema).toContain('  @@map("order_items")')
  })

  it('validates a table without a key, and a relationship to a column that isn’t unique', () => {
    const odd = parseDbml('Table logs {\n  message text\n}\nTable users {\n  id int [pk]\n  code varchar(8)\n}\nTable invites {\n  id int [pk]\n  code varchar(8) [ref: > users.code]\n}').model
    const schema = toPrisma(odd)
    expect(schema).toContain('@@ignore')
    expect(schema).toContain('code String? @unique @db.VarChar(8)')
    expect(prismaErrors(schema)).toBe('')
  })
})

describe('SQL migrations', () => {
  it('runs on PostgreSQL, keys and all', async () => {
    const db = new PGlite()
    await db.exec(toSqlMigration(model, 'postgres'))
    await db.exec(`INSERT INTO customers (email, full_name) VALUES ('a@b.in', 'Diya')`)
    const { rows } = await db.query<{ id: string }>(`INSERT INTO orders (customer_id) VALUES (1) RETURNING id`)
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    await expect(db.exec(`INSERT INTO orders (customer_id) VALUES (99)`)).rejects.toThrow(/foreign key/)
    await expect(db.exec(`INSERT INTO orders (customer_id, status) VALUES (1, 'lost')`)).rejects.toThrow(/enum/)
    await db.exec(`DELETE FROM customers WHERE id = 1`)
    expect((await db.query('SELECT * FROM orders')).rows).toHaveLength(0)
    await db.close()
  })

  it('runs on SQLite, with foreign keys inside the tables', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(toSqlMigration(model, 'sqlite'))
    db.exec(`INSERT INTO customers (email, full_name) VALUES ('a@b.in', 'Diya')`)
    db.exec(`INSERT INTO orders (id, customer_id) VALUES ('o1', 1)`)
    expect(() => db.exec(`INSERT INTO orders (id, customer_id) VALUES ('o2', 99)`)).toThrow(/FOREIGN KEY/)
    expect(() => db.exec(`INSERT INTO orders (id, customer_id, status) VALUES ('o3', 1, 'lost')`)).toThrow(/CHECK/)
    db.close()
  })

  it('writes MySQL with backticks, inline enums and AUTO_INCREMENT', () => {
    const sql = toSqlMigration(model, 'mysql')
    expect(sql).toContain('`status` ENUM(\'pending\', \'paid\', \'shipped\', \'on hold\') NOT NULL DEFAULT \'pending\'')
    expect(sql).toContain('`id` integer NOT NULL AUTO_INCREMENT')
    expect(sql).toContain('ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE;')
  })
})

describe('CRUD', () => {
  const { contract, skipped } = dbCrudContract(model)

  it('makes a contract with endpoints for every table with a single key', () => {
    expect(skipped).toEqual(['order_items has a composite primary key, so it gets a type but no endpoints.'])
    expect(dbProblems(model)).toEqual(skipped)
    expect(contractProblems(contract)).toEqual([])
    expect(contract.endpoints.filter((e) => e.resource === 'Customers').map((e) => `${e.method} ${e.path}`)).toEqual([
      'GET /customers',
      'POST /customers',
      'GET /customers/{customerId}',
      'PATCH /customers/{customerId}',
      'DELETE /customers/{customerId}',
    ])
    const newOrder = contract.types.find((t) => t.name === 'NewOrder')!
    expect(newOrder.fields.map((f) => `${f.key}${f.optional ? '?' : ''}`)).toEqual(['id?', 'customerId', 'billingAddressId?', 'shippingAddressId?', 'status?', 'isGift?', 'total?', 'placedAt?'])
  })

  it('writes Express and Next.js handlers that compile with the contract’s schemas', () => {
    const schema = toContractZod(contract)
    // Prisma Client is generated in the app, so the tests stand in for it
    const db = 'export const prisma: any = {}\n'
    const express = { ...toExpressRoutes(model), 'db.ts': db, 'schema.ts': schema }
    expect(typecheck(express, { types: ['express'] })).toEqual([])
    const next = Object.fromEntries(Object.entries({ ...toNextRoutes(model), 'db.ts': db, 'schema.ts': schema }).map(([k, v]) => [k, v.replace(/'@\/(db|schema)'/g, (_, m: string) => `'${'../'.repeat(k.split('/').length - 1)}${m}'`)]))
    expect(typecheck(next)).toEqual([])
    expect(Object.keys(next)).toContain('app/api/customers/[id]/route.ts')
  })
})
