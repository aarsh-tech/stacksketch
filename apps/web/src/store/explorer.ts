import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { emptyOverrides } from '@stacksketch/core'
import type { HttpMethod, Overrides } from '@stacksketch/core'
import { SAMPLE_JSON, SAMPLE_ROOT, SAMPLE_URL } from '@/lib/sample'

export type OutputTab = 'ts' | 'zod' | 'mock' | 'fetch' | 'jsonschema'
export type MobilePane = 'input' | 'structure' | 'code'
export type StructureView = 'tree' | 'graph'

interface ExplorerState {
  input: string
  rootName: string
  output: OutputTab
  mobilePane: MobilePane
  structureView: StructureView
  /** hand edits on top of the inferred schema */
  overrides: Overrides
  tsStyle: 'interface' | 'type'
  tsReadonly: boolean
  method: HttpMethod
  url: string
  validate: boolean
  mockSeed: number
  mockCount: number
  set: (patch: Partial<Omit<ExplorerState, 'set' | 'loadSample'>>) => void
  loadSample: () => void
}

export const useExplorer = create<ExplorerState>()(
  persist(
    (set) => ({
      input: SAMPLE_JSON,
      rootName: SAMPLE_ROOT,
      output: 'ts',
      mobilePane: 'input',
      structureView: 'tree',
      overrides: emptyOverrides(),
      tsStyle: 'interface',
      tsReadonly: false,
      method: 'GET',
      url: SAMPLE_URL,
      validate: true,
      mockSeed: 1,
      mockCount: 5,
      set: (patch) => set(patch),
      loadSample: () => set({ input: SAMPLE_JSON, rootName: SAMPLE_ROOT, url: SAMPLE_URL, method: 'GET' }),
    }),
    {
      name: 'stacksketch:explorer',
      version: 3,
      // v1 → v2: the Structure pane gained a Tree | Graph switch; v2 → v3: schema edits
      migrate: (persisted) => ({ structureView: 'tree', overrides: emptyOverrides(), ...(persisted as object) }) as ExplorerState,
    },
  ),
)

/**
 * The type the user picked on the graph, so the code pane can highlight its
 * declaration. Not persisted. `nonce` changes on every pick so picking the
 * same type again scrolls back to it.
 */
interface FocusState {
  type: string | null
  nonce: number
  reveal: (type: string) => void
  clear: () => void
}

export const useFocus = create<FocusState>()((set) => ({
  type: null,
  nonce: 0,
  reveal: (type) => set((s) => ({ type, nonce: s.nonce + 1 })),
  clear: () => set({ type: null }),
}))
