/**
 * Three layers: a dashed sketch on top (the contract), an outline in the
 * middle (the types), a solid block at the bottom (the code you ship).
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="21" width="24" height="7" rx="2.5" fill="var(--c-accent)" />
      <rect x="4.8" y="13.3" width="22.4" height="5.4" rx="2" fill="none" stroke="var(--c-accent)" strokeWidth="1.6" />
      <rect x="4.8" y="5.3" width="22.4" height="5.4" rx="2" fill="none" stroke="var(--c-ink)" strokeWidth="1.6" strokeDasharray="2.6 2" />
    </svg>
  )
}
