import type { HttpMethod } from '../generate/fetch'
import { camelCase, isIdentifier, itemName, pascalCase } from '../names'
import type { Field, ObjectType, Shape, StringFormat } from '../types'
import { derivedName, defaultSummary, emptyContract, HTTP_METHODS, resourceOf, syncPathParams } from '../contract/model'
import { isParamShape } from '../contract/shapes'
import type { Contract, ContractEndpoint, ContractParam, ContractResponse, RequestBody, ResponseStatus } from '../contract/types'

/**
 * Read an OpenAPI 3.0 or 3.1 document (already parsed from JSON or YAML) into
 * a contract. Object schemas become named types, components keep their names,
 * and inline objects are named after where they sit (`CreateOrderBody`,
 * `OrderItem`). What the shared schema can't hold is simplified and listed in
 * `warnings`, in plain words.
 */

type J = Record<string, unknown>

export interface OpenApiImport {
  contract: Contract
  warnings: string[]
}

const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

const FORMATS: Record<string, StringFormat> = { 'date-time': 'date-time', date: 'date', email: 'email', uuid: 'uuid', uri: 'uri', url: 'uri', 'uri-reference': 'uri' }

const SCHEMA_REF = '#/components/schemas/'

/** `/components/schemas/Order~1Line` → the value it points at */
function pointer(doc: J, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let at: unknown = doc
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isObj(at) && !Array.isArray(at)) return undefined
    at = (at as J)[key]
  }
  return at
}

/** Combine shapes into one: a union with at most one member per kind, `null` last (the shared schema's rule). */
function unionOf(shapes: Shape[], lost: (what: string) => void): Shape {
  const flat = shapes.flatMap((s) => (s.kind === 'union' ? s.options : [s])).filter((s) => s.kind !== 'unknown')
  if (shapes.some((s) => s.kind === 'unknown')) return { kind: 'unknown' }
  const byKind = new Map<string, Shape>()
  for (const s of flat) {
    const kind = s.kind === 'enum' ? 'string' : s.kind
    const had = byKind.get(kind)
    if (!had) byKind.set(kind, s)
    else if (had.kind === 'enum' && s.kind === 'enum') byKind.set(kind, { kind: 'enum', values: [...new Set([...had.values, ...s.values])] })
    else if (had.kind === 'enum' || s.kind === 'enum') byKind.set(kind, { kind: 'string' })
    else if (had.kind === 'string' && s.kind === 'string') byKind.set(kind, had.format === s.format ? had : { kind: 'string' })
    else if (had.kind === 'number' && s.kind === 'number') byKind.set(kind, { kind: 'number', integer: had.integer && s.integer })
    else if (had.kind === 'ref' && s.kind === 'ref' && had.name !== s.name) lost(`can be ${had.name} or ${s.name}; it keeps ${had.name}`)
    else if (had.kind === 'array' && s.kind === 'array') byKind.set(kind, { kind: 'array', items: unionOf([had.items, s.items], lost) })
  }
  const options = [...byKind.values()].sort((a, b) => (a.kind === 'null' ? 1 : b.kind === 'null' ? -1 : 0))
  if (options.length === 0) return { kind: 'unknown' }
  return options.length === 1 ? options[0] : { kind: 'union', options }
}

class Importer {
  readonly types: ObjectType[] = []
  readonly warnings: string[] = []
  /** component key → its type's name, for components that are objects */
  private readonly componentTypes = new Map<string, string>()
  /** non-object components being converted, to stop a cycle of them */
  private readonly resolving = new Set<string>()

  private readonly doc: J

  constructor(doc: J) {
    this.doc = doc
  }

  warn(message: string) {
    if (!this.warnings.includes(message)) this.warnings.push(message)
  }

