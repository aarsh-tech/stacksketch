import { useEffect, useMemo, useState } from 'react'

import type { Sample } from '@/store/explorer'
import type { InferRequest } from './infer.worker'
import { inferSamples } from './inferSamples'
import type { Inference } from './inferSamples'

/** Above this many characters in total, parsing and inference move to a Web Worker. */
export const WORKER_THRESHOLD = 500_000

let worker: Worker | null = null
let nextId = 0
const waiting = new Map<number, (r: Inference) => void>()

function inferInWorker(samples: Sample[], rootName: string): Promise<Inference> {
  if (!worker) {
    worker = new Worker(new URL('./infer.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; result: Inference }>) => {
      waiting.get(e.data.id)?.(e.data.result)
      waiting.delete(e.data.id)
    }
  }
  const id = ++nextId
  const message: InferRequest = { id, samples: samples.map(({ id, text }) => ({ id, text })), rootName }
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker?.postMessage(message)
  })
}

const EMPTY: Inference = { schema: null, errors: {} }

/**
 * The schema inferred from every sample, and each sample's parse error.
 * Small inputs are inferred during render; big ones in a worker, keeping the
 * previous result on screen (with `pending`) until the new one arrives.
 */
export function useInference(samples: Sample[], rootName: string): Inference & { pending: boolean } {
  const big = samples.reduce((n, s) => n + s.text.length, 0) > WORKER_THRESHOLD
  const sync = useMemo(() => (big ? null : inferSamples(samples, rootName)), [big, samples, rootName])
  const [done, setDone] = useState<{ samples: Sample[]; rootName: string; result: Inference } | null>(null)

  useEffect(() => {
    if (!big) return
    let live = true
    void inferInWorker(samples, rootName).then((result) => {
      if (live) setDone({ samples, rootName, result })
    })
    return () => {
      live = false
    }
  }, [big, samples, rootName])

  if (sync) return { ...sync, pending: false }
  const fresh = done !== null && done.samples === samples && done.rootName === rootName
  return { ...(done?.result ?? EMPTY), pending: !fresh }
}
