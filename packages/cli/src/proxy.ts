import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendWithFetch } from '@stacksketch/core'
import type { SendRequest } from '@stacksketch/core'

/**
 * `stacksketch proxy`: sends the workbench's API client requests from Node,
 * so CORS doesn't apply and any header can be set. It only answers pages
 * from the origins it allows (the workbench on localhost by default), so a
 * website you visit can't use it to reach your machine or network.
 */

export const PROXY_HELP = `Stacksketch proxy: send the workbench's API requests from your machine.

Usage
  stacksketch proxy [options]

The workbench's API client sends through it when you pick "Proxy". Requests
go out from Node, so the API doesn't need CORS and every header is allowed.

Options
  --port <n>              port to listen on (default 4011)
  --allow-origin <url>    let this workbench use it too, e.g. https://stacksketch.netlify.app
                          (repeat for more; https://stacksketch.netlify.app and
                          http://localhost:5174 and :4174 are always allowed)
  --help                  show this`

/** the hosted workbench, and the workbench at pnpm dev and pnpm preview */
const DEFAULT_ORIGINS = ['https://stacksketch.netlify.app', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:4174', 'http://127.0.0.1:4174']
const MAX_BODY = 20 * 1024 * 1024

interface ProxyArgs {
  port: number
  origins: string[]
}

export function parseProxyArgs(argv: string[], fail: (message: string) => never): ProxyArgs {
  let port = 4011
  const origins = [...DEFAULT_ORIGINS]
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) fail('--port needs a number, like --port 4011.')
      port = n
    } else if (a === '--allow-origin') {
      const value = argv[++i]
      let origin: string
      try {
        origin = new URL(value ?? '').origin
      } catch {
        fail('--allow-origin needs the workbench’s address, like --allow-origin https://stacksketch.netlify.app.')
      }
      if (origin === 'null') fail(`${value} has no origin; use an http or https address.`)
      origins.push(origin)
    } else fail(`Unknown option ${a}. Run stacksketch proxy --help to see them.`)
  }
  return { port, origins }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, failed) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        failed(new Error('too big'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    req.on('error', failed)
  })
}

function isSendRequest(v: unknown): v is SendRequest {
  const r = v as SendRequest
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.method === 'string' &&
    typeof r.url === 'string' &&
    Array.isArray(r.headers) &&
    r.headers.every((h) => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string') &&
    (r.body === undefined || typeof r.body === 'string')
  )
}

export function startProxy(args: ProxyArgs, log: { line: (s: string) => void; error: (s: string) => never; dim: (s: string) => string; cyan: (s: string) => string; bold: (s: string) => string; status: (n: number) => string }) {
  const allowed = new Set(args.origins)

  const json = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    })
    res.end(JSON.stringify(body))
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    // a page from anywhere else gets nothing, not even a hint of what this is
    if (origin && !allowed.has(origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`stacksketch proxy doesn't accept requests from ${origin}. Start it with --allow-origin ${origin} if that's your workbench.`)
      log.line(`${log.status(403)} refused a request from ${origin} ${log.dim('(not allowed; see --allow-origin)')}`)
      return
    }
    const path = (req.url ?? '/').split('?')[0]
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
        'Access-Control-Allow-Methods': 'GET, POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        // Chrome asks before a public page talks to localhost
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      })
      res.end()
      return
    }
    if (req.method === 'GET' && path === '/__stacksketch/ping') {
      json(res, 200, { ok: true, name: 'stacksketch-proxy' }, origin)
      return
    }
    if (req.method !== 'POST' || path !== '/__stacksketch/send') {
      json(res, 404, { message: 'stacksketch proxy only answers POST /__stacksketch/send, from the workbench’s API client.' }, origin)
      return
    }
    let request: unknown
    try {
      request = JSON.parse(await readBody(req))
    } catch {
      json(res, 400, { ok: false, kind: 'invalid', error: 'The proxy got a request it couldn’t read (or one over 20 MB).' }, origin)
      return
    }
    if (!isSendRequest(request)) {
      json(res, 400, { ok: false, kind: 'invalid', error: 'The proxy got a request without a method, URL and headers.' }, origin)
      return
    }
    const result = await sendWithFetch(fetch, request, 'proxy')
    json(res, 200, result, origin)
    log.line(`${result.ok ? log.status(result.status) : log.status(599)} ${request.method} ${request.url} ${log.dim(result.ok ? `${result.ms}ms` : result.error)}`)
  })

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') log.error(`Port ${args.port} is in use. Pick another with --port 4012, and set the same port in the API client.`)
    log.error(e.message)
  })

  // localhost only: the proxy reaches whatever this machine can, so nothing else on the network may use it
  server.listen(args.port, '127.0.0.1', () => {
    log.line(`\n${log.bold('Stacksketch proxy')} at ${log.cyan(`http://localhost:${args.port}`)}\n`)
    log.line(`  Answers the workbench at ${args.origins.map((o) => log.cyan(o)).join(', ')}`)
    log.line(log.dim(`  In the API client, pick Proxy as the way to send. Ctrl+C stops it.\n`))
  })
}
