import type { ObjectType, Schema, Shape } from '../types'

export interface MockOptions {
  /** same seed, same data */
  seed?: number
  /** how many items an array at the root gets */
  rootCount?: number
  /** how many items nested arrays get, at most */
  nestedCount?: number
  /** chance an optional field is included */
  optionalRate?: number
}

/** mulberry32: tiny, fast, good enough for fake data */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['Aarav', 'Diya', 'Ishaan', 'Meera', 'Kabir', 'Anaya', 'Rohan', 'Priya', 'Vihaan', 'Sara', 'Arjun', 'Nisha', 'Liam', 'Emma', 'Noah', 'Olivia']
const LAST = ['Shah', 'Patel', 'Mehta', 'Iyer', 'Rao', 'Desai', 'Kapoor', 'Joshi', 'Nair', 'Smith', 'Garcia', 'Chen']
const CITIES = ['Rajkot', 'Ahmedabad', 'Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Jaipur', 'Surat', 'London', 'Berlin', 'Toronto']
const COUNTRIES = ['India', 'United Kingdom', 'Germany', 'Canada', 'Singapore', 'United States']
const WORDS = ['quick', 'steady', 'bright', 'simple', 'modern', 'compact', 'classic', 'smart', 'fresh', 'solid', 'premium', 'daily']
const NOUNS = ['order', 'report', 'widget', 'bundle', 'project', 'invoice', 'lamp', 'chair', 'notebook', 'kit', 'plan', 'ticket']
const COMPANIES = ['Northwind', 'Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay', 'Stark']

type Rand = () => number

class Faker {
  private ids = new Map<string, number>()
  readonly r: Rand
  readonly opts: Required<MockOptions>
  constructor(r: Rand, opts: Required<MockOptions>) {
    this.r = r
    this.opts = opts
  }

  int(min: number, max: number) {
    return Math.floor(this.r() * (max - min + 1)) + min
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.r() * list.length)]
  }
  nextId(key: string) {
    const n = (this.ids.get(key) ?? 0) + 1
    this.ids.set(key, n)
    return n
  }
  hex(n: number) {
    let s = ''
    for (let i = 0; i < n; i++) s += Math.floor(this.r() * 16).toString(16)
    return s
  }
  uuid() {
    const variant = '89ab'[this.int(0, 3)]
    return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-${variant}${this.hex(3)}-${this.hex(12)}`
  }
  date() {
    const start = Date.UTC(2025, 0, 1)
    const end = Date.UTC(2026, 11, 31)
    return new Date(start + this.r() * (end - start))
  }
  sentence() {
    const n = this.int(5, 10)
    const words = Array.from({ length: n }, () => this.pick([...WORDS, ...NOUNS]))
    return words.join(' ').replace(/^./, (c) => c.toUpperCase()) + '.'
  }
}

/** "avatarUrl" / "avatar_url" → ["avatar", "url"] */
const tokens = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** does any word of the key equal one of `words` (or its plural)? */
const has = (key: string, ...words: string[]) => tokens(key).some((t) => words.some((w) => t === w || t === `${w}s` || t === `${w}es`))
const isIdKey = (key: string) => ['id', 'uuid', 'guid'].includes(tokens(key).at(-1) ?? '')

function mockString(f: Faker, shape: Extract<Shape, { kind: 'string' }>, key: string, parent: string): string {
  const k = key.toLowerCase()
  switch (shape.format) {
    case 'email':
      return `${f.pick(FIRST).toLowerCase()}.${f.pick(LAST).toLowerCase()}${f.int(1, 99)}@example.com`
    case 'uuid':
      return f.uuid()
    case 'date-time':
      return f.date().toISOString()
    case 'date':
      return f.date().toISOString().slice(0, 10)
    case 'uri':
      if (has(key, 'image', 'avatar', 'photo', 'thumbnail', 'logo', 'picture')) return `https://picsum.photos/seed/${f.int(1, 9999)}/400/300`
      return `https://example.com/${k.replace(/url$|link$/, '') || 'page'}/${f.int(1, 999)}`
  }
  if (isIdKey(key)) return shape.examples?.[0]?.length === 36 ? f.uuid() : `${k.replace(/_?id$/, '') || 'id'}_${f.hex(8)}`
  if (k === 'firstname' || (has(key, 'first', 'given') && has(key, 'name'))) return f.pick(FIRST)
  if (k === 'lastname' || has(key, 'surname') || (has(key, 'last', 'family') && has(key, 'name'))) return f.pick(LAST)
  if ((k.endsWith('name') && k !== 'username') || has(key, 'author', 'customer')) {
    if (has(key, 'company', 'org', 'brand', 'shop', 'store')) return `${f.pick(COMPANIES)} ${f.pick(['Ltd', 'Inc', 'Traders', 'Labs'])}`
    if (has(key, 'product', 'item')) return `${f.pick(WORDS)} ${f.pick(NOUNS)}`.replace(/^./, (c) => c.toUpperCase())
    if (k === 'name') {
      // a bare "name" means whatever its object is: a person, a product, or something we can only copy from the sample
      if (has(parent, 'user', 'customer', 'buyer', 'person', 'member', 'author', 'contact', 'employee', 'owner', 'profile', 'account', 'tenant', 'student')) return `${f.pick(FIRST)} ${f.pick(LAST)}`
      if (has(parent, 'product', 'item', 'line', 'sku', 'variant', 'plan', 'package')) return `${f.pick(WORDS)} ${f.pick(NOUNS)}`.replace(/^./, (c) => c.toUpperCase())
      if (shape.examples?.length) return f.pick(shape.examples)
    }
    return `${f.pick(FIRST)} ${f.pick(LAST)}`
  }
  if (has(key, 'username', 'handle', 'login')) return `${f.pick(FIRST).toLowerCase()}${f.int(1, 999)}`
  if (has(key, 'phone', 'mobile', 'contact')) return `+91 ${f.int(70000, 99999)} ${f.int(10000, 99999)}`
  if (has(key, 'city')) return f.pick(CITIES)
  if (has(key, 'country')) return f.pick(COUNTRIES)
  if (has(key, 'company', 'organization', 'organisation', 'brand')) return f.pick(COMPANIES)
  if (has(key, 'address', 'street')) return `${f.int(1, 220)} ${f.pick(['MG Road', 'Station Road', 'Park Street', 'High Street', 'Ring Road'])}`
  if (has(key, 'zip', 'zipcode', 'postal', 'pincode', 'postcode')) return String(f.int(110001, 899999))
  if (has(key, 'color', 'colour')) return `#${f.hex(6)}`
  if (has(key, 'title', 'subject', 'headline')) return `${f.pick(WORDS)} ${f.pick(NOUNS)} ${f.int(1, 99)}`.replace(/^./, (c) => c.toUpperCase())
  if (has(key, 'description', 'bio', 'summary', 'body', 'content', 'message', 'comment', 'note')) return f.sentence()
  if (has(key, 'slug')) return `${f.pick(WORDS)}-${f.pick(NOUNS)}-${f.int(1, 99)}`
  if (has(key, 'sku', 'code')) return `${f.pick(NOUNS).slice(0, 3).toUpperCase()}-${f.int(1000, 9999)}`
  if (has(key, 'token', 'hash', 'secret')) return f.hex(32)
  // status, role, currency, type…: real values from the sample beat invented ones
  if (shape.examples?.length) return f.pick(shape.examples)
  return `${f.pick(WORDS)} ${f.pick(NOUNS)}`
}

