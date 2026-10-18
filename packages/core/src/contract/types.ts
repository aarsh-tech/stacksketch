import type { HttpMethod } from '../generate/fetch'
import type { ObjectType, Shape } from '../types'

/**
 * An API contract: the endpoints both sides agree on. Bodies, params and
 * responses are shared-schema shapes, and the object types they point at live
 * once in `types`, so endpoints reuse them the way a schema's fields do.
 */

export type ParamIn = 'path' | 'query'

export interface ContractParam {
  name: string
  in: ParamIn
  /** a string (with or without a format), number, boolean or enum; query params can be lists of those */
  shape: Shape
  /** path params are always required */
  required: boolean
  description?: string
}

/** A status code, or `default` for "any other status" (usually the error shape). */
export type ResponseStatus = number | 'default'

export interface ContractResponse {
  status: ResponseStatus
  description: string
  /** the JSON body; none for 204 and other empty responses */
  body?: Shape
}

export interface RequestBody {
  shape: Shape
  required: boolean
}

export interface ContractEndpoint {
  id: string
  method: HttpMethod
  /** relative to the contract's base URL: `/orders/{orderId}` (`:orderId` works too) */
  path: string
  /** one line, e.g. "Place an order" */
  summary: string
  description?: string
  /** what it acts on, e.g. "Orders": endpoints are grouped by it, and it's the OpenAPI tag */
  resource: string
  /** the generated function's name; made from the method and path when empty */
  operationId?: string
  /** query params, and a type for each path param (the path decides which path params exist) */
  params: ContractParam[]
  /** the JSON request body, for POST, PUT and PATCH */
  body?: RequestBody
  responses: ContractResponse[]
  /** how the mock server answers it; optional, so v1 contracts without it still load */
  mock?: EndpointMock
}

export interface EndpointMock {
  /** wait this long before answering, in milliseconds */
  delay?: number
  /** answer with this status instead of the success response, to build error states */
  status?: ResponseStatus
}

export interface Contract {
  version: 1
  title: string
  /** the API's own version (OpenAPI's `info.version`) */
  apiVersion: string
  /** where the API lives, e.g. `https://api.example.com/v1`; paths are relative to it */
  baseUrl: string
  description?: string
  /** the object types bodies point at, never inlined (like `Schema.types`) */
  types: ObjectType[]
  endpoints: ContractEndpoint[]
}
