import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type MockMobilePane = 'routes' | 'request' | 'response'

interface MockState {
  method: string
  /** the path and query sent to the mock, e.g. `/v1/orders?status=open` */
  url: string
  /** the JSON body, as typed */
  body: string
  /** force a status ('' answers as the contract says) */
  status: string
  /** wait this long, in ms ('' uses the endpoint's own delay) */
  delay: string
  seed: number
  crud: boolean
  mobilePane: MockMobilePane
  set: (patch: Partial<Omit<MockState, 'set'>>) => void
}

export const useMock = create<MockState>()(
  persist(
    (set) => ({
      method: 'GET',
      url: '',
      body: '',
      status: '',
      delay: '',
      seed: 1,
      crud: true,
      mobilePane: 'routes',
      set: (patch) => set(patch),
    }),
    { name: 'stacksketch:mock', version: 1 },
  ),
)
