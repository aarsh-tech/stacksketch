import { useEffect, useRef } from 'react'
import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { X } from 'lucide-react'

import { cx } from '@/lib/cx'

/* ---------- buttons ---------- */

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'ghost' | 'outline' | 'primary' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'outline' && 'border border-line-strong bg-raised text-ink hover:bg-hover',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
      {...rest}
    />
  )
}

type IconButtonProps = ComponentProps<'button'> & { label: string; active?: boolean }

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40',
        active && 'bg-hover text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-panel px-1.5 py-px font-mono text-[11px] text-ink-2">{children}</kbd>
}

/* ---------- form controls ---------- */

export const inputClass =
  'h-7 rounded-md border border-line-strong bg-raised px-2 text-[12.5px] text-ink placeholder:text-ink-3 outline-none focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

export function TextInput({ className, ...rest }: ComponentProps<'input'>) {
  return <input type="text" spellCheck={false} autoComplete="off" className={cx(inputClass, className)} {...rest} />
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cx(inputClass, 'pr-1 font-medium', className)} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-2 select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--c-accent)]" />
      {label}
    </label>
  )
}

/* ---------- settings panels ---------- */

export function Group({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="text-[12px] font-semibold text-ink-2">{title}</h3>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

/** A control with its label above it; the hint sits outside the label so it isn't read as part of the control's name. */
export function Labeled({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1 text-[11.5px] font-medium text-ink-3', className)}>
      <label className="flex min-w-0 flex-col gap-1">
        {label}
        {children}
      </label>
      {hint ? <span className="font-normal">{hint}</span> : null}
    </div>
  )
}

/* ---------- tabs and segmented control ---------- */

/** A row of tabs. Arrow keys move between them. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((t) => t.value === value)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : step ? (i + step + options.length) % options.length : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${options[next].value}"]`)?.focus()
  }
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          data-tab={o.value}
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative h-10 shrink-0 px-2 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'text-ink' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
          {value === o.value ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" /> : null}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-md bg-hover p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 flex-1 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- layout ---------- */

/** A titled pane with a fixed header row and a scrolling body. */
export function Pane({
  title,
  meta,
  actions,
  toolbar,
  children,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('flex min-h-0 min-w-0 flex-col bg-panel', className)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3.5">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em]">{title}</h2>
        {meta ? <span className="truncate text-[12px] text-ink-3">{meta}</span> : null}
        <div className="ml-auto flex items-center gap-0.5">{actions}</div>
      </header>
      {toolbar ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">{toolbar}</div> : null}
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  )
}

/* ---------- dialog ---------- */

/**
 * A modal on the native <dialog>: Escape closes it, focus stays inside, and
 * a click on the backdrop closes it. Mount it to open it; unmount to close.
 */
export function Dialog({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line bg-raised p-0 text-ink shadow-pop backdrop:bg-black/45"
    >
      <div className="flex max-h-[min(720px,calc(100dvh-32px))] flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
          <IconButton label="Close" className="ml-auto" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">{children}</div>
        {footer ? <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
