/**
 * The API client: requests people save and send to a real API, the
 * environments that fill their `{{variables}}`, and the checks run on what
 * comes back. Sending is the app's job (straight from the page, through the
 * browser extension or through `stacksketch proxy`); everything here is pure.
 */

/** A row of the params, headers, form or variables table. Unticked rows are kept but not sent. */
export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export type RequestAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'apiKey'; name: string; value: string; in: 'header' | 'query' }

export type BodyKind = 'none' | 'json' | 'text' | 'form'

export interface RequestBodyInput {
  kind: BodyKind
  /** the JSON or plain text, as typed */
  text: string
  /** the fields of a `application/x-www-form-urlencoded` body */
  form: KeyValue[]
}

export type AssertionTarget = 'status' | 'time' | 'header' | 'body' | 'contract'
export type AssertionOp = 'equals' | 'notEquals' | 'contains' | 'exists' | 'missing' | 'lessThan' | 'greaterThan' | 'matches'

/**
 * One check on the response: "status equals 200", "body data.id exists",
 * "time less than 500", "header content-type contains json". `contract`
 * checks the status and body against the API contract's endpoint.
 */
export interface Assertion {
  id: string
  target: AssertionTarget
  /** the header name for `header`, a path like `data.items[0].id` for `body` */
  path: string
  op: AssertionOp
  value: string
  enabled: boolean
}

/** After a response comes back, copy a value out of it into an environment variable (a login's token, a created id). */
export interface Capture {
  id: string
  /** where from: `body` with a path, a `header` by name, or the `status` */
  from: 'body' | 'header' | 'status'
  path: string
  variable: string
  enabled: boolean
}

export interface ApiRequest {
  id: string
  name: string
  /** the folder it's listed under, e.g. "Orders"; empty for none */
  folder: string
  method: string
  /** with `{{variables}}`; a query string typed here is moved into `params` by the editor */
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  auth: RequestAuth
  body: RequestBodyInput
  assertions: Assertion[]
  captures: Capture[]
  /** the contract endpoint it was made from, to check responses against */
  endpointId?: string
  /** notes for whoever opens it next */
  description?: string
}

export interface Environment {
  id: string
  name: string
  variables: KeyValue[]
}

/** A request with its variables filled in, ready to hand to whatever sends it. */
export interface BuiltRequest {
  method: string
  url: string
  headers: [string, string][]
  body?: string
  /** `{{names}}` that no environment variable filled */
  missing: string[]
}

/* ---------- the wire format between the app and what sends the request ---------- */

/** What the app asks the extension or `stacksketch proxy` to send. */
export interface SendRequest {
  method: string
  url: string
  headers: [string, string][]
  body?: string
  /** give up after this many milliseconds */
  timeout?: number
}

export type SendResult =
  | {
      ok: true
      status: number
      statusText: string
      headers: [string, string][]
      /** the body as text; binary bodies are summarised instead */
      body: string
      /** milliseconds from sending to the last byte */
      ms: number
      /** body size in bytes */
      size: number
      /** the URL after redirects */
      url: string
    }
  | {
      ok: false
      /** `network` (refused, DNS, TLS), `cors`, `timeout`, `permission` (the extension isn't allowed on that host), `invalid` */
      kind: 'network' | 'cors' | 'timeout' | 'permission' | 'invalid'
      error: string
      /** for `permission`: the origin the extension needs access to */
      origin?: string
    }

export type SuccessfulResult = Extract<SendResult, { ok: true }>
