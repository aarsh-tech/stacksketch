import { describe, expect, it } from 'vitest'

import { cellCount, componentsFromSource, defaultArgs, defaultAxes, stripComments, variantGrid } from './index'
import type { ComponentInfo } from './index'

const card: ComponentInfo = {
  name: 'AlertCard',
  file: '/src/AlertCard.tsx',
  props: [
    { name: 'tone', optional: false, type: { kind: 'enum', values: ['info', 'warn'] }, text: '"info" | "warn"' },
    { name: 'density', optional: true, type: { kind: 'enum', values: ['compact', 'roomy'] }, text: '"compact" | "roomy"' },
    { name: 'dismissible', optional: true, type: { kind: 'boolean' }, text: 'boolean' },
    { name: 'title', optional: true, type: { kind: 'string' }, text: 'string' },
    { name: 'count', optional: false, type: { kind: 'number' }, text: 'number' },
    { name: 'children', optional: true, type: { kind: 'node' }, text: 'ReactNode' },
    { name: 'onClose', optional: true, type: { kind: 'function' }, text: '() => void' },
  ],
}

describe('variant grid', () => {
  it('puts size-like props across and kind-like props down', () => {
    expect(defaultAxes(card.props)).toEqual({ columns: 'density', rows: 'tone' })
    expect(defaultAxes(card.props.filter((p) => p.name !== 'density'))).toEqual({ columns: 'tone', rows: 'dismissible' })
    expect(defaultAxes([])).toEqual({ columns: undefined, rows: undefined })
  })

  it('fills in what a component needs to render', () => {
    expect(defaultArgs(card.props, card.name)).toEqual({ tone: 'info', title: 'Title', count: 1, children: 'Alert card' })
  })

  it('crosses rows and columns, keeping values set by hand', () => {
    const g = variantGrid(card, { columns: 'density', rows: 'dismissible' }, { tone: 'warn' })
    expect(cellCount(g)).toBe(6)
    expect(g.args(1, 2)).toMatchObject({ tone: 'warn', dismissible: true, density: 'roomy' })
    expect(g.args(0, 0)).not.toHaveProperty('density')
    expect(cellCount(variantGrid(card, { columns: 'tone', rows: 'tone' }))).toBe(2)
  })
})

describe('components from source', () => {
  const props = (source: string, name?: string) => {
    const { components } = componentsFromSource(source)
    const c = name ? components.find((x) => x.name === name) : components[0]
    return Object.fromEntries((c?.props ?? []).map((p) => [p.name, { ...p.type, optional: p.optional }]))
  }

  it('reads an interface with unions, booleans, nodes and handlers', () => {
    const src = `
      import type { ReactNode } from 'react'
      type Size = 'sm' | 'md' | 'lg'
      /** a button */
      export interface ButtonProps {
        size?: Size
        variant:
          | 'primary'
          | "ghost" // the quiet one
        disabled?: boolean
        count: number;
        label?: string, icon?: ReactNode
        onClick?: (e: MouseEvent) => void
        onHover?(): void
        style?: React.CSSProperties
      }
      export function Button({ size = 'md', variant, ...rest }: ButtonProps) {
        return <button className={size}>{variant}</button>
      }`
    expect(props(src)).toEqual({
      size: { kind: 'enum', values: ['sm', 'md', 'lg'], optional: true },
      variant: { kind: 'enum', values: ['primary', 'ghost'], optional: false },
      disabled: { kind: 'boolean', optional: true },
      count: { kind: 'number', optional: false },
      label: { kind: 'string', optional: true },
      icon: { kind: 'node', optional: true },
      onClick: { kind: 'function', optional: true },
      onHover: { kind: 'function', optional: true },
      style: { kind: 'other', optional: true },
    })
  })

  it('follows aliases, intersections, utility types and HTML attributes', () => {
    const src = `
      type Tone = 'info' | 'warn'
      type Base = { tone: Tone; title: string; hidden?: boolean }
      interface More extends Omit<Base, 'hidden'> { dense?: boolean }
      type CardProps = Partial<More> & React.PropsWithChildren<{ footer?: React.ReactNode }>
      export const Card = ({ tone }: CardProps) => <div>{tone}</div>
      type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
      export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) { return <input ref={ref} /> })
      const Badge: React.FC<{ kind: 'new' | 'old' }> = ({ kind }) => <span>{kind}</span>
      export default Badge`
    expect(props(src, 'Card')).toEqual({
      tone: { kind: 'enum', values: ['info', 'warn'], optional: true },
      title: { kind: 'string', optional: true },
      dense: { kind: 'boolean', optional: true },
      footer: { kind: 'node', optional: true },
      children: { kind: 'node', optional: true },
    })
    expect(props(src, 'Input')).toEqual({ children: { kind: 'node', optional: true }, disabled: { kind: 'boolean', optional: true }, invalid: { kind: 'boolean', optional: true } })
    const { components } = componentsFromSource(src)
    expect(components.map((c) => [c.name, c.exportName])).toEqual([
      ['Card', undefined],
      ['Input', undefined],
      ['Badge', 'default'],
    ])
    expect(props(src, 'Badge')).toEqual({ kind: { kind: 'enum', values: ['new', 'old'], optional: false } })
  })

  it('finds default exports, memo and export lists, and skips the rest', () => {
    const src = `
      const helper = () => 1
      const theme = { dark: true }
      function Avatar(props: { round?: boolean }) { return null }
      const Chip = memo(({ on }: { on: boolean }) => null)
      export { Chip }
      export default function Page() { return null }
      export const useThing = () => null
      export const Avatar2 = Avatar`
    const { components } = componentsFromSource(src)
    expect(components.map((c) => c.name)).toEqual(['Chip', 'Page'])
    expect(components[1].exportName).toBe('default')
    expect(components[0].props).toEqual([{ name: 'on', optional: false, type: { kind: 'boolean' }, text: 'boolean' }])
  })

  it('says why nothing was found', () => {
    expect(componentsFromSource('const x = 1').warnings[0]).toMatch(/No components found/)
    expect(componentsFromSource('function Card() { return null }').warnings[0]).toMatch(/Card isn’t exported/)
  })

  it('blanks comments without moving anything', () => {
    const src = "a // b\n/* c\nd */ 'e // f'"
    const out = stripComments(src)
    expect(out).toHaveLength(src.length)
    expect(out.split('\n')).toHaveLength(3)
    expect(out).toContain("'e // f'")
    expect(out).not.toMatch(/[bcd]/)
  })
})