  private takeName(wanted: string): string {
    const base = pascalCase(wanted)
    const taken = new Set([...this.types.map((t) => t.name), ...this.componentTypes.values()])
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`
    return name
  }

  private deref(value: unknown, seen = new Set<string>()): unknown {
    if (!isObj(value) || typeof value.$ref !== 'string') return value
    const ref = value.$ref
    if (seen.has(ref)) return undefined
    seen.add(ref)
    const target = pointer(this.doc, ref)
    if (target === undefined) this.warn(`${ref} points outside this file or at nothing, so it was read as any value. Stacksketch only follows refs inside the file.`)
    return this.deref(target, seen)
  }

  /** Whether a schema is an object with fields (or a mix of them, with allOf). */
  private isObjectSchema(schema: unknown, seen = new Set<unknown>()): boolean {
    if (!isObj(schema) || seen.has(schema)) return false
    seen.add(schema)
    if (typeof schema.$ref === 'string') return false
    if (Array.isArray(schema.allOf)) return schema.allOf.length > 0 && schema.allOf.every((s) => this.isObjectSchema(this.deref(s), seen) || this.isComponentObject(s))
    const type = schema.type
    if (isObj(schema.properties)) return true
    return (type === 'object' || (Array.isArray(type) && type.includes('object'))) && !isObj(schema.additionalProperties)
  }

  private isComponentObject(schema: unknown): boolean {
    return isObj(schema) && typeof schema.$ref === 'string' && schema.$ref.startsWith(SCHEMA_REF) && this.componentTypes.has(decodeURIComponent(schema.$ref.slice(SCHEMA_REF.length)))
  }

  /** Name every object component first, so refs to them (even from earlier components) become refs. */
  components() {
    const schemas = isObj(this.doc.components) && isObj(this.doc.components.schemas) ? this.doc.components.schemas : {}
    // two passes: allOf of other components only counts as an object once those are known
    for (let pass = 0; pass < 2; pass++)
      for (const [key, schema] of Object.entries(schemas)) if (!this.componentTypes.has(key) && this.isObjectSchema(schema)) this.componentTypes.set(key, this.takeName(key))
    for (const [key, schema] of Object.entries(schemas)) {
      const name = this.componentTypes.get(key)
      if (name) this.types.push({ name, fields: this.fieldsOf(schema as J, name) })
    }
  }

  /** The fields of an object schema; allOf parts are merged in order. */
  private fieldsOf(schema: J, typeName: string): Field[] {
    const parts: J[] = []
    const collect = (s: unknown, seen: Set<unknown>) => {
      const d = this.deref(s)
      if (!isObj(d) || seen.has(d)) return
      seen.add(d)
      if (Array.isArray(d.allOf)) d.allOf.forEach((p) => collect(p, seen))
      parts.push(d)
    }
    collect(schema, new Set())
    const fields = new Map<string, Field>()
    const required = new Set(parts.flatMap((p) => (Array.isArray(p.required) ? p.required.filter((r): r is string => typeof r === 'string') : [])))
    for (const p of parts) {
      if (!isObj(p.properties)) continue
      // inline objects are named after their key, like the API explorer names them: `buyer` → Buyer, `items` → Item
      for (const [key, prop] of Object.entries(p.properties)) fields.set(key, { key, shape: this.shape(prop, pascalCase(key), `${typeName}.${key}`), optional: !required.has(key) })
    }
    return [...fields.values()]
  }

  /**
   * A schema as a shape. `hint` names a new type if the schema is an inline
   * object; `where` says where it sits, for warnings.
   */
  shape(schema: unknown, hint: string, where: string): Shape {
    if (schema === true || schema === undefined) return { kind: 'unknown' }
    if (!isObj(schema)) return { kind: 'unknown' }
    const lost = (what: string) => this.warn(`${where} ${what}.`)

    if (typeof schema.$ref === 'string') {
      const ref = schema.$ref
      const nullable = schema.nullable === true
      let out: Shape
      if (ref.startsWith(SCHEMA_REF) && this.componentTypes.has(decodeURIComponent(ref.slice(SCHEMA_REF.length)))) {
        out = { kind: 'ref', name: this.componentTypes.get(decodeURIComponent(ref.slice(SCHEMA_REF.length))) as string }
      } else if (this.resolving.has(ref)) {
        lost('refers to itself without an object in between, so it was read as any value')
        out = { kind: 'unknown' }
      } else {
        this.resolving.add(ref)
        const key = ref.startsWith(SCHEMA_REF) ? decodeURIComponent(ref.slice(SCHEMA_REF.length)) : hint
        out = this.shape(this.deref(schema), key, where)
        this.resolving.delete(ref)
      }
      return nullable ? unionOf([out, { kind: 'null' }], lost) : out
    }

    const nullable = schema.nullable === true
    const withNull = (s: Shape) => (nullable ? unionOf([s, { kind: 'null' }], lost) : s)

    if ('const' in schema) return withNull(this.values([schema.const], lost))
    if (Array.isArray(schema.enum)) return withNull(this.values(schema.enum, lost))

    for (const key of ['oneOf', 'anyOf'] as const) {
      const options = schema[key]
      if (Array.isArray(options) && options.length) {
        const shapes = options.map((o, i) => this.shape(o, options.length > 1 ? `${hint}${i + 1}` : hint, where))
        // a sibling `type: object` with properties adds nothing the options don't say
        return withNull(unionOf(shapes, lost))
      }
    }

    if (Array.isArray(schema.allOf) && schema.allOf.length) {
      if (schema.allOf.length === 1 && !isObj(schema.properties)) return withNull(this.shape(schema.allOf[0], hint, where))
      if (!this.isObjectSchema(schema)) {
        lost('combines schemas with allOf that aren’t all objects, so it was read as any value')
        return { kind: 'unknown' }
      }
    }

    const types = Array.isArray(schema.type) ? schema.type.filter((t): t is string => typeof t === 'string') : typeof schema.type === 'string' ? [schema.type] : []
    if (!types.length) {
      if (isObj(schema.properties) || Array.isArray(schema.allOf)) types.push('object')
      else if (isObj(schema.items)) types.push('array')
      else return withNull({ kind: 'unknown' })
    }
    const shapes = types.map((t) => this.single(t, schema, hint, where, lost))
    return withNull(unionOf(shapes, lost))
  }

  private single(type: string, schema: J, hint: string, where: string, lost: (what: string) => void): Shape {
    switch (type) {
      case 'string': {
        const format = FORMATS[str(schema.format)]
        return format ? { kind: 'string', format } : { kind: 'string' }
      }
      case 'integer':
      case 'number': {
        const out: Shape = { kind: 'number', integer: type === 'integer' }
        if (typeof schema.minimum === 'number') out.min = schema.minimum
        if (typeof schema.maximum === 'number') out.max = schema.maximum
        return out
      }
      case 'boolean':
        return { kind: 'boolean' }
      case 'null':
        return { kind: 'null' }
      case 'array':
        if (Array.isArray(schema.prefixItems)) lost('is a tuple, so it was read as a list')
        return { kind: 'array', items: this.shape(schema.items, itemName(hint), where + '[]') }
      case 'object': {
        if (!isObj(schema.properties) && !Array.isArray(schema.allOf) && schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
          lost('is a map of keys to values, which a shared-schema type can’t hold yet, so it was read as any value')
          return { kind: 'unknown' }
        }
        const name = this.takeName(hint)
        // reserve the name before the fields, which may name types of their own
        const type: ObjectType = { name, fields: [] }
        this.types.push(type)
        type.fields = this.fieldsOf(schema, name)
        return { kind: 'ref', name }
      }
      default:
        return { kind: 'unknown' }
    }
  }

  /** An `enum` or `const`: string values become an enum; numbers and booleans become their kind. */
  private values(values: unknown[], lost: (what: string) => void): Shape {
    const shapes: Shape[] = []
    const strings = values.filter((v): v is string => typeof v === 'string')
    if (strings.length) shapes.push({ kind: 'enum', values: [...new Set(strings)] })
    const numbers = values.filter((v): v is number => typeof v === 'number')
    if (numbers.length) {
      shapes.push({ kind: 'number', integer: numbers.every(Number.isInteger) })
      lost(`can only be ${numbers.join(', ')}; the shared schema keeps it as a number`)
    }
    if (values.some((v) => typeof v === 'boolean')) shapes.push({ kind: 'boolean' })
    if (values.includes(null)) shapes.push({ kind: 'null' })
    return unionOf(shapes, lost)
  }

  /* ---------- operations ---------- */

  private params(raw: unknown[], label: string, opName: string): ContractParam[] {
    const out: ContractParam[] = []
    for (const r of raw) {
      const p = this.deref(r)
      if (!isObj(p)) continue
      const name = str(p.name)
      const where = str(p.in)
      if (where === 'header' || where === 'cookie') {
        this.warn(`${where === 'header' ? 'Header' : 'Cookie'} params aren’t part of a contract yet, so ${name} on ${label} was left out.`)
        continue
      }
      if (where !== 'path' && where !== 'query') continue
      const typesBefore = this.types.length
      let shape = this.shape(p.schema, `${opName}${pascalCase(name)}`, `The ${name} param of ${label}`)
      if (!isParamShape(shape, where === 'query')) {
        this.warn(`The ${name} param of ${label} isn’t a plain value, so it was made a string.`)
        // drop any types made for it
        this.types.length = typesBefore
        shape = { kind: 'string' }
      }
      out.push({ name, in: where, shape, required: where === 'path' || p.required === true, ...(str(p.description).trim() ? { description: str(p.description).trim() } : {}) })
    }
    return out
  }

  /** The JSON body of a request or response, if it has one. */
  private content(holder: J, hint: string, where: string): Shape | undefined | null {
    if (!isObj(holder.content)) return undefined
    const types = Object.keys(holder.content)
    const json = types.find((t) => /^application\/json\b/i.test(t)) ?? types.find((t) => /[/+]json\b/i.test(t))
    if (!json) {
      if (types.length) return null
      return undefined
    }
    const media = holder.content[json]
    return this.shape(isObj(media) ? media.schema : undefined, hint, where)
  }

  endpoint(path: string, method: HttpMethod, op: J, shared: unknown[], newId: () => string): ContractEndpoint {
    const label = `${method} ${path}`
    const ownId = str(op.operationId)
    const named = isIdentifier(ownId) ? ownId : ownId && isIdentifier(camelCase(ownId)) ? camelCase(ownId) : ''
    const draft: ContractEndpoint = { id: newId(), method, path, summary: '', resource: '', params: [], responses: [] }
    const opName = pascalCase(named || derivedName(draft))

    // operation params replace path-level ones with the same name and place
    const own = Array.isArray(op.parameters) ? op.parameters : []
    const key = (p: unknown) => {
      const d = this.deref(p)
      return isObj(d) ? `${str(d.in)}:${str(d.name)}` : ''
    }
    const ownKeys = new Set(own.map(key))
    const params = this.params([...shared.filter((p) => !ownKeys.has(key(p))), ...own], label, opName)

    let body: RequestBody | undefined
    const rb = this.deref(op.requestBody)
    if (isObj(rb)) {
      const shape = this.content(rb, `${opName}Body`, `The request body of ${label}`)
      if (shape === null) this.warn(`The request body of ${label} isn’t JSON (${Object.keys(rb.content as J).join(', ')}), so it was left out.`)
      else if (shape) {
        if (method === 'GET' || method === 'DELETE') this.warn(`${label} sends a request body, which ${method} requests shouldn’t. It was left out.`)
        else body = { shape, required: rb.required === true }
      }
    }

    const responses: ContractResponse[] = []
    const rawResponses = isObj(op.responses) ? Object.entries(op.responses) : []
    const successes = rawResponses.filter(([s]) => /^2/.test(s)).length
    for (const [rawStatus, value] of rawResponses) {
      const r = this.deref(value)
      if (!isObj(r)) continue
      let status: ResponseStatus
      if (rawStatus === 'default') status = 'default'
      else if (/^\d{3}$/.test(rawStatus)) status = Number(rawStatus)
      else if (/^[1-5]XX$/i.test(rawStatus)) {
        status = Number(rawStatus[0]) * 100
        this.warn(`${label} has a response for any ${rawStatus} status; it was read as ${status}.`)
      } else continue
      if (responses.some((x) => x.status === status)) continue
      const isOk = typeof status === 'number' && status < 300 && status >= 200
      const hint = isOk ? (successes > 1 ? `${opName}${status}Response` : `${opName}Response`) : `${opName}${status === 'default' ? 'Error' : `${status}Error`}`
      const shape = this.content(r, hint, `The ${rawStatus} response of ${label}`)
      if (shape === null) this.warn(`The ${rawStatus} response of ${label} isn’t JSON, so its body was left out.`)
      responses.push({ status, description: str(r.description).trim(), ...(shape ? { body: shape } : {}) })
    }

    const tags = Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === 'string' && Boolean(t.trim())) : []
    const description = str(op.description).trim()
    const summary = str(op.summary).trim() || (description && !description.includes('\n') && description.length <= 80 ? description : '') || defaultSummary(method, path)
    const endpoint: ContractEndpoint = {
      ...draft,
      summary,
      ...(description && description !== summary ? { description } : {}),
      resource: tags[0]?.trim() ?? resourceOf(path),
      params,
      ...(body ? { body } : {}),
      responses,
    }
    // a name that's what Stacksketch would make up anyway stays unset, so it follows the path
    if (named && named !== derivedName(endpoint)) endpoint.operationId = named
    return syncPathParams(endpoint)
  }
}

/** The first server's URL, with its variables filled in from their defaults. */
function serverUrl(doc: J): string {
  const server = Array.isArray(doc.servers) ? doc.servers.find(isObj) : undefined
  if (!server) return ''
  const vars = isObj(server.variables) ? server.variables : {}
  return str(server.url).replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name]
    return isObj(v) && typeof v.default === 'string' ? v.default : whole
  })
}

/** Read an OpenAPI 3 document. Throws, with what to do about it, when it isn't one. */
export function fromOpenApi(doc: unknown, newId: () => string): OpenApiImport {
  if (!isObj(doc)) throw new Error('This isn’t an OpenAPI document: expected an object with "openapi" and "paths" at the top.')
  if (typeof doc.swagger === 'string')
    throw new Error(`This is a Swagger ${doc.swagger} file. Convert it to OpenAPI 3 first (for example with swagger2openapi or editor.swagger.io), then import it.`)
  const version = str(doc.openapi)
  if (!/^3\.[01]\b/.test(version)) throw new Error(version ? `OpenAPI ${version} isn’t supported. Stacksketch reads OpenAPI 3.0 and 3.1.` : 'This isn’t an OpenAPI document: it has no "openapi" version at the top.')

  const im = new Importer(doc)
  im.components()
  const endpoints: ContractEndpoint[] = []
  const paths = isObj(doc.paths) ? doc.paths : {}
  for (const [path, rawItem] of Object.entries(paths)) {
    const item = isObj(rawItem) && typeof rawItem.$ref === 'string' ? pointer(doc, rawItem.$ref) : rawItem
    if (!isObj(item)) continue
    const shared = Array.isArray(item.parameters) ? item.parameters : []
    for (const [m, op] of Object.entries(item)) {
      if (!isObj(op) || m === 'parameters' || m === 'servers') continue
      const method = m.toUpperCase() as HttpMethod
      if (!HTTP_METHODS.includes(method)) {
        if (['HEAD', 'OPTIONS', 'TRACE'].includes(method)) im.warn(`${method} ${path} was left out: contracts have GET, POST, PUT, PATCH and DELETE endpoints.`)
        continue
      }
      endpoints.push(im.endpoint(path, method, op, shared, newId))
    }
  }
  if (isObj(doc.webhooks) && Object.keys(doc.webhooks).length) im.warn('Webhooks were left out: a contract only holds the endpoints the API serves.')

  const info = isObj(doc.info) ? doc.info : {}
  const blank = emptyContract()
  const description = str(info.description).trim()
  return {
    contract: {
      ...blank,
      title: str(info.title).trim() || blank.title,
      apiVersion: str(info.version).trim() || blank.apiVersion,
      baseUrl: serverUrl(doc),
      ...(description ? { description } : {}),
      types: im.types,
      endpoints,
    },
    warnings: im.warnings,
  }
}
