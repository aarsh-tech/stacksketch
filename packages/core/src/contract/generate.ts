import { tsDeclaration, tsType } from '../generate/typescript'
import { schemaName, zodDeclarations, zodExpr } from '../generate/zod'
import { refsOf, typesInDependencyOrder } from '../infer'
import { camelCase } from '../names'
import type { Shape } from '../types'
import { functionNames, hasRequestBody, isSuccess, openApiPath, statusOrder, statusText, successResponse, usableContract } from './model'
import type { Contract, ContractEndpoint } from './types'

export const CONTRACT_FILES = { types: 'types.ts', schema: 'schema.ts', client: 'client.ts' } as const

/** Every type in the contract as TypeScript, each after the ones it uses. */
export function toContractTypes(contract: Contract): string {
  const { types } = usableContract(contract).contract
  if (!types.length) return '// No types yet. Add one, or bring one in from the API explorer.\nexport {}\n'
  return typesInDependencyOrder(types).map((t) => tsDeclaration(t)).join('\n\n') + '\n'
}

/** Every type in the contract as a Zod 4 schema with its inferred type. */
export function toContractZod(contract: Contract): string {
  const { types } = usableContract(contract).contract
  if (!types.length) return '// No types yet. Add one, or bring one in from the API explorer.\nexport {}\n'
  return [`import { z } from 'zod'`, ...zodDeclarations(types)].join('\n\n') + '\n'
}

export interface ClientOptions {
  /** check responses with the Zod schemas (`./schema`) instead of trusting them (`./types`) */
  validate?: boolean
}

/** Drop `| null` from a param's shape: a missing param is left out, not sent as null. */
const withoutNull = (s: Shape): Shape => {
  if (s.kind !== 'union') return s
  const options = s.options.filter((o) => o.kind !== 'null')
  return options.length === 1 ? options[0] : { kind: 'union', options }
}

