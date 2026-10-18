import { isSuccess, openApiPath, statusText, successResponse } from '../contract/model'
import { shapeLabel } from '../contract/shapes'
import type { Contract, ContractEndpoint, ResponseStatus } from '../contract/types'
import type { Shape } from '../types'

/**
 * API flows: a sequence of contract endpoints (log in → refresh the token →
 * fetch the profile) drawn as a sequence diagram, with what each step sends
 * and gets back. Exported as Mermaid or SVG.
 */

export interface FlowStep {
  id: string
  endpointId: string
  /** the response this step shows; the endpoint's success response when not set */
  status?: ResponseStatus
  /** a note beside the step: "keep the token for the next calls" */
  note?: string
}

export interface Flow {
  id: string
  name: string
  description?: string
  steps: FlowStep[]
}

export interface SequenceMessage {
  kind: 'request' | 'response' | 'note'
  from: number
  to: number
  text: string
  /** the step it belongs to, from 0 */
  step: number
}

export interface Sequence {
  /** `Client` first, then each resource the flow calls, in order */
  participants: string[]
  messages: SequenceMessage[]
  problems: string[]
}

const label = (s: Shape | undefined) => (s && s.kind !== 'unknown' ? shapeLabel(s) : '')

/** What a request sends, in a few words: path params, query params and the body type. */
export function requestText(e: ContractEndpoint): string {
  const query = e.params.filter((p) => p.in === 'query').map((p) => p.name)
  const body = e.body ? label(e.body.shape) : ''
  return `${e.method} ${openApiPath(e.path)}${query.length ? `?${query.join('&')}` : ''}${body ? ` · ${body}` : ''}`
}

/** What comes back: `200 Session`, `204 No content`, `404 Problem`. */
export function responseText(e: ContractEndpoint, status?: ResponseStatus): string {
  const r = status === undefined ? successResponse(e) : e.responses.find((x) => x.status === status)
  const code = status ?? r?.status ?? 200
  const body = label(r?.body)
  return `${code === 'default' ? 'Error' : code} ${body || r?.description || statusText(code)}`
}

export function flowSequence(flow: Flow, contract: Contract): Sequence {
  const participants = ['Client']
  const messages: SequenceMessage[] = []
  const problems: string[] = []
  flow.steps.forEach((step, i) => {
    const e = contract.endpoints.find((x) => x.id === step.endpointId)
    if (!e) {
      problems.push(`Step ${i + 1} uses an endpoint that isn’t in the contract any more. Pick another one.`)
      return
    }
    const who = e.resource.trim() || 'API'
    let at = participants.indexOf(who)
    if (at < 0) at = participants.push(who) - 1
    if (step.status !== undefined && !e.responses.some((r) => r.status === step.status)) problems.push(`Step ${i + 1}: ${e.method} ${openApiPath(e.path)} has no ${step.status} response.`)
    messages.push({ kind: 'request', from: 0, to: at, text: requestText(e), step: i })
    messages.push({ kind: 'response', from: at, to: 0, text: responseText(e, step.status), step: i })
    if (step.note?.trim()) messages.push({ kind: 'note', from: 0, to: at, text: step.note.trim(), step: i })
  })
  return { participants, messages, problems }
}

/* ---------- Mermaid ---------- */

