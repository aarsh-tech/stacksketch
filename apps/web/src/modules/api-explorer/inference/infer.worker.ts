import { inferSamples } from './inferSamples'

export interface InferRequest {
  id: number
  samples: { id: string; text: string }[]
  rootName: string
}

/** Parses and infers big responses off the main thread, so typing stays smooth. */
self.onmessage = (e: MessageEvent<InferRequest>) => {
  const { id, samples, rootName } = e.data
  // the app's tsconfig has DOM types, where postMessage wants a target origin; in a worker it doesn't
  ;(self as unknown as { postMessage: (m: unknown) => void }).postMessage({ id, result: inferSamples(samples, rootName) })
}
