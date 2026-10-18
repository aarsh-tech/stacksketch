import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { emptyForm } from '@stacksketch/core'
import type { Form } from '@stacksketch/core'
import { sampleForm } from '@/lib/sampleForm'

export type FormPanel = 'settings' | 'zod' | 'react'
/** the canvas: build the form, or fill it in */
export type FormView = 'edit' | 'preview'
export type FormMobilePane = 'add' | 'canvas' | 'panel'

interface FormsState {
  forms: Form[]
  activeForm: string
  /** the item open in the settings panel; null shows the form's own settings */
  selected: string | null
  panel: FormPanel
  view: FormView
  mobilePane: FormMobilePane
  set: (patch: Partial<Pick<FormsState, 'activeForm' | 'selected' | 'panel' | 'view' | 'mobilePane'>>) => void
  /** change the open form */
  update: (change: (form: Form) => Form) => void
  /** add a form and open it */
  addForm: (form: Form) => void
  removeForm: (id: string) => void
  /** put a form back (after an undo), where it was */
  restoreForm: (form: Form, index: number) => void
}

export const uid = () => Math.random().toString(36).slice(2, 10)

export const useForms = create<FormsState>()(
  persist(
    (set) => ({
      forms: [sampleForm()],
      activeForm: 'f1',
      selected: null,
      panel: 'settings',
      view: 'edit',
      mobilePane: 'canvas',
      set: (patch) => set(patch),
      update: (change) => set((s) => ({ forms: s.forms.map((f) => (f.id === s.activeForm ? change(f) : f)) })),
      addForm: (form) => set((s) => ({ forms: [...s.forms, form], activeForm: form.id, selected: null })),
      removeForm: (id) =>
        set((s) => {
          const i = s.forms.findIndex((f) => f.id === id)
          const forms = s.forms.filter((f) => f.id !== id)
          if (!forms.length) {
            const fresh = emptyForm(uid())
            return { forms: [fresh], activeForm: fresh.id, selected: null }
          }
          return { forms, activeForm: s.activeForm === id ? forms[Math.max(0, i - 1)].id : s.activeForm, selected: null }
        }),
      restoreForm: (form, index) =>
        set((s) => {
          const forms = s.forms.filter((f) => f.id !== form.id)
          forms.splice(Math.min(index, forms.length), 0, form)
          return { forms, activeForm: form.id, selected: null }
        }),
    }),
    {
      name: 'stacksketch:forms',
      version: 2,
      // 2: the code tab became two (Zod and React), and the canvas got a preview
      migrate: (persisted, version) => {
        const next: Record<string, unknown> = { view: 'edit', ...((persisted ?? {}) as Record<string, unknown>) }
        if (version < 2 && next.panel === 'code') next.panel = 'zod'
        return next as unknown as FormsState
      },
    },
  ),
)

/** The form on the canvas. */
export const activeFormOf = (s: { forms: Form[]; activeForm: string }) => s.forms.find((f) => f.id === s.activeForm) ?? s.forms[0]
