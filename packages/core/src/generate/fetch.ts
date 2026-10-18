import { rootTypeName } from '../infer'
import { camelCase, isIdentifier, pascalCase, singular } from '../names'
import type { Schema } from '../types'
import { schemaName } from './zod'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface FetchOptions {
  method?: HttpMethod
  /** absolute or relative; `:id` and `{id}` become function parameters */
  url?: string
  /** check the response with the Zod schema (`./schema`) instead of trusting it (`./types`) */
  validate?: boolean
  /** override the generated function name */
  functionName?: string
}

const VERB: Record<HttpMethod, string> = { GET: 'get', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }

interface ParsedUrl {
  /** the URL as a JS expression: a quoted string or a template literal */
  expr: string
  params: string[]
  /** static path segments, for naming */
  segments: string[]
  /** the path as query-key parts: static segments quoted, params as identifiers */
  keyParts: string[]
  endsWithParam: boolean
  /** shown in error messages */
  label: string
}

function parseUrl(url: string): ParsedUrl {
  const params: string[] = []
  const segments: string[] = []
  const keyParts: string[] = []
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split('?')[0]
  }
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p) // new URL() encodes {id} as %7Bid%7D
      } catch {
        return p
      }
    })
  let endsWithParam = false
  for (const part of parts) {
    const m = /^(?::(\w+)|\{(\w+)\})$/.exec(part)
    endsWithParam = Boolean(m)
    if (m) {
      params.push(camelCase(m[1] ?? m[2]))
      keyParts.push(params[params.length - 1])
    } else if (!/^v\d+$|^api$/i.test(part)) {
      segments.push(part)
      keyParts.push(`'${part.replace(/[\\']/g, '\\$&')}'`)
    }
  }
  const raw = url.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')
  let i = 0
  const templated = raw.replace(/:(\w+)|\{(\w+)\}/g, (whole) => {
    // only path params, not ports like localhost:3000
    if (/^:\d/.test(whole)) return whole
    const p = params[i++]
    return p ? '${encodeURIComponent(String(' + p + '))}' : whole
  })
  const expr = params.length ? '`' + templated + '`' : `'${url.replace(/[\\']/g, '\\$&')}'`
  return { expr, params, segments, keyParts, endsWithParam, label: `/${parts.join('/')}` }
}

export function fetchFunctionName(method: HttpMethod, url: string): string {
  const { segments, endsWithParam } = parseUrl(url)
  const last = segments.at(-1) ?? 'resource'
  const one = method !== 'GET' || endsWithParam
  const noun = pascalCase(one ? singular(last) : last)
  const name = `${VERB[method]}${noun}`
  return isIdentifier(name) ? name : 'request'
}

/** Everything the client generators (fetch, Axios, TanStack Query) share about one endpoint. */
export interface Endpoint {
  method: HttpMethod
  fn: string
  type: string
  url: ParsedUrl
  hasBody: boolean
  validate: boolean
  /** `storeId: string | number`, … */
  paramArgs: string[]
  /** the line that imports the response type (and its Zod schema when validating) */
  importLine: string
  /** turns `expr` (the parsed JSON) into the response type */
  parse: (expr: string) => string
}

export function endpoint(schema: Schema, options: FetchOptions = {}): Endpoint {
  const method = options.method ?? 'GET'
  const url = options.url?.trim() || '/api/resource'
  const validate = options.validate ?? true
  const type = rootTypeName(schema)
  const parsed = parseUrl(url)
  return {
    method,
    fn: options.functionName && isIdentifier(options.functionName) ? options.functionName : fetchFunctionName(method, url),
    type,
    url: parsed,
    hasBody: method === 'POST' || method === 'PUT' || method === 'PATCH',
    validate,
    paramArgs: parsed.params.map((p) => `${p}: string | number`),
    importLine: validate ? `import { ${schemaName(type)}, type ${type} } from './schema'` : `import type { ${type} } from './types'`,
    parse: (expr) => (validate ? `${schemaName(type)}.parse(${expr})` : `(${expr}) as ${type}`),
  }
}

export const BODY_NOTE = `// The request body is untyped here. For a typed one, add this endpoint to the API contract in Stacksketch and use its client.`

/** The fetch function alone, without imports. */
export function fetchFunction(e: Endpoint): string {
  const args = [...e.paramArgs, ...(e.hasBody ? ['body: unknown'] : []), 'init?: RequestInit']
  const headers = e.hasBody ? `\n    headers: { 'Content-Type': 'application/json', ...init?.headers },\n    body: JSON.stringify(body),` : ''
  return `export async function ${e.fn}(${args.join(', ')}): Promise<${e.type}> {
  const res = await fetch(${e.url.expr}, {
    ...init,
    method: '${e.method}',${headers}
  })
  if (!res.ok) throw new Error(\`${e.method} ${e.url.label.replace(/[`\\$]/g, '\\$&')} failed: \${res.status} \${res.statusText}\`)
  return ${e.parse('await res.json()')}
}
`
}

/** A typed fetch function for the endpoint the sample came from. */
export function toFetch(schema: Schema, options: FetchOptions = {}): string {
  const e = endpoint(schema, options)
  return [e.importLine, ...(e.hasBody ? ['', BODY_NOTE] : []), '', fetchFunction(e)].join('\n')
}
