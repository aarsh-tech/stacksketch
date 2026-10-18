/**
 * Reading requests people copy out of their tools. Nothing here sends a
 * request: a cURL command tells us the method and URL, and a HAR file
 * already contains the responses.
 */

export interface CurlRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

/** Split a shell command into words, the way bash would (quotes, escapes, line continuations). */
function shellWords(input: string): string[] {
  let cmd = input.trim()
  // "Copy as cURL (cmd)" escapes with ^; PowerShell continues lines with a backtick
  if (/\^"/.test(cmd)) cmd = cmd.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1')
  cmd = cmd.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ')
  const words: string[] = []
  let word: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (/\s/.test(c)) {
      if (word !== null) words.push(word)
      word = null
      continue
    }
    word ??= ''
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1)
      word += cmd.slice(i + 1, end < 0 ? undefined : end)
      i = end < 0 ? cmd.length : end
    } else if (c === '$' && cmd[i + 1] === "'") {
      // $'…' with backslash escapes, as Chrome writes bodies that contain quotes
      i += 2
      while (i < cmd.length && cmd[i] !== "'") {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          const n = cmd[++i]
          word += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n
        } else word += cmd[i]
        i++
      }
    } else if (c === '"') {
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && /["\\$`]/.test(cmd[i + 1] ?? '')) i++
        word += cmd[i]
        i++
      }
    } else if (c === '\\' && i + 1 < cmd.length) {
      word += cmd[++i]
    } else word += c
  }
  if (word !== null) words.push(word)
  return words
}

const DATA = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json'])
/** options that take a value we don't need */
const SKIP = new Set(['-o', '--output', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-u', '--user', '-x', '--proxy', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-F', '--form', '--cert', '--key', '--cacert', '-r', '--range'])

/** Read the method, URL, headers and body from a cURL command. Throws with a plain message when it isn't one. */
export function parseCurl(command: string): CurlRequest {
  const words = shellWords(command)
  if (words[0] !== 'curl' && words[0] !== 'curl.exe') throw new Error('That doesn’t look like a cURL command. It should start with “curl”.')
  let method: string | undefined
  let url: string | undefined
  let body: string | undefined
  let get = false
  let form = false
  const headers: Record<string, string> = {}
  for (let i = 1; i < words.length; i++) {
    const w = words[i]
    const value = () => words[++i] ?? ''
    if (w === '-X' || w === '--request') method = value().toUpperCase()
    else if (/^-X[A-Za-z]+$/.test(w)) method = w.slice(2).toUpperCase()
    else if (w === '-H' || w === '--header') {
      const h = value()
      const at = h.indexOf(':')
      if (at > 0) headers[h.slice(0, at).trim().toLowerCase()] = h.slice(at + 1).trim()
    } else if (DATA.has(w)) {
      const d = value()
      body = body === undefined ? d : `${body}&${d}`
      if (w === '--json') headers['content-type'] ??= 'application/json'
    } else if (w === '-G' || w === '--get') get = true
    else if (w === '-I' || w === '--head') method = 'HEAD'
    else if (w === '--url') url = value()
    else if (w === '-F' || w === '--form') {
      form = true
      value()
    } else if (SKIP.has(w)) value()
    else if (!w.startsWith('-') && url === undefined) url = w
  }
  if (!url) throw new Error('The cURL command has no URL in it.')
  return { method: method ?? (get ? 'GET' : body !== undefined || form ? 'POST' : 'GET'), url, headers, ...(body !== undefined && !get ? { body } : {}) }
}

export interface HarEntry {
  method: string
  url: string
  status: number
  mimeType: string
  /** the response body, decoded; missing when the HAR was saved without content */
  text?: string
  /** the body parses as JSON */
  json: boolean
}

function decodeBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

interface RawHar {
  log?: { entries?: { request?: { method?: string; url?: string }; response?: { status?: number; content?: { mimeType?: string; text?: string; encoding?: string } } }[] }
}

/** Every request in a HAR file (DevTools → Network → "Save all as HAR"), with its response body. */
export function parseHar(text: string): HarEntry[] {
  let har: RawHar
  try {
    har = JSON.parse(text) as RawHar
  } catch {
    throw new Error('That file isn’t valid JSON, so it can’t be a HAR file.')
  }
  const entries = har.log?.entries
  if (!Array.isArray(entries)) throw new Error('That JSON isn’t a HAR file: it has no log.entries. In DevTools, use Network → “Save all as HAR with content”.')
  return entries.map((e) => {
    const content = e.response?.content ?? {}
    let body: string | undefined = content.text
    if (body !== undefined && content.encoding === 'base64') {
      try {
        body = decodeBase64(body)
      } catch {
        body = undefined
      }
    }
    let json = false
    if (body !== undefined && body.trim()) {
      try {
        const v: unknown = JSON.parse(body)
        json = typeof v === 'object' && v !== null
      } catch {
        json = false
      }
    }
    return { method: (e.request?.method ?? 'GET').toUpperCase(), url: e.request?.url ?? '', status: e.response?.status ?? 0, mimeType: content.mimeType ?? '', text: body, json }
  })
}
