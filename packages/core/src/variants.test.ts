import { describe, expect, it } from 'vitest'

import { cellCount, defaultArgs, defaultAxes, variantGrid } from './index'
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
