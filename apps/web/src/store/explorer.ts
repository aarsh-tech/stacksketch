import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { HttpMethod } from '@stacksketch/core'
import { SAMPLE_JSON, SAMPLE_ROOT, SAMPLE_URL } from '@/lib/sample'

export type OutputTab = 'ts' | 'zod' | 'mock' | 'fetch' | 'jsonschema'
export type MobilePane = 'input' | 'structure' | 'code'

interface ExplorerState {
  input: string
  rootName: string
  output: OutputTab
  mobilePane: MobilePane
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
    { name: 'stacksketch:explorer', version: 1 },
  ),
)
