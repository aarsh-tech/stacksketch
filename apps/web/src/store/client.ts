import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { collectionFromContract } from '@stacksketch/core'
import type { ApiRequest, AssertionResult, BuiltRequest, Environment, SendResult } from '@stacksketch/core'
import { sampleContract } from '@/lib/sampleContract'
import type { Transport } from '@/modules/api-client/transport'

export type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'tests' | 'notes'
export type ResponseTab = 'body' | 'headers' | 'tests' | 'contract' | 'code'
export type ClientMobilePane = 'list' | 'request' | 'response'

interface ClientState {
  requests: ApiRequest[]
  environments: Environment[]
  /** the environment whose variables fill `{{names}}`; null for none */
  envId: string | null
  selected: string | null
  transport: Transport
  proxyPort: number
  /** give up on a request after this many seconds */
  timeout: number
  requestTab: RequestTab
  responseTab: ResponseTab
  mobilePane: ClientMobilePane
  set: (patch: Partial<Pick<ClientState, 'envId' | 'selected' | 'transport' | 'proxyPort' | 'timeout' | 'requestTab' | 'responseTab' | 'mobilePane'>>) => void
  updateRequest: (id: string, change: (r: ApiRequest) => ApiRequest) => void
  /** add requests (after the selected one's folder, or at the end) and select the first */
  addRequests: (requests: ApiRequest[]) => void
  removeRequest: (id: string) => void
  /** put things back as they were (an undo) */
  restore: (requests: ApiRequest[], environments: Environment[], selected: string | null, envId: string | null) => void
  setEnvironments: (environments: Environment[], envId?: string | null) => void
  updateEnvironment: (id: string, change: (e: Environment) => Environment) => void
}

export const clientId = () => Math.random().toString(36).slice(2, 10)

/** The first run: a request per endpoint of the sample contract, and environments for the mock and the real API. */
function starter() {
  const contract = sampleContract()
  const { environment, requests } = collectionFromContract(contract, clientId)
  const mockServer: Environment = { id: clientId(), name: 'Mock server (localhost:4010)', variables: [{ key: 'baseUrl', value: 'http://localhost:4010/v1', enabled: true }] }
  return { requests, environments: [environment, mockServer], envId: environment.id, selected: requests[0]?.id ?? null }
}

export const useClient = create<ClientState>()(
  persist(
    (set) => ({
      ...starter(),
      transport: 'mock',
      proxyPort: 4011,
      timeout: 30,
      requestTab: 'params',
      responseTab: 'body',
      mobilePane: 'list',
      set: (patch) => set(patch),
      updateRequest: (id, change) => set((s) => ({ requests: s.requests.map((r) => (r.id === id ? change(r) : r)) })),
      addRequests: (added) =>
        set((s) => {
          if (!added.length) return {}
          return { requests: [...s.requests, ...added], selected: added[0].id, mobilePane: 'request' }
        }),
      removeRequest: (id) =>
        set((s) => {
          const i = s.requests.findIndex((r) => r.id === id)
          const requests = s.requests.filter((r) => r.id !== id)
          return { requests, selected: s.selected === id ? (requests[Math.min(i, requests.length - 1)]?.id ?? null) : s.selected }
        }),
      restore: (requests, environments, selected, envId) => set({ requests, environments, selected, envId }),
      setEnvironments: (environments, envId) => set((s) => ({ environments, envId: envId === undefined ? (environments.some((e) => e.id === s.envId) ? s.envId : (environments[0]?.id ?? null)) : envId })),
      updateEnvironment: (id, change) => set((s) => ({ environments: s.environments.map((e) => (e.id === id ? change(e) : e)) })),
    }),
    {
      name: 'stacksketch:client',
      version: 1,
      partialize: ({ requests, environments, envId, selected, transport, proxyPort, timeout, requestTab, responseTab, mobilePane }) => ({
        requests,
        environments,
        envId,
        selected,
        transport,
        proxyPort,
        timeout,
        requestTab,
        responseTab,
        mobilePane,
      }),
    },
  ),
)

/** One request sent and what came back. Kept for this session only: responses can be big, and may hold data you don't want saved. */
export interface Exchange {
  id: number
  requestId: string
  at: Date
  transport: Transport
  sent: BuiltRequest
  result: SendResult
  assertions: AssertionResult[]
  captured: { variable: string; value: string }[]
  captureFailed: string[]
}

interface HistoryState {
  exchanges: Exchange[]
  /** the exchange the response pane shows, per request */
  shown: Record<string, number>
  add: (x: Omit<Exchange, 'id'>) => void
  show: (requestId: string, id: number) => void
  clear: (requestId?: string) => void
}

let exchangeId = 0

export const useHistory = create<HistoryState>()((set) => ({
  exchanges: [],
  shown: {},
  add: (x) =>
    set((s) => {
      const id = ++exchangeId
      return { exchanges: [{ ...x, id }, ...s.exchanges].slice(0, 100), shown: { ...s.shown, [x.requestId]: id } }
    }),
  show: (requestId, id) => set((s) => ({ shown: { ...s.shown, [requestId]: id } })),
  clear: (requestId) => set((s) => (requestId ? { exchanges: s.exchanges.filter((x) => x.requestId !== requestId) } : { exchanges: [], shown: {} })),
}))
