import { readFileSync, watch } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { basename, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { createMockApi, readContractFile } from '@stacksketch/core'
import type { MockApi, MockServerOptions } from '@stacksketch/core'
import { PROXY_HELP, parseProxyArgs, startProxy } from './proxy'

const HELP = `Stacksketch: a mock API from your contract, and a proxy for the workbench's API client.

Usage
  stacksketch mock <file> [options]
  stacksketch proxy [options]       (stacksketch proxy --help for its options)

<file> is a contract exported from the workbench (contract.json) or an
OpenAPI 3.0 / 3.1 file (JSON or YAML).

Options
  --port <n>      port to listen on (default 4010)
  --host <name>   address to listen on (default localhost; 0.0.0.0 for your network)
  --delay <ms>    wait before every response (default 0)
  --seed <n>      change the fake data (default 1)
  --base <path>   serve under this path instead of the base URL's, e.g. /api
  --no-crud       don't remember what POST, PUT, PATCH and DELETE change
  --help          show this

While it runs, add ?__status=500 or ?__delay=2000 to any request (or send
x-mock-status / x-mock-delay headers) to try error and loading states.
The file is watched: save it and the server reloads.

stacksketch proxy sends the workbench's API client requests from your
machine, so APIs without CORS and any header work.`

const c = process.stdout.isTTY ? (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m` : () => (s: string) => s
const dim = c(2)
const bold = c(1)
const green = c(32)
const yellow = c(33)
const red = c(31)
const cyan = c(36)

function fail(message: string): never {
  console.error(red(message))
  process.exit(1)
}

interface Args {
  file: string
  port: number
  host: string
  options: MockServerOptions
}

function parseArgs(argv: string[]): Args {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }
  const [command, ...rest] = argv
  if (command !== 'mock') fail(`Unknown command "${command}". Run stacksketch mock <file>, stacksketch proxy, or stacksketch --help.`)
  let file = ''
  let port = 4010
  let host = 'localhost'
  const options: MockServerOptions = {}
  const number = (flag: string, value: string | undefined) => {
    const n = Number(value)
    if (value === undefined || !Number.isFinite(n) || n < 0) fail(`${flag} needs a number, like ${flag} 300.`)
    return n
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--port') port = number(a, rest[++i])
    else if (a === '--host') host = rest[++i] ?? fail('--host needs a name, like --host 0.0.0.0.')
    else if (a === '--delay') options.delay = number(a, rest[++i])
    else if (a === '--seed') options.seed = number(a, rest[++i])
    else if (a === '--base') options.basePath = rest[++i] ?? fail('--base needs a path, like --base /api.')
    else if (a === '--no-crud') options.crud = false
    else if (a.startsWith('-')) fail(`Unknown option ${a}. Run stacksketch --help to see them.`)
    else if (!file) file = a
    else fail(`One file at a time: got ${file} and ${a}.`)
  }
  if (!file) fail('Which contract? Run stacksketch mock contract.json (export it from the API contract in the workbench), or pass an OpenAPI file.')
  return { file: resolve(file), port, host, options }
}

function load(file: string, options: MockServerOptions): { api: MockApi; title: string } {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Can't read ${file}. Check the path.`)
  }
  let value: unknown
  try {
    value = /\.json$/i.test(file) || text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text)
  } catch (e) {
    throw new Error(`${basename(file)} isn't valid ${/\.ya?ml$/i.test(file) ? 'YAML' : 'JSON'}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const { contract, warnings } = readContractFile(value)
  for (const w of warnings) console.log(yellow(`  ! ${w}`))
  return { api: createMockApi(contract, options), title: contract.title }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, failed) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
    req.on('error', failed)
  })
}

const statusColour = (s: number) => (s >= 500 ? red : s >= 400 ? yellow : green)

function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === 'proxy') {
    if (argv.includes('--help') || argv.includes('-h')) {
      console.log(PROXY_HELP)
      return
    }
    startProxy(parseProxyArgs(argv.slice(1), fail), { line: (s) => console.log(s), error: fail, dim, cyan, bold, status: (n) => statusColour(n)(String(n)) })
    return
  }
  const args = parseArgs(argv)
  let current: { api: MockApi; title: string }
  try {
    current = load(args.file, args.options)
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }

  const server = createServer(async (req, res) => {
    const started = Date.now()
    const text = await readBody(req)
    let body: unknown
    if (text.trim()) {
      try {
        body = JSON.parse(text)
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify({ message: 'The request body isn’t valid JSON.' }))
        return
      }
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]))
    const r = current.api.handle({ method: req.method ?? 'GET', url: req.url ?? '/', body, headers })
    if (r.delay) await new Promise((wait) => setTimeout(wait, r.delay))
    res.writeHead(r.status, r.headers)
    res.end(r.body === undefined ? undefined : JSON.stringify(r.body, null, 2))
    if (req.method !== 'OPTIONS') console.log(`${statusColour(r.status)(String(r.status))} ${req.method} ${req.url} ${dim(`${Date.now() - started}ms`)}`)
  })

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') fail(`Port ${args.port} is in use. Pick another with --port 4011.`)
    fail(e.message)
  })

  server.listen(args.port, args.host, () => {
    const origin = `http://${args.host === '0.0.0.0' ? 'localhost' : args.host}:${args.port}`
    console.log(`\n${bold(current.title)} ${dim('mock API')} at ${cyan(origin)}\n`)
    for (const r of current.api.routes) console.log(`  ${r.method.padEnd(6)} ${origin}${r.path}  ${dim(r.summary)}`)
    console.log(dim(`\n  ?__status=500 or ?__delay=2000 on any request tries an error or a slow response. Ctrl+C stops it.\n`))
  })

  // reload when the file is saved
  let timer: NodeJS.Timeout | undefined
  watch(args.file, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        current = load(args.file, args.options)
        console.log(green(`Reloaded ${basename(args.file)}: ${current.api.routes.length} endpoints.`))
      } catch (e) {
        console.log(red(`Kept the last version: ${e instanceof Error ? e.message : String(e)}`))
      }
    }, 100)
  })
}

main()
