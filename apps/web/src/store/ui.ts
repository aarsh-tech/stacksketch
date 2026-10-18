import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ModuleId } from '@/modules/registry'

export type ThemePref = 'system' | 'light' | 'dark'

interface UiState {
  theme: ThemePref
  module: ModuleId
  setTheme: (theme: ThemePref) => void
  setModule: (module: ModuleId) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      module: 'api-explorer',
      setTheme: (theme) => set({ theme }),
      setModule: (module) => set({ module }),
    }),
    { name: 'stacksketch:ui', version: 1 },
  ),
)
