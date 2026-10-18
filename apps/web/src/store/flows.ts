import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { Flow } from '@stacksketch/core'

export type FlowsView = 'diagram' | 'mermaid'
export type FlowsMobilePane = 'list' | 'steps' | 'diagram'

interface FlowsState {
  flows: Flow[]
  activeFlow: string
  view: FlowsView
  mobilePane: FlowsMobilePane
  set: (patch: Partial<Pick<FlowsState, 'activeFlow' | 'view' | 'mobilePane'>>) => void
  /** change the open flow */
  update: (change: (flow: Flow) => Flow) => void
  addFlow: (flow: Flow) => void
  /** put the whole list back, for undo */
  replaceFlows: (flows: Flow[], activeFlow: string) => void
}

export const uid = () => Math.random().toString(36).slice(2, 10)

/** Built on the sample contract's endpoints: place an order, check it, ship it, then try to cancel it too late. */
const sampleFlow = (): Flow => ({
  id: 'flow-1',
  name: 'Place and ship an order',
  description: 'What the shop’s checkout and the warehouse screen call, in order.',
  steps: [
    { id: 's1', endpointId: 'ep-create', note: 'Keep the order’s ID for the next calls' },
    { id: 's2', endpointId: 'ep-get' },
    { id: 's3', endpointId: 'ep-status' },
    { id: 's4', endpointId: 'ep-cancel', status: 409 },
  ],
})

export const useFlows = create<FlowsState>()(
  persist(
    (set) => ({
      flows: [sampleFlow()],
      activeFlow: 'flow-1',
      view: 'diagram',
      mobilePane: 'steps',
      set: (patch) => set(patch),
      update: (change) => set((s) => ({ flows: s.flows.map((f) => (f.id === s.activeFlow ? change(f) : f)) })),
      addFlow: (flow) => set((s) => ({ flows: [...s.flows, flow], activeFlow: flow.id })),
      replaceFlows: (flows, activeFlow) => set({ flows, activeFlow }),
    }),
    { name: 'stacksketch:flows', version: 1 },
  ),
)

export const activeFlowOf = (s: { flows: Flow[]; activeFlow: string }) => s.flows.find((f) => f.id === s.activeFlow) ?? s.flows[0]
