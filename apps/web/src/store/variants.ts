import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { SAMPLE_VARIANTS_CSS, SAMPLE_VARIANTS_TSX } from '@/lib/sampleVariants'

export type VariantsMobilePane = 'code' | 'canvas'

interface VariantsState {
  /** one .tsx file's components */
  source: string
  /** the styles they need: plain CSS, a `.dark` class for the dark theme */
  css: string
  tab: 'tsx' | 'css'
  /** the component shown */
  component: string
  /** the themes drawn, each on its own surface */
  themes: string[]
  mobilePane: VariantsMobilePane
  set: (patch: Partial<Omit<VariantsState, 'set'>>) => void
}

export const useVariants = create<VariantsState>()(
  persist(
    (set) => ({
      source: SAMPLE_VARIANTS_TSX,
      css: SAMPLE_VARIANTS_CSS,
      tab: 'tsx',
      component: '',
      themes: ['light', 'dark'],
      mobilePane: 'canvas',
      set: (patch) => set(patch),
    }),
    { name: 'stacksketch:variants', version: 1 },
  ),
)
