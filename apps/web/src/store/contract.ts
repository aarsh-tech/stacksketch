import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { renameContractType, upgradeContract } from '@stacksketch/core'
import type { Contract } from '@stacksketch/core'
import { sampleContract } from '@/lib/sampleContract'

/** What the editor shows: an endpoint, a type, or the contract's own settings. */
export type ContractSelection = { kind: 'endpoint'; id: string } | { kind: 'type'; name: string } | { kind: 'contract' }
export type ContractOutput = 'openapi' | 'ts' | 'zod' | 'client'
export type OpenApiFormat = 'yaml' | 'json'
export type ContractMobilePane = 'list' | 'editor' | 'code'

interface ContractState {
  contract: Contract
  selected: ContractSelection
  output: ContractOutput
  openApiFormat: OpenApiFormat
  /** the client checks responses with Zod */
  validate: boolean
  mobilePane: ContractMobilePane
  set: (patch: Partial<Pick<ContractState, 'selected' | 'output' | 'openApiFormat' | 'validate' | 'mobilePane'>>) => void
  update: (change: (contract: Contract) => Contract) => void
  /** swap the whole contract (an import, starting over, or an undo of either) */
  replace: (contract: Contract, selected?: ContractSelection) => void
  /** rename a type everywhere, keeping it selected */
  renameType: (from: string, to: string) => void
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const useContract = create<ContractState>()(
  persist(
    (set) => ({
      contract: sampleContract(),
      selected: { kind: 'endpoint', id: 'ep-list' },
      output: 'openapi',
      openApiFormat: 'yaml',
      validate: true,
      mobilePane: 'list',
      set: (patch) => set(patch),
      update: (change) => set((s) => ({ contract: change(s.contract) })),
      replace: (contract, selected = { kind: 'contract' }) => set({ contract, selected }),
      renameType: (from, to) =>
        set((s) => ({
          contract: renameContractType(s.contract, from, to),
          selected: s.selected.kind === 'type' && s.selected.name === from ? { kind: 'type', name: to } : s.selected,
        })),
    }),
    {
      name: 'stacksketch:contract',
      version: 1,
      partialize: ({ contract, selected, output, openApiFormat, validate, mobilePane }) => ({ contract, selected, output, openApiFormat, validate, mobilePane }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ContractState>
        if (!saved.contract) return { ...current, ...saved }
        try {
          return { ...current, ...saved, contract: upgradeContract(saved.contract) }
        } catch {
          // saved by a newer Stacksketch, which this one can't read: open the sample instead
          return current
        }
      },
    },
  ),
)