function mockNumber(f: Faker, shape: Extract<Shape, { kind: 'number' }>, key: string): number {
  const k = key.toLowerCase()
  if (shape.integer && isIdKey(key)) return f.nextId(k)
  let min = shape.min ?? 0
  let max = shape.max ?? 1000
  if (min === max) {
    // one sample: spread around it
    const spread = Math.max(Math.abs(min) * 0.5, shape.integer ? 10 : 1)
    min = min >= 0 ? Math.max(0, min - spread) : min - spread
    max = max + spread
  }
  if (has(key, 'rating', 'stars')) [min, max] = [Math.max(min, 1), Math.min(Math.max(max, 1), 5)]
  if (has(key, 'lat', 'latitude')) [min, max] = [8, 35]
  if (has(key, 'lng', 'lon', 'long', 'longitude')) [min, max] = [68, 97]
  const v = min + f.r() * (max - min)
  return shape.integer ? Math.round(v) : Math.round(v * 100) / 100
}

function mockValue(f: Faker, shape: Shape, key: string, types: Map<string, ObjectType>, depth: number, parent = ''): unknown {
  switch (shape.kind) {
    case 'string':
      return mockString(f, shape, key, parent)
    case 'number':
      return mockNumber(f, shape, key)
    case 'boolean':
      return f.r() < 0.5
    case 'null':
    case 'unknown':
      return null
    case 'array': {
      if (depth > 6) return []
      const n = f.int(1, Math.max(1, f.opts.nestedCount))
      return Array.from({ length: n }, () => mockValue(f, shape.items, key, types, depth + 1, parent))
    }
    case 'union': {
      const nonNull = shape.options.filter((o) => o.kind !== 'null')
      if (!nonNull.length || (nonNull.length < shape.options.length && f.r() < 0.2)) return null
      return mockValue(f, f.pick(nonNull), key, types, depth, parent)
    }
    case 'ref': {
      const type = types.get(shape.name)
      if (!type || depth > 6) return {}
      const out: Record<string, unknown> = {}
      for (const field of type.fields) {
        if (field.optional && f.r() > f.opts.optionalRate) continue
        out[field.key] = mockValue(f, field.shape, field.key, types, depth + 1, type.name)
      }
      return out
    }
  }
}

/** Realistic fake data that matches the schema, the same every time for a given seed. */
export function toMock(schema: Schema, options: MockOptions = {}): unknown {
  const opts: Required<MockOptions> = { seed: 1, rootCount: 5, nestedCount: 3, optionalRate: 0.75, ...options }
  const f = new Faker(rng(opts.seed), opts)
  const types = new Map(schema.types.map((t) => [t.name, t]))
  if (schema.root.kind === 'array') {
    const items = schema.root.items
    return Array.from({ length: opts.rootCount }, () => mockValue(f, items, schema.rootName, types, 1))
  }
  return mockValue(f, schema.root, schema.rootName, types, 0)
}
