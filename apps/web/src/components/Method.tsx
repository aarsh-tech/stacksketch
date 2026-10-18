import type { HttpMethod } from '@stacksketch/core'
import { cx } from '@/lib/cx'

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-t-string',
  POST: 'text-t-number',
  PUT: 'text-t-keyword',
  PATCH: 'text-t-boolean',
  DELETE: 'text-danger',
}

/** An HTTP method in its colour, as the contract and the mock server list them. */
export function Method({ method, className }: { method: string; className?: string }) {
  return <span className={cx('shrink-0 font-mono text-[10.5px] font-bold tracking-wide', METHOD_COLOR[method as HttpMethod] ?? 'text-ink-2', className)}>{method}</span>
}
