import { create } from 'zustand'

import type { QaComment, Rect } from '@stacksketch/core'

/** An image as the QA overlay holds it: a data URL and its own size in pixels. */
export interface QaImage {
  src: string
  name: string
  width: number
  height: number
  /** pixels per CSS pixel: 2 for a retina screenshot or a @2x export */
  scale: number
}

export type QaMode = 'overlay' | 'swipe' | 'diff'
export type QaTool = 'none' | 'measure' | 'comment'
export type QaMobilePane = 'images' | 'stage' | 'findings'

export interface QaDiff {
  /** 0 to 1 */
  ratio: number
  changed: number
  /** a PNG data URL: the differing pixels in the danger colour, the rest transparent */
  mask: string
  /** in CSS pixels of the page */
  regions: Rect[]
  /** the settings it was made with, to tell when it's out of date */
  key: string
}

interface QaState {
  page: QaImage | null
  design: QaImage | null
  opacity: number
  blend: 'normal' | 'difference'
  mode: QaMode
  /** how much of the design shows in swipe mode, 0 to 1 */
  swipe: number
  /** where the design sits over the page, in CSS pixels */
  x: number
  y: number
  zoom: 'fit' | number
  tool: QaTool
  comments: QaComment[]
  notes: string[]
  diff: QaDiff | null
  showRegions: boolean
  /** comparing right now */
  busy: boolean
  mobilePane: QaMobilePane
  set: (patch: Partial<Omit<QaState, 'set'>>) => void
}

// images can be megabytes, more than localStorage holds, so the QA overlay keeps them for the session only
export const useQa = create<QaState>()((set) => ({
  page: null,
  design: null,
  opacity: 0.5,
  blend: 'normal',
  mode: 'overlay',
  swipe: 0.5,
  x: 0,
  y: 0,
  zoom: 'fit',
  tool: 'none',
  comments: [],
  notes: [],
  diff: null,
  showRegions: true,
  busy: false,
  mobilePane: 'images',
  set: (patch) => set(patch),
}))
