import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { SAMPLE_STACKING_CSS, SAMPLE_STACKING_HTML } from '@/lib/sampleStacking'

export type StackingMobilePane = 'code' | 'preview' | 'layers'

interface StackingState {
  html: string
  css: string
  /** which one the editor shows */
  tab: 'html' | 'css'
  mobilePane: StackingMobilePane
  set: (patch: Partial<Omit<StackingState, 'set'>>) => void
}

export const useStacking = create<StackingState>()(
  persist(
    (set) => ({
      html: SAMPLE_STACKING_HTML,
      css: SAMPLE_STACKING_CSS,
      tab: 'css',
      mobilePane: 'preview',
      set: (patch) => set(patch),
    }),
    { name: 'stacksketch:stacking', version: 1 },
  ),
)
