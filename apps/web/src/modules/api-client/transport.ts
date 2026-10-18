import { useSyncExternalStore } from 'react'

import { createMockApi, FROM_APP, isFromExtension, sendWithFetch } from '@stacksketch/core'
import type { AppToExtension, Contract, MockApi, SendRequest, SendResult } from '@stacksketch/core'

/**
 * The ways the API client can send a request. A page can only read answers
 * from APIs that allow it (CORS), so there are two ways around that which
 * still keep everything on your machine: the browser extension, and
 * `stacksketch proxy`. The mock answers from the contract, right here.
 */
export type Transport = 'mock' | 'browser' | 'extension' | 'proxy'

export const TRANSPORTS: { value: Transport; label: string; title: string }[] = [
  { value: 'mock', label: 'Mock', title: 'Answer from the API contract, in this tab: no server needed' },
  { value: 'browser', label: 'Browser', title: 'Send straight from this page. Works when the API allows this page (CORS)' },
  { value: 'extension', label: 'Extension', title: 'Send through the Stacksketch extension: no CORS, any host you allow' },
  { value: 'proxy', label: 'Proxy', title: 'Send through stacksketch proxy on your machine: no CORS, any header' },
]

/* ---------- the extension ---------- */

let extension: { version: string } | null = null
let checked = false
const listeners = new Set<() => void>()
const pending = new Map<string, (result: SendResult) => void>()
const grantWaiters = new Set<(origin: string, granted: boolean) => void>()
let nextId = 0

function onWindowMessage(e: MessageEvent) {
  if (e.source !== window || !isFromExtension(e.data)) return
  const m = e.data
  if (m.type === 'ready' || m.type === 'pong') {
    extension = { version: m.version }
    checked = true
    listeners.forEach((l) => l())
  } else if (m.type === 'result') {
    pending.get(m.id)?.(m.result)
    pending.delete(m.id)
  } else if (m.type === 'granted') grantWaiters.forEach((w) => w(m.origin, m.granted))
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', onWindowMessage)
  ask({ type: 'ping' })
  // no answer soon after load: it isn't installed (or this page isn't one it runs on)
  setTimeout(() => {
    checked = true
    listeners.forEach((l) => l())
  }, 800)
}

function ask(message: { type: 'ping' } | { type: 'send'; request: SendRequest } | { type: 'grant'; origin: string }): string {
  const id = `r${++nextId}`
  window.postMessage({ source: FROM_APP, id, ...message } as AppToExtension, location.origin)
  return id
}

/** Whether the extension's bridge answered: `null` while it's still being checked. */
export function useExtension(): { version: string } | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (extension ? extension : checked ? null : undefined),
  )
}

export function recheckExtension() {
  ask({ type: 'ping' })
}

function sendThroughExtension(request: SendRequest): Promise<SendResult> {
  if (!extension)
    return Promise.resolve({
      ok: false,
      kind: 'network',
      error: 'The Stacksketch extension isn’t answering on this page. Install it (see “How to send without CORS”), turn it on for this site from its panel, then reload this page.',
    })
  return new Promise((resolve) => {
    const id = ask({ type: 'send', request })
    pending.set(id, resolve)
    // the service worker gives up first; this only catches an extension that went away
    setTimeout(
      () => {
        if (pending.delete(id)) resolve({ ok: false, kind: 'timeout', error: 'The extension didn’t answer. Reload this page; if it keeps happening, reload the extension in chrome://extensions.' })
      },
      (request.timeout ?? 30_000) + 5000,
    )
  })
}

/** Open the extension's prompt to allow requests to `origin`. Resolves with the answer. */
export function grantThroughExtension(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const waiter = (o: string, granted: boolean) => {
      if (o !== origin) return
      grantWaiters.delete(waiter)
      resolve(granted)
    }
    grantWaiters.add(waiter)
    ask({ type: 'grant', origin })
  })
}

/* ---------- the proxy ---------- */

export const proxyOrigin = (port: number) => `http://localhost:${port}`

async function sendThroughProxy(request: SendRequest, port: number): Promise<SendResult> {
  let res: Response
  try {
    res = await fetch(`${proxyOrigin(port)}/__stacksketch/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  } catch {
    return {
      ok: false,
      kind: 'network',
      error: `stacksketch proxy isn’t running at localhost:${port}. Start it with “node packages/cli/dist/cli.js proxy” (or npx stacksketch proxy), or change the port in the API client’s settings.`,
    }
  }
  if (res.status === 403)
    return { ok: false, kind: 'network', error: `stacksketch proxy refused this page. Start it with --allow-origin ${location.origin} so it accepts requests from here.` }
  try {
    return (await res.json()) as SendResult
  } catch {
    return { ok: false, kind: 'network', error: `Something else is answering at localhost:${port}; it isn’t stacksketch proxy. Pick another port.` }
  }
}

/** Is the proxy up? */
export async function pingProxy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`${proxyOrigin(port)}/__stacksketch/ping`, { cache: 'no-store' })
    return res.ok && ((await res.json()) as { name?: string }).name === 'stacksketch-proxy'
  } catch {
    return false
  }
}

/* ---------- the mock ---------- */

// one fake API per contract. It answers strictly from the contract (no CRUD), so its responses
// are what the contract promises; the Mock API server page is where POST-then-GET lives
let mock: { contract: Contract; api: MockApi } | null = null

export function resetMock() {
  mock = null
}

async function sendToMock(request: SendRequest, contract: Contract): Promise<SendResult> {
  if (mock?.contract !== contract) mock = { contract, api: createMockApi(contract, { crud: false }) }
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { ok: false, kind: 'invalid', error: `${request.url} isn't a URL.` }
  }
  let body: unknown
  if (request.body !== undefined && request.body.trim()) {
    try {
      body = JSON.parse(request.body)
    } catch {
      body = request.body
    }
  }
  const started = performance.now()
  const r = mock.api.handle({ method: request.method, url: url.pathname + url.search, body, headers: Object.fromEntries(request.headers.map(([k, v]) => [k.toLowerCase(), v])) })
  await new Promise((wait) => setTimeout(wait, Math.min(r.delay, 15_000)))
  const text = r.body === undefined ? '' : JSON.stringify(r.body, null, 2)
  return {
    ok: true,
    status: r.status,
    statusText: '',
    headers: Object.entries(r.headers).map(([k, v]): [string, string] => [k.toLowerCase(), v]),
    body: text,
    ms: Math.round(performance.now() - started),
    size: new TextEncoder().encode(text).length,
    url: url.href,
  }
}

/* ---------- all together ---------- */

export function send(transport: Transport, request: SendRequest, options: { contract: Contract; proxyPort: number }): Promise<SendResult> {
  if (transport === 'mock') return sendToMock(request, options.contract)
  if (transport === 'extension') return sendThroughExtension(request)
  if (transport === 'proxy') return sendThroughProxy(request, options.proxyPort)
  return sendWithFetch(fetch, request, 'page')
}
