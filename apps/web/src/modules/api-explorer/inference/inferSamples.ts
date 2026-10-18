import { inferSchema, parseJson } from '@stacksketch/core'
import type { Schema } from '@stacksketch/core'

export interface SampleError {
  message: string
  line?: number
  column?: number
}

export interface Inference {
  /** null when no sample holds valid JSON */
  schema: Schema | null
  /** by sample id; null for samples that parsed */
  errors: Record<string, SampleError | null>
}

/**
 * Parse every sample and infer one schema from the ones that are valid, so a
 * half-typed tab doesn't blank the output of the others. Empty tabs are skipped.
 */
export function inferSamples(samples: { id: string; text: string }[], rootName: string): Inference {
  const errors: Record<string, SampleError | null> = {}
  const values: unknown[] = []
  for (const s of samples) {
    if (!s.text.trim()) {
      errors[s.id] = null
      continue
    }
    const r = parseJson(s.text)
    if (r.ok) values.push(r.value)
    errors[s.id] = r.ok ? null : { message: r.message, line: r.line, column: r.column }
  }
  return { schema: values.length ? inferSchema(values, rootName.trim() || 'Root') : null, errors }
}
