/// <reference types="node" />
import { describe, expect, it } from 'vitest'

import { parseCurl, parseHar } from './index'

describe('parseCurl', () => {
  it('reads a "Copy as cURL (bash)" command from Chrome', () => {
    const cmd = `curl 'https://api.example.in/v1/stores/42/orders?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc' \\
  --compressed`
    expect(parseCurl(cmd)).toEqual({
      method: 'GET',
      url: 'https://api.example.in/v1/stores/42/orders?page=2',
      headers: { accept: 'application/json', authorization: 'Bearer abc' },
    })
  })

  it('treats a body as POST unless a method is given', () => {
    expect(parseCurl(`curl https://x.in/orders --data-raw '{"qty":2}'`)).toMatchObject({ method: 'POST', body: '{"qty":2}' })
    expect(parseCurl(`curl -X PATCH "https://x.in/orders/7" -d "{\\"qty\\":3}"`)).toMatchObject({ method: 'PATCH', url: 'https://x.in/orders/7', body: '{"qty":3}' })
    expect(parseCurl(`curl -XDELETE https://x.in/orders/7`).method).toBe('DELETE')
    expect(parseCurl(`curl --json '{"a":1}' https://x.in/a`)).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(parseCurl(`curl -G https://x.in/search -d q=lamp`)).toEqual({ method: 'GET', url: 'https://x.in/search', headers: {} })
  })

  it('reads Windows cmd escapes and $-quoted bodies', () => {
    const cmd = 'curl ^"https://x.in/a^" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"'
    expect(parseCurl(cmd)).toMatchObject({ url: 'https://x.in/a', headers: { accept: '*/*' }, method: 'POST' })
    expect(parseCurl(`curl 'https://x.in' --data-raw $'{"note":"it\\'s"}'`).body).toBe(`{"note":"it's"}`)
  })

  it('says what is wrong with things that are not cURL commands', () => {
    expect(() => parseCurl('wget https://x.in')).toThrow(/start with “curl”/)
    expect(() => parseCurl('curl -H "a: b"')).toThrow(/no URL/)
  })
})

describe('parseHar', () => {
  const har = {
    log: {
      entries: [
        { request: { method: 'GET', url: 'https://x.in/orders' }, response: { status: 200, content: { mimeType: 'application/json', text: '{"orders":[]}' } } },
        { request: { method: 'GET', url: 'https://x.in/logo.png' }, response: { status: 200, content: { mimeType: 'image/png', text: 'iVBORw0', encoding: 'base64' } } },
        {
          request: { method: 'post', url: 'https://x.in/orders' },
          response: { status: 201, content: { mimeType: 'application/json', text: Buffer.from('{"id":"ü1"}').toString('base64'), encoding: 'base64' } },
        },
        { request: { method: 'GET', url: 'https://x.in/empty' }, response: { status: 204, content: { mimeType: 'application/json' } } },
      ],
    },
  }

  it('lists requests with decoded bodies and flags the JSON ones', () => {
    const entries = parseHar(JSON.stringify(har))
    expect(entries.map((e) => [e.method, e.status, e.json])).toEqual([
      ['GET', 200, true],
      ['GET', 200, false],
      ['POST', 201, true],
      ['GET', 204, false],
    ])
    expect(entries[2].text).toBe('{"id":"ü1"}')
    expect(entries[3].text).toBeUndefined()
  })

  it('explains files that are not HAR', () => {
    expect(() => parseHar('nope')).toThrow(/isn’t valid JSON/)
    expect(() => parseHar('{"a":1}')).toThrow(/no log.entries/)
  })
})