const comment = (s: string) => s.replace(/\*\//g, '*\\/').trim()

interface Arg {
  name: string
  type: string
  optional: boolean
  fallback?: string
}

function endpointFunction(e: ContractEndpoint, fn: string, validate: boolean, errorClass: string, track: (s: Shape) => void): string {
  const args: Arg[] = []
  const pathArgs = new Map<string, string>()
  for (const p of e.params.filter((x) => x.in === 'path')) {
    const name = camelCase(p.name)
    pathArgs.set(p.name, name)
    track(p.shape)
    args.push({ name, type: tsType(withoutNull(p.shape)), optional: false })
  }
  const body = hasRequestBody(e.method) ? e.body : undefined
  if (body) {
    track(body.shape)
    args.push({ name: 'body', type: tsType(body.shape), optional: !body.required })
  }
  const query = e.params.filter((x) => x.in === 'query')
  if (query.length) {
    const props = query.map((p) => {
      track(p.shape)
      return `${/^[A-Za-z_$][\w$]*$/.test(p.name) ? p.name : JSON.stringify(p.name)}${p.required ? '' : '?'}: ${tsType(withoutNull(p.shape))}`
    })
    const required = query.some((p) => p.required)
    args.push({ name: 'query', type: `{ ${props.join('; ')} }`, optional: false, fallback: required ? undefined : '{}' })
  }
  args.push({ name: 'init', type: 'RequestInit', optional: true })
  // an optional argument can't come before a required one, so it takes `undefined` instead
  const signature = args.map((a, i) => {
    if (a.fallback) return `${a.name}: ${a.type} = ${a.fallback}`
    if (!a.optional) return `${a.name}: ${a.type}`
    const laterRequired = args.slice(i + 1).some((b) => !b.optional && !b.fallback)
    return laterRequired ? `${a.name}: ${a.type} | undefined` : `${a.name}?: ${a.type}`
  })

  const path = openApiPath(e.path)
  const url = pathArgs.size
    ? '`' +
      path
        .replace(/[`\\]/g, '\\$&')
        .replace(/\$\{/g, '\\${')
        .replace(/\{(\w+)\}/g, (whole, name: string) => (pathArgs.has(name) ? '${encodeURIComponent(' + pathArgs.get(name) + ')}' : whole)) +
      '`'
    : `'${path.replace(/[\\']/g, '\\$&')}'`
  const options = [...(body ? ['body'] : []), ...(query.length ? ['query'] : []), 'init']
  const call = `apiRequest('${e.method}', ${url}, { ${options.join(', ')} })`

  const ok = successResponse(e)
  let returns: string
  let bodyCode: string
  if (!ok) {
    returns = 'unknown'
    bodyCode = `  return ${call}`
  } else if (!ok.body) {
    returns = 'void'
    bodyCode = `  await ${call}`
  } else {
    track(ok.body)
    returns = tsType(ok.body)
    if (ok.body.kind === 'unknown') bodyCode = `  return ${call}`
    else if (validate) bodyCode = `  const data = await ${call}\n  return ${zodExpr(ok.body)}.parse(data)`
    else bodyCode = `  return (await ${call}) as ${returns}`
  }

  const errors = e.responses
    .filter((r) => !isSuccess(r.status))
    .sort((a, b) => statusOrder(a.status, b.status))
    .map((r) => {
      const what = comment(r.description) || statusText(r.status)
      return `${r.status === 'default' ? 'Any other status' : r.status} ${what}${r.body && r.body.kind !== 'unknown' ? ` (body: ${tsType(r.body)})` : ''}`
    })
  const doc = [
    comment(e.summary) || `${e.method} ${openApiPath(e.path)}`,
    ...(e.description ? ['', ...comment(e.description).split('\n')] : []),
    ...(errors.length ? ['', `Throws ${errorClass} on ${errors.length === 1 ? errors[0] : `\n${errors.map((x) => `- ${x}`).join('\n')}`}`] : []),
  ]
  const docBlock = doc.length === 1 ? `/** ${doc[0]} */` : `/**\n${doc.map((l) => (l ? ` * ${l}` : ' *')).join('\n')}\n */`
  return `${docBlock}\nexport async function ${fn}(${signature.join(', ')}): Promise<${returns}> {\n${bodyCode}\n}`
}

const RESERVED = new Set(['apiRequest', 'BASE_URL', 'z'])

/**
 * A typed fetch client for every endpoint: path params as arguments, query
 * params as an object, a typed request body, and the success response as the
 * return type (checked with Zod when `validate` is on). Error statuses throw
 * an `ApiError` holding the status and the body the API sent back.
 */
export function toContractClient(contract: Contract, options: ClientOptions = {}): string {
  const validate = options.validate ?? true
  const { contract: usable } = usableContract(contract)
  const typeNames = new Set(usable.types.map((t) => t.name))
  const errorClass = typeNames.has('ApiError') ? 'ApiResponseError' : 'ApiError'
  const names = functionNames(usable)
  const used = new Set<string>()
  const track = (s: Shape) => refsOf(s).forEach((n) => used.add(n))

  const fns = usable.endpoints.map((e) => {
    const name = names.get(e.id) as string
    return endpointFunction(e, RESERVED.has(name) || typeNames.has(name) ? `${name}Request` : name, validate, errorClass, track)
  })

  const imports: string[] = []
  const code = fns.join('\n\n')
  if (validate && /\bz\./.test(code)) imports.push(`import { z } from 'zod'`)
  const sorted = [...used].sort()
  if (sorted.length) {
    if (validate) {
      const schemas = sorted.filter((n) => new RegExp(`\\b${schemaName(n)}\\b`).test(code)).map(schemaName)
      imports.push(`import { ${[...schemas, ...sorted.map((n) => `type ${n}`)].join(', ')} } from './schema'`)
    } else imports.push(`import type { ${sorted.join(', ')} } from './types'`)
  }

  const base = usable.baseUrl.trim().replace(/\/+$/, '')
  const header = `${imports.length ? imports.join('\n') + '\n\n' : ''}/** Where the API lives. Every path below is relative to it. */
export const BASE_URL = '${base.replace(/[\\']/g, '\\$&')}'

/** Thrown when the API answers with an error status. \`body\` is what it sent back. */
export class ${errorClass} extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, message: string) {
    super(message)
    this.name = '${errorClass}'
    this.status = status
    this.body = body
  }
}

async function apiRequest(method: string, path: string, options: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit | undefined }): Promise<unknown> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined && v !== null) search.append(key, String(v))
  }
  const qs = search.toString()
  const headers = new Headers(options.init?.headers)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const res = await fetch(\`\${BASE_URL}\${path}\${qs ? \`?\${qs}\` : ''}\`, {
    ...options.init,
    method,
    headers,
    body: options.body === undefined ? null : JSON.stringify(options.body),
  })
  const text = await res.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) throw new ${errorClass}(res.status, data, \`\${method} \${path} failed: \${res.status} \${res.statusText}\`)
  return data
}`
  if (!fns.length) return `${header}\n\n// No endpoints yet.\n`.replace('async function apiRequest', 'export async function apiRequest')
  return `${header}\n\n${code}\n`
}
