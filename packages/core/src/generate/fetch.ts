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
  endsWithParam: boolean
  /** shown in error messages */
  label: string
}

function parseUrl(url: string): ParsedUrl {
  const params: string[] = []
  const segments: string[] = []
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
    if (m) params.push(camelCase(m[1] ?? m[2]))
    else if (!/^v\d+$|^api$/i.test(part)) segments.push(part)
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
  return { expr, params, segments, endsWithParam, label: `/${parts.join('/')}` }
}

export function fetchFunctionName(method: HttpMethod, url: string): string {
  const { segments, endsWithParam } = parseUrl(url)
  const last = segments.at(-1) ?? 'resource'
  const one = method !== 'GET' || endsWithParam
  const noun = pascalCase(one ? singular(last) : last)
  const name = `${VERB[method]}${noun}`
  return isIdentifier(name) ? name : 'request'
}

/** A typed fetch function for the endpoint the sample came from. */
export function toFetch(schema: Schema, options: FetchOptions = {}): string {
  const method = options.method ?? 'GET'
  const url = options.url?.trim() || '/api/resource'
  const validate = options.validate ?? true
  const type = rootTypeName(schema)
  const parsed = parseUrl(url)
  const fn = options.functionName && isIdentifier(options.functionName) ? options.functionName : fetchFunctionName(method, url)
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

  const args = [...parsed.params.map((p) => `${p}: string | number`), ...(hasBody ? ['body: unknown'] : []), 'init?: RequestInit']
  const headers = hasBody ? `\n    headers: { 'Content-Type': 'application/json', ...init?.headers },\n    body: JSON.stringify(body),` : ''
  const imports = validate ? `import { ${schemaName(type)}, type ${type} } from './schema'` : `import type { ${type} } from './types'`
  const parse = validate ? `${schemaName(type)}.parse(await res.json())` : `(await res.json()) as ${type}`
  const bodyNote = hasBody ? `\n// The request body is untyped for now: the API contract designer (phase 3) will type it.` : ''

  return `${imports}
${bodyNote}
export async function ${fn}(${args.join(', ')}): Promise<${type}> {
  const res = await fetch(${parsed.expr}, {
    ...init,
    method: '${method}',${headers}
  })
  if (!res.ok) throw new Error(\`${method} ${parsed.label.replace(/[`\\$]/g, '\\$&')} failed: \${res.status} \${res.statusText}\`)
  return ${parse}
}
`.replace(/\n\n\n/g, '\n\n')
}
