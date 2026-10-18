import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Menu, Monitor, Moon, ShieldCheck, Sun, X } from 'lucide-react'

import { LogoMark } from '@/components/Logo'
import { IconButton } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { MODULES, moduleById } from '@/modules/registry'
import type { ModuleInfo } from '@/modules/registry'
import { useUi } from '@/store/ui'
import type { ThemePref } from '@/store/ui'

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }

function ThemeButton() {
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <IconButton label={`${THEME_LABEL[theme]} (click to change)`} onClick={() => setTheme(NEXT_THEME[theme])}>
      <Icon size={16} />
    </IconButton>
  )
}

function ModuleLink({ m, onPick }: { m: ModuleInfo; onPick: () => void }) {
  const active = useUi((s) => s.module === m.id)
  const setModule = useUi((s) => s.setModule)
  const Icon = m.icon
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      title={m.summary}
      onClick={() => {
        setModule(m.id)
        onPick()
      }}
      className={cx(
        'group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors',
        active ? 'bg-accent-soft font-medium text-ink' : m.ready ? 'text-ink hover:bg-hover' : 'text-ink-2 hover:bg-hover hover:text-ink',
      )}
    >
      <Icon size={15} className={cx('shrink-0', active || m.ready ? 'text-accent' : 'text-ink-3')} />
      <span className="flex-1 truncate">{m.name}</span>
      {m.ready ? null : <span className="font-mono text-[10.5px] text-ink-3">P{m.phase}</span>}
    </button>
  )
}

function Sidebar({ onPick }: { onPick: () => void }) {
  const ready = MODULES.filter((m) => m.ready)
  const planned = MODULES.filter((m) => !m.ready)
  return (
    <nav aria-label="Modules" className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
        <p className="px-2 pb-1.5 text-[11.5px] font-medium text-ink-3">Ready</p>
        <div className="space-y-px">
          {ready.map((m) => (
            <ModuleLink key={m.id} m={m} onPick={onPick} />
          ))}
        </div>
        <p className="mt-5 px-2 pb-1.5 text-[11.5px] font-medium text-ink-3">On the roadmap</p>
        <div className="space-y-px">
          {planned.map((m) => (
            <ModuleLink key={m.id} m={m} onPick={onPick} />
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-[11.5px] leading-snug text-ink-3">
        <ShieldCheck size={14} className="mt-px shrink-0 text-ok" />
        Runs in your browser. Nothing you paste is uploaded.
      </div>
    </nav>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const current = useUi((s) => moduleById(s.module))
  const [drawer, setDrawer] = useState(false)

  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 md:px-3">
        <IconButton label="Open modules" className="md:hidden" onClick={() => setDrawer(true)}>
          <Menu size={17} />
        </IconButton>
        <div className="flex items-center gap-2 pr-1">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Stacksketch</span>
        </div>
        <span aria-hidden className="h-4 w-px bg-line-strong max-sm:hidden" />
        <span className="truncate text-[13px] text-ink-2 max-sm:hidden">{current.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-3 max-sm:hidden">v0.1 · phase 1</span>
          <ThemeButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-line bg-panel max-md:hidden">
          <Sidebar onPick={() => {}} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {drawer ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close modules" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel shadow-pop">
            <div className="flex h-12 items-center gap-2 border-b border-line px-3">
              <LogoMark />
              <span className="text-[15px] font-semibold tracking-[-0.02em]">Stacksketch</span>
              <IconButton label="Close modules" className="ml-auto" onClick={() => setDrawer(false)}>
                <X size={16} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar onPick={() => setDrawer(false)} />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
