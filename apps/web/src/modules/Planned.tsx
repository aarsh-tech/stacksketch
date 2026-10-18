import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/primitives'
import { AUDIENCE_LABEL, MODULES, SURFACE_LABEL } from './registry'
import type { ModuleInfo } from './registry'
import { useUi } from '@/store/ui'

/** The page for a module that isn't built yet, or that runs outside the workbench: what it does, how it fits, and how to start it. */
export function Planned({ module: m }: { module: ModuleInfo }) {
  const setModule = useUi((s) => s.setModule)
  const Icon = m.icon
  const samePhase = MODULES.filter((x) => x.phase === m.phase && x.id !== m.id)
  return (
    <div className="paper-grid h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-2xl px-4 py-10 md:py-16">
        <div className="rounded-xl border border-line bg-raised p-6 shadow-pop md:p-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon size={20} />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{m.name}</h1>
              <p className="text-[12.5px] text-ink-3">
                Phase {m.phase} · {AUDIENCE_LABEL[m.audience]} · {SURFACE_LABEL[m.surface]}
              </p>
            </div>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-ink">{m.summary}</p>
          <ul className="mt-4 space-y-2">
            {m.details.map((d) => (
              <li key={d} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-2">
                <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent" />
                {d}
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-lg border border-dashed border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
            <span className="font-medium text-ink">How it connects: </span>
            {m.connects}
          </div>
          {m.ready && m.setup ? (
            <div className="mt-6">
              <h2 className="text-[13px] font-semibold text-ink">How to start it</h2>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
                {m.setup.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {samePhase.length && !m.ready ? (
            <p className="mt-4 text-[12.5px] text-ink-3">Ships in phase {m.phase} alongside {samePhase.map((x) => x.name).join(', ')}.</p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            <span className="text-[12.5px] text-ink-3">{m.ready ? `Built. It runs as a ${SURFACE_LABEL[m.surface].toLowerCase()}, outside this page.` : 'Not built yet. Track it in ROADMAP.md.'}</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => setModule('api-explorer')}>
              Open the API explorer
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
