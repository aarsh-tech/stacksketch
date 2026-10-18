import { useState } from 'react'
import { ExternalLink } from 'lucide-react'

import { Button, Dialog } from '@/components/ui/primitives'
import { SURFACE_LABEL, moduleById } from './registry'
import type { ModuleId } from './registry'

/** The button that explains how to run a module against your real app: the CLI, the browser extension or the dev-server plugin. */
export function RunOutside({ id, label }: { id: ModuleId; label?: string }) {
  const [open, setOpen] = useState(false)
  const m = moduleById(id)
  if (!m.setup) return null
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={`Use it on your own app, as a ${SURFACE_LABEL[m.surface].toLowerCase()}`}>
        <ExternalLink size={13} />
        <span className="max-sm:hidden">{label ?? 'Use it on your app'}</span>
      </Button>
      {open ? (
        <Dialog title={`${m.name} on your own app`} onClose={() => setOpen(false)} footer={<Button variant="outline" onClick={() => setOpen(false)}>Done</Button>}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            This page runs it in the workbench. To run it against your real app, use the {SURFACE_LABEL[m.surface].toLowerCase()}:
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-ink">
            {m.setup.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Dialog>
      ) : null}
    </>
  )
}
