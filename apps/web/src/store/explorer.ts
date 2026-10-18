import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { emptyOverrides } from '@stacksketch/core'
import type { HttpMethod, Overrides } from '@stacksketch/core'
import { SAMPLE_JSON, SAMPLE_ROOT, SAMPLE_URL } from '@/lib/sample'

export type OutputTab = 'ts' | 'validation' | 'mock' | 'client' | 'jsonschema' | 'backend'
export type Validator = 'zod' | 'valibot' | 'yup'
export type Client = 'fetch' | 'axios' | 'query'
export type BackendLang = 'pydantic' | 'go'
export type MobilePane = 'input' | 'structure' | 'code'
export type StructureView = 'tree' | 'graph'

/** One pasted response. Several samples of the same endpoint merge into one schema. */
export interface Sample {
  id: string
  name: string
  text: string
}

interface ExplorerState {
  samples: Sample[]
  activeSample: string
  rootName: string
  output: OutputTab
  validator: Validator
  client: Client
  backend: BackendLang
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
  set: (patch: Partial<Omit<ExplorerState, 'set' | 'loadSample' | 'setSampleText' | 'addSample' | 'removeSample'>>) => void
  setSampleText: (text: string) => void
  /** add samples (or one empty one) and switch to the first new tab */
  addSample: (samples?: Omit<Sample, 'id'>[]) => void
  removeSample: (id: string) => void
  loadSample: () => void
}

export const newSampleId = () => Math.random().toString(36).slice(2, 10)

/** "Sample 3", the next free number */
function nextName(samples: Sample[]) {
  let n = samples.length + 1
  while (samples.some((s) => s.name === `Sample ${n}`)) n++
  return `Sample ${n}`
}

const firstSample = (): Sample => ({ id: 's1', name: 'Sample 1', text: SAMPLE_JSON })

export const useExplorer = create<ExplorerState>()(
  persist(
    (set) => ({
      samples: [firstSample()],
      activeSample: 's1',
      rootName: SAMPLE_ROOT,
      output: 'ts',
      validator: 'zod',
      client: 'fetch',
      backend: 'pydantic',
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
      setSampleText: (text) => set((s) => ({ samples: s.samples.map((x) => (x.id === s.activeSample ? { ...x, text } : x)) })),
      addSample: (added) =>
        set((s) => {
          const fresh: Sample[] = []
          for (const a of added ?? [{ name: '', text: '' }]) fresh.push({ id: newSampleId(), name: a.name || nextName([...s.samples, ...fresh]), text: a.text })
          return { samples: [...s.samples, ...fresh], activeSample: fresh[0].id }
        }),
      removeSample: (id) =>
        set((s) => {
          if (s.samples.length === 1) return { samples: [{ ...s.samples[0], text: '' }] }
          const i = s.samples.findIndex((x) => x.id === id)
          const samples = s.samples.filter((x) => x.id !== id)
          return { samples, activeSample: s.activeSample === id ? samples[Math.max(0, i - 1)].id : s.activeSample }
        }),
      loadSample: () => set({ samples: [firstSample()], activeSample: 's1', rootName: SAMPLE_ROOT, url: SAMPLE_URL, method: 'GET' }),
    }),
    {
      name: 'stacksketch:explorer',
      version: 4,
      // v2: Tree | Graph switch. v3: schema edits. v4: several samples, and outputs grouped into tabs with a library picker.
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>
        const next: Record<string, unknown> = { structureView: 'tree', overrides: emptyOverrides(), ...old }
        if (version < 4) {
          next.samples = [{ id: 's1', name: 'Sample 1', text: typeof old.input === 'string' ? old.input : SAMPLE_JSON }]
          next.activeSample = 's1'
          delete next.input
          if (old.output === 'zod') next.output = 'validation'
          if (old.output === 'fetch') next.output = 'client'
        }
        return next as unknown as ExplorerState
      },
    },
  ),
)

/** The sample whose text the editor shows. */
export const activeSampleOf = (s: { samples: Sample[]; activeSample: string }) => s.samples.find((x) => x.id === s.activeSample) ?? s.samples[0]

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
