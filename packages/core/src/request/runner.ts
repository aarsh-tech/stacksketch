import type { Contract } from '../contract/types'
import { buildRequest, requestProblem, runAssertions, runCaptures, setVariables, variablesOf } from './model'
import type { AssertionResult } from './model'
import type { ApiRequest, Environment, SendRequest, SendResult } from './types'

/**
 * Run requests one after another, the way a collection runner does: each
 * request sees the variables the ones before it captured (log in, then use
 * the token), and its checks run on its response.
 */

export interface RunStep {
  requestId: string
  name: string
  method: string
  url: string
  /** why it wasn't sent: a missing variable, a bad URL */
  skipped?: string
  result?: SendResult
  assertions: AssertionResult[]
  /** variables it set for the requests after it */
  captured: { variable: string; value: string }[]
  /** every check passed and the request got a response */
  pass: boolean
}

export interface RunOptions {
  contract?: Contract
  /** stop at the first request that fails */
  stopOnFailure?: boolean
  /** told about each step as it finishes */
  onStep?: (step: RunStep, index: number) => void
  /** checked before each request; return true to stop */
  cancelled?: () => boolean
}

export async function runRequests(
  requests: ApiRequest[],
  environment: Environment,
  send: (request: SendRequest) => Promise<SendResult>,
  options: RunOptions = {},
): Promise<{ steps: RunStep[]; environment: Environment }> {
  let env = environment
  const steps: RunStep[] = []
  for (const [i, request] of requests.entries()) {
    if (options.cancelled?.()) break
    const built = buildRequest(request, variablesOf(env))
    const problem = requestProblem(built, request.body.kind)
    let step: RunStep
    if (problem) {
      step = { requestId: request.id, name: request.name, method: built.method, url: built.url, skipped: problem, assertions: [], captured: [], pass: false }
    } else {
      const result = await send({ method: built.method, url: built.url, headers: built.headers, body: built.body })
      if (!result.ok) {
        step = { requestId: request.id, name: request.name, method: built.method, url: built.url, result, assertions: [], captured: [], pass: false }
      } else {
        const assertions = runAssertions(request, result, options.contract)
        const { set } = runCaptures(request.captures, result)
        if (set.length) env = setVariables(env, set)
        step = { requestId: request.id, name: request.name, method: built.method, url: built.url, result, assertions, captured: set, pass: assertions.every((a) => a.pass) }
      }
    }
    steps.push(step)
    options.onStep?.(step, i)
    if (!step.pass && options.stopOnFailure) break
  }
  return { steps, environment: env }
}

/** A Markdown report of a run, for a pull request or a bug. */
export function runReport(title: string, steps: RunStep[], at = new Date()): string {
  const passed = steps.filter((s) => s.pass).length
  const lines = [`# ${title}`, '', `${passed} of ${steps.length} requests passed · ${at.toISOString().replace('T', ' ').slice(0, 16)} UTC`, '']
  for (const s of steps) {
    const status = s.result?.ok ? `${s.result.status} · ${s.result.ms} ms` : s.result ? `failed: ${s.result.error}` : `skipped: ${s.skipped ?? ''}`
    lines.push(`## ${s.pass ? '✅' : '❌'} ${s.name}`, '', `\`${s.method} ${s.url}\` → ${status}`, '')
    for (const a of s.assertions) lines.push(`- ${a.pass ? '✅' : '❌'} ${a.label}${a.detail ? `: ${a.detail}` : ''}`)
    if (s.captured.length) lines.push(`- Set ${s.captured.map((c) => `\`${c.variable}\``).join(', ')}`)
    lines.push('')
  }
  return lines.join('\n')
}
