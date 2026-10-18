import { describe, expect, it } from 'vitest'

import { emptyContract, flowSequence, newEndpoint, toMermaid, toSequenceSvg } from './index'
import type { Contract, Flow } from './index'

const contract: Contract = {
  ...emptyContract(),
  types: [
    { name: 'Login', fields: [{ key: 'email', shape: { kind: 'string', format: 'email' }, optional: false }] },
    { name: 'Session', fields: [{ key: 'token', shape: { kind: 'string' }, optional: false }] },
    { name: 'Profile', fields: [{ key: 'name', shape: { kind: 'string' }, optional: false }] },
    { name: 'Problem', fields: [{ key: 'message', shape: { kind: 'string' }, optional: false }] },
  ],
  endpoints: [
    {
      ...newEndpoint('login', 'POST', '/auth/login', 'Auth'),
      body: { shape: { kind: 'ref', name: 'Login' }, required: true },
      responses: [
        { status: 200, description: 'Signed in', body: { kind: 'ref', name: 'Session' } },
        { status: 401, description: 'Wrong email or password', body: { kind: 'ref', name: 'Problem' } },
      ],
    },
    { ...newEndpoint('refresh', 'POST', '/auth/refresh', 'Auth'), responses: [{ status: 200, description: '', body: { kind: 'ref', name: 'Session' } }] },
    {
      ...newEndpoint('me', 'GET', '/me', 'Profile'),
      params: [{ name: 'fields', in: 'query', shape: { kind: 'string' }, required: false }],
      responses: [{ status: 200, description: '', body: { kind: 'ref', name: 'Profile' } }],
    },
  ],
}

const flow: Flow = {
  id: 'f',
  name: 'Sign in & load the profile',
  steps: [
    { id: 's1', endpointId: 'login', note: 'Keep the token; send it as a Bearer header' },
    { id: 's2', endpointId: 'refresh' },
    { id: 's3', endpointId: 'me' },
    { id: 's4', endpointId: 'login', status: 401 },
  ],
}

describe('flows', () => {
  it('turns steps into requests and responses between the client and each resource', () => {
    const seq = flowSequence(flow, contract)
    expect(seq.participants).toEqual(['Client', 'Auth', 'Profile'])
    expect(seq.messages.map((m) => `${m.kind} ${m.from}→${m.to} ${m.text}`)).toEqual([
      'request 0→1 POST /auth/login · Login',
      'response 1→0 200 Session',
      'note 0→1 Keep the token; send it as a Bearer header',
      'request 0→1 POST /auth/refresh',
      'response 1→0 200 Session',
      'request 0→2 GET /me?fields',
      'response 2→0 200 Profile',
      'request 0→1 POST /auth/login · Login',
      'response 1→0 401 Problem',
    ])
    expect(seq.problems).toEqual([])
  })

  it('points out steps that no longer fit the contract', () => {
    const broken = { ...flow, steps: [{ id: 'x', endpointId: 'gone' }, { id: 'y', endpointId: 'me', status: 404 }] }
    expect(flowSequence(broken, contract).problems).toEqual(['Step 1 uses an endpoint that isn’t in the contract any more. Pick another one.', 'Step 2: GET /me has no 404 response.'])
  })

  it('writes Mermaid, escaping what Mermaid reads itself', () => {
    const mermaid = toMermaid(flow, contract)
    expect(mermaid).toContain('sequenceDiagram\n  title Sign in & load the profile\n  autonumber\n  actor Client\n  participant P1 as Auth\n  participant P2 as Profile')
    expect(mermaid).toContain('  Client->>P1: POST /auth/login · Login')
    expect(mermaid).toContain('  P1-->>Client: 401 Problem')
    expect(mermaid).toContain('  Note over Client,P1: Keep the token#59; send it as a Bearer header')
  })

  it('draws an SVG with escaped text, error responses in their own colour', () => {
    const svg = toSequenceSvg(flow, contract)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('Sign in &amp; load the profile')
    expect(svg).toContain('>1. POST /auth/login · Login</text>')
    expect(svg).toContain('fill="#b3412f">401 Problem</text>')
    // every element closes
    const opened = (svg.match(/<(rect|text|line|path|svg)\b/g) ?? []).length
    const closed = (svg.match(/<\/(text|svg)>|\/>/g) ?? []).length
    expect(closed).toBe(opened)
  })
})
