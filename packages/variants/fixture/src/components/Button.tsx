import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md' | 'lg'
  variant: 'primary' | 'outline' | 'ghost'
  loading?: boolean
  icon?: ReactNode
  children: ReactNode
  onPress?: () => void
}

const PAD = { sm: '4px 8px', md: '6px 12px', lg: '10px 18px' }

export function Button({ size = 'md', variant, loading, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        padding: PAD[size],
        borderRadius: 6,
        font: 'inherit',
        border: variant === 'outline' ? '1px solid var(--btn-bg)' : '1px solid transparent',
        background: variant === 'primary' ? 'var(--btn-bg)' : 'transparent',
        color: variant === 'primary' ? 'var(--btn-ink)' : 'var(--text)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? 'Loading…' : children}
    </button>
  )
}
