import { forwardRef } from 'react'

type Tone = 'info' | 'success' | 'danger'

/** A small label. The danger tone throws on purpose, to show how the canvas marks a broken variant. */
const Badge = forwardRef<HTMLSpanElement, { tone: Tone; count?: number; label: string }>(function Badge({ tone, count, label }, ref) {
  if (tone === 'danger' && count === undefined) throw new Error('A danger badge needs a count')
  return (
    <span ref={ref} style={{ color: 'var(--text)', fontSize: 12 }}>
      {label} ({tone}){count === undefined ? '' : ` ${count}`}
    </span>
  )
})

export default Badge
