/** The variant canvas's sample: a button and a badge, with one variant that's broken in the dark theme. */
export const SAMPLE_VARIANTS_TSX = `import type { ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  size?: Size
  variant: 'primary' | 'secondary' | 'ghost' | 'danger'
  loading?: boolean
  disabled?: boolean
  children?: ReactNode
  onClick?: () => void
}

export function Button({ size = 'md', variant, loading = false, disabled, children, onClick }: ButtonProps) {
  return (
    <button className={\`btn btn-\${size} btn-\${variant}\`} disabled={disabled || loading} aria-busy={loading} onClick={onClick}>
      {loading ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Badge({ tone = 'neutral', label }: { tone?: 'neutral' | 'success' | 'warning'; label: string }) {
  if (!label.trim()) throw new Error('A badge needs a label')
  return <span className={\`badge badge-\${tone}\`}>{label}</span>
}
`

export const SAMPLE_VARIANTS_CSS = `.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  font: 600 14px/1 system-ui, sans-serif;
  cursor: pointer;
}
.btn-sm { padding: 6px 10px; font-size: 12px; }
.btn-md { padding: 9px 14px; }
.btn-lg { padding: 12px 20px; font-size: 16px; }

.btn-primary { background: #b24f28; color: #fff; }
.btn-danger { background: #b3412f; color: #fff; }
.btn-secondary { background: #fff; color: #211f1d; border-color: #cbc7c1; }
.dark .btn-secondary { background: #211f1e; color: #ebe8e4; border-color: #3c3936; }
/* no dark style yet: look at the ghost button in the dark theme */
.btn-ghost { background: transparent; color: #211f1d; }

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font: 600 12px/1.5 system-ui, sans-serif; }
.badge-neutral { background: #ebe9e5; color: #5a5652; }
.badge-success { background: #dcefe3; color: #2d7a4f; }
.badge-warning { background: #f7ecd2; color: #9a6400; }
.dark .badge-neutral { background: #2d2b29; color: #aaa49e; }
`
