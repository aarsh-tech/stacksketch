import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { variantGrid } from '@stacksketch/core'
import { nextPage } from './next'
import { componentFiles, readComponents } from './props'
import { canvasModule } from './vite'

const root = fileURLToPath(new URL('../fixture', import.meta.url))

describe('reading components', () => {
  const components = readComponents(componentFiles(root), root)

  it('finds exported components, named and default, and skips the rest', () => {
    expect(components.map((c) => [c.name, c.file, c.exportName])).toEqual([
      ['Badge', '/src/components/Badge.tsx', 'default'],
      ['Button', '/src/components/Button.tsx', undefined],
    ])
  })

  it('reads each prop’s kind from its type, leaving out HTML attributes', () => {
    const button = components[1]
    expect(button.props.map((p) => [p.name, p.type.kind, p.optional])).toEqual([
      ['size', 'enum', true],
      ['variant', 'enum', false],
      ['loading', 'boolean', true],
      ['icon', 'node', true],
      ['children', 'node', false],
      ['onPress', 'function', true],
      ['disabled', 'boolean', true],
    ])
    expect(button.props[0].type).toEqual({ kind: 'enum', values: ['sm', 'md', 'lg'] })
    expect(components[0].props.map((p) => [p.name, p.type.kind])).toEqual([
      ['tone', 'enum'],
      ['count', 'number'],
      ['label', 'string'],
    ])
  })

  it('lays sizes across and kinds down, with the props needed to render', () => {
    const grid = variantGrid(components[1], { columns: 'size', rows: 'variant' })
    expect(grid.columns?.labels).toEqual(['default', 'sm', 'md', 'lg'])
    expect(grid.rows?.labels).toEqual(['primary', 'outline', 'ghost'])
    expect(grid.args(1, 3)).toEqual({ variant: 'outline', size: 'lg', children: 'Button' })
    expect(grid.args(0, 0)).toEqual({ variant: 'primary', children: 'Button' })
  })

  it('writes the Vite page module and the Next.js page', () => {
    const code = canvasModule(root, { setup: ['/src/theme.css'] })
    expect(code).toContain(`import "/src/theme.css"`)
    expect(code).toContain(`import * as m1 from "/src/components/Button.tsx"`)
    const page = nextPage(root)
    expect(page.file.replace(/\\/g, '/')).toMatch(/fixture\/pages\/__variants\.tsx$/)
    expect(page.code).toContain(`import * as m0 from "../src/components/Badge"`)
    expect(page.code.startsWith(`'use client'`)).toBe(true)
  })
})