/** Mermaid reads `;` and `#` itself, so they go in as entity codes. */
const mm = (s: string) => s.replace(/#/g, '#35;').replace(/;/g, '#59;').replace(/\n/g, ' ')

/** The flow as a Mermaid sequence diagram, for docs and pull requests. */
export function toMermaid(flow: Flow, contract: Contract): string {
  const { participants, messages } = flowSequence(flow, contract)
  const id = (i: number) => (i === 0 ? 'Client' : `P${i}`)
  const lines = ['sequenceDiagram', `  title ${mm(flow.name || 'Flow')}`, '  autonumber', ...participants.map((p, i) => (i === 0 ? '  actor Client' : `  participant ${id(i)} as ${mm(p)}`))]
  for (const m of messages) {
    if (m.kind === 'note') lines.push(`  Note over ${id(m.from)},${id(m.to)}: ${mm(m.text)}`)
    else lines.push(`  ${id(m.from)}${m.kind === 'request' ? '->>' : '-->>'}${id(m.to)}: ${mm(m.text)}`)
  }
  return lines.join('\n') + '\n'
}

/* ---------- SVG ---------- */

export interface SvgPalette {
  background: string
  ink: string
  muted: string
  line: string
  box: string
  accent: string
  error: string
  font: string
  mono: string
}

export const LIGHT_PALETTE: SvgPalette = {
  background: '#fbfaf8',
  ink: '#211f1d',
  muted: '#8b8681',
  line: '#cbc7c1',
  box: '#ffffff',
  accent: '#b24f28',
  error: '#b3412f',
  font: "'Schibsted Grotesk', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** about how wide monospaced text is at 12px */
const textWidth = (s: string) => s.length * 7.3

/** The flow as a standalone SVG sequence diagram. Pass a palette of CSS variables to draw it inline in a themed page. */
export function toSequenceSvg(flow: Flow, contract: Contract, palette: SvgPalette = LIGHT_PALETTE): string {
  const { participants, messages } = flowSequence(flow, contract)
  const pad = 24
  const head = 34
  const titleH = 28
  // each gap between neighbours is wide enough for the longest label that crosses it
  const gaps = participants.slice(1).map(() => 160)
  for (const m of messages) {
    const lo = Math.min(m.from, m.to)
    const hi = Math.max(m.from, m.to)
    const need = textWidth(m.text) + 36
    const span = gaps.slice(lo, hi).reduce((a, b) => a + b, 0)
    if (span < need && hi > lo) gaps[hi - 1] += need - span
  }
  const boxW = (p: string) => Math.max(96, textWidth(p) + 28)
  const xs = participants.reduce<number[]>((acc, p, i) => [...acc, i === 0 ? pad + boxW(p) / 2 : acc[i - 1] + gaps[i - 1]], [])
  const width = Math.round(Math.max(xs[xs.length - 1] + boxW(participants[participants.length - 1]) / 2 + pad, textWidth(flow.name) + pad * 2))
  const rowH = 40
  // participant boxes at the top and bottom, lifelines between, one row per message
  const topY = titleH + pad
  const firstRow = topY + head + 28
  const bottomY = firstRow + Math.max(messages.length, 1) * rowH
  const height = bottomY + head + pad
  const out: string[] = []
  const box = (i: number, y: number) =>
    `<rect x="${xs[i] - boxW(participants[i]) / 2}" y="${y}" width="${boxW(participants[i])}" height="${head}" rx="6" fill="${palette.box}" stroke="${i === 0 ? palette.accent : palette.line}"/>` +
    `<text x="${xs[i]}" y="${y + head / 2 + 4.5}" text-anchor="middle" font-family="${esc(palette.font)}" font-size="13" font-weight="600" fill="${palette.ink}">${esc(participants[i])}</text>`
  out.push(`<rect width="${width}" height="${height}" fill="${palette.background}"/>`)
  out.push(`<text x="${pad}" y="${pad + 14}" font-family="${esc(palette.font)}" font-size="15" font-weight="600" fill="${palette.ink}">${esc(flow.name || 'Flow')}</text>`)
  participants.forEach((_, i) => {
    out.push(`<line x1="${xs[i]}" y1="${topY + head}" x2="${xs[i]}" y2="${bottomY}" stroke="${palette.line}" stroke-dasharray="4 4"/>`)
    out.push(box(i, topY), box(i, bottomY))
  })
  messages.forEach((m, r) => {
    const y = firstRow + r * rowH + 8
    if (m.kind === 'note') {
      const x1 = Math.min(xs[m.from], xs[m.to]) - 12
      const x2 = Math.max(xs[m.from], xs[m.to]) + 12
      out.push(`<rect x="${x1}" y="${y - 15}" width="${x2 - x1}" height="24" rx="4" fill="${palette.box}" stroke="${palette.line}"/>`)
      out.push(`<text x="${(x1 + x2) / 2}" y="${y + 1}" text-anchor="middle" font-family="${esc(palette.font)}" font-size="12" fill="${palette.muted}">${esc(m.text)}</text>`)
      return
    }
    const right = xs[m.to] > xs[m.from]
    const x1 = xs[m.from]
    const x2 = xs[m.to] + (right ? -2 : 2)
    const error = m.kind === 'response' && /^(\d)/.test(m.text) && Number(m.text.slice(0, 3)) >= 400
    const color = m.kind === 'request' ? palette.ink : error || m.text.startsWith('Error') ? palette.error : palette.muted
    out.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="1.5"${m.kind === 'response' ? ' stroke-dasharray="6 4"' : ''}/>`)
    const tip = right ? -1 : 1
    out.push(`<path d="M${x2} ${y} l${tip * 9} -5 v10 z" fill="${color}"/>`)
    out.push(`<text x="${(x1 + x2) / 2}" y="${y - 7}" text-anchor="middle" font-family="${esc(palette.mono)}" font-size="12" fill="${color}">${m.kind === 'request' ? `${m.step + 1}. ` : ''}${esc(m.text)}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Sequence diagram: ${flow.name}`)}">${out.join('')}</svg>\n`
}

/** A flow to start from: the contract's first few endpoints, in order. */
export function starterFlow(contract: Contract, id: string, stepId: (i: number) => string): Flow {
  return { id, name: 'New flow', steps: contract.endpoints.slice(0, 3).map((e, i) => ({ id: stepId(i), endpointId: e.id })) }
}

/** The statuses a step can show: every response the endpoint declares, success first. */
export const stepStatuses = (e: ContractEndpoint): ResponseStatus[] =>
  [...e.responses.map((r) => r.status)].sort((a, b) => (isSuccess(a) === isSuccess(b) ? 0 : isSuccess(a) ? -1 : 1))
