import { jsonSchemaNode, objectJsonSchema } from '../generate/jsonSchema'
import type { Json } from '../generate/jsonSchema'
import { functionNames, hasRequestBody, openApiPath, resourceGroups, statusOrder, statusText, syncPathParams, usableContract } from '../contract/model'
import type { Contract, ContractEndpoint } from '../contract/types'

const REF = '#/components/schemas/'
const json = (schema: Json) => ({ 'application/json': { schema } })

function operation(e: ContractEndpoint, operationId: string): Json {
  const synced = syncPathParams(e)
  const parameters = synced.params.map((p) => ({
    name: p.name,
    in: p.in,
    ...(p.description ? { description: p.description } : {}),
    required: p.in === 'path' ? true : p.required,
    schema: jsonSchemaNode(p.shape, REF),
  }))
  const responses = Object.fromEntries(
    [...e.responses]
      .sort((a, b) => statusOrder(a.status, b.status))
      .map((r) => [String(r.status), { description: r.description.trim() || statusText(r.status), ...(r.body ? { content: json(jsonSchemaNode(r.body, REF)) } : {}) }]),
  )
  return {
    ...(e.resource.trim() ? { tags: [e.resource.trim()] } : {}),
    ...(e.summary.trim() ? { summary: e.summary.trim() } : {}),
    ...(e.description?.trim() ? { description: e.description.trim() } : {}),
    operationId,
    ...(parameters.length ? { parameters } : {}),
    ...(e.body && hasRequestBody(e.method) ? { requestBody: { required: e.body.required, content: json(jsonSchemaNode(e.body.shape, REF)) } } : {}),
    responses: Object.keys(responses).length ? responses : { default: { description: statusText('default') } },
  }
}

/**
 * The contract as an OpenAPI 3.1 document (a plain object: `JSON.stringify`
 * it or pass it to `toYaml`). Endpoints with problems are left out, the same
 * as in the generated code.
 */
export function toOpenApi(contract: Contract): Json {
  const { contract: c } = usableContract(contract)
  const names = functionNames(c)
  const paths: Record<string, Record<string, Json>> = {}
  for (const e of c.endpoints) {
    const path = openApiPath(e.path)
    paths[path] = { ...paths[path], [e.method.toLowerCase()]: operation(e, names.get(e.id) as string) }
  }
  const tags = resourceGroups(c)
    .map((g) => g.name)
    .filter((name) => c.endpoints.some((e) => e.resource.trim() === name))
  return {
    openapi: '3.1.0',
    info: { title: c.title.trim() || 'API', version: c.apiVersion.trim() || '1.0.0', ...(c.description?.trim() ? { description: c.description.trim() } : {}) },
    ...(c.baseUrl.trim() ? { servers: [{ url: c.baseUrl.trim() }] } : {}),
    ...(tags.length ? { tags: tags.map((name) => ({ name })) } : {}),
    paths,
    ...(c.types.length ? { components: { schemas: Object.fromEntries(c.types.map((t) => [t.name, objectJsonSchema(t, REF)])) } } : {}),
  }
}
