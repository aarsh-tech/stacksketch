import { formatBytes } from './model'
import type { SendRequest, SendResult } from './types'

/**
 * Send a request with a `fetch` you hand in, and turn whatever happens into a
 * `SendResult`. The page, the extension's service worker and `stacksketch
 * proxy` (Node) all have the standard `fetch`, so they share this.
 */

export type SendContext = 'page' | 'extension' | 'proxy'

/** bodies bigger than this are cut, so a 200 MB download doesn't freeze the app */
const MAX_TEXT = 5 * 1024 * 1024
const BINARY = /^(image|audio|video|font)\/|octet-stream|application\/(pdf|zip|gzip|x-tar|x-7z|vnd\.|msword|protobuf|wasm)/i

export const DEFAULT_TIMEOUT = 30_000

export async function sendWithFetch(fetchFn: typeof fetch, request: SendRequest, context: SendContext): Promise<SendResult> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return { ok: false, kind: 'invalid', error: `${request.url} isn't a URL.` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, kind: 'invalid', error: 'Only http and https URLs can be sent.' }
  const timeout = request.timeout ?? DEFAULT_TIMEOUT
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const started = Date.now()
  try {
    const res = await fetchFn(url.href, {
      method: request.method,
      headers: request.headers,
      body: request.body === undefined || request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
      // never attach the browser's cookies for some other site; send only what the request says
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    })
    const bytes = new Uint8Array(await res.arrayBuffer())
    const ms = Date.now() - started
    const headers: [string, string][] = []
    res.headers.forEach((value, key) => headers.push([key, value]))
    // some runtimes join Set-Cookie into one line; list them one by one where the runtime can
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    if (cookies.length) {
      const at = headers.findIndex(([k]) => k === 'set-cookie')
      const rest = headers.filter(([k]) => k !== 'set-cookie')
      rest.splice(at < 0 ? rest.length : at, 0, ...cookies.map((c): [string, string] => ['set-cookie', c]))
      headers.splice(0, headers.length, ...rest)
    }
    const type = res.headers.get('content-type') ?? ''
    let body: string
    if (BINARY.test(type)) body = `[${formatBytes(bytes.length)} of ${type.split(';')[0]}, not shown]`
    else {
      body = new TextDecoder().decode(bytes.length > MAX_TEXT ? bytes.slice(0, MAX_TEXT) : bytes)
      if (bytes.length > MAX_TEXT) body += `\n\n[cut at ${formatBytes(MAX_TEXT)} of ${formatBytes(bytes.length)}]`
    }
    return { ok: true, status: res.status, statusText: res.statusText, headers, body, ms, size: bytes.length, url: res.url || url.href }
  } catch (e) {
    if (controller.signal.aborted) return { ok: false, kind: 'timeout', error: `No answer after ${Math.round(timeout / 1000)} seconds. Is ${url.host} up, and is the request one it answers quickly?` }
    return failure(e, url, context)
  } finally {
    clearTimeout(timer)
  }
}

function failure(e: unknown, url: URL, context: SendContext): SendResult {
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? ''
  const host = url.host
  if (code === 'ECONNREFUSED') return { ok: false, kind: 'network', error: `Nothing is listening at ${host}. Is the server running, and on that port?` }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { ok: false, kind: 'network', error: `Can't find ${url.hostname}. Check the spelling, or your network.` }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return { ok: false, kind: 'network', error: `${host} closed the connection before answering.` }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
    return { ok: false, kind: 'network', error: `${host}'s certificate isn't trusted (${code}). For a self-signed dev certificate, start the proxy with NODE_EXTRA_CA_CERTS pointing at it.` }
  if (context === 'page')
    // the browser hides why on purpose: it's either the network or CORS
    return {
      ok: false,
      kind: 'cors',
      error: `The browser blocked the request or couldn't reach ${host}. Most often the API doesn't allow this page's origin (CORS). Send it through the Stacksketch extension or stacksketch proxy instead, which aren't limited by CORS.`,
    }
  const message = cause?.message ?? (e instanceof Error ? e.message : String(e))
  return { ok: false, kind: 'network', error: `Couldn't reach ${host}: ${message}` }
}
