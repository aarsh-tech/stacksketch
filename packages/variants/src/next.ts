import { existsSync, mkdirSync, watch, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { componentFiles, readComponents } from './props'
import type { FindOptions } from './props'

export interface NextVariantsOptions extends FindOptions {
  /** default `['light', 'dark']` */
  themes?: string[]
  /** `class` (default) or an attribute name like `data-theme` */
  themeAttribute?: string
}

/** Where the generated page goes: the App Router if the project has one (`app/` or `src/app/`), else the Pages Router. */
export function pageFile(root: string): string {
  for (const dir of ['app', join('src', 'app')]) if (existsSync(join(root, dir))) return join(root, dir, '__variants', 'page.tsx')
  return join(root, existsSync(join(root, 'src', 'pages')) ? join('src', 'pages') : 'pages', '__variants.tsx')
}

/** The generated page: a client component that imports every component and renders the canvas. */
export function nextPage(root: string, options: NextVariantsOptions = {}): { file: string; code: string } {
  const file = pageFile(root)
  const components = readComponents(componentFiles(root, { dirs: ['src', 'components'], ...options }), root)
  const files = [...new Set(components.map((c) => c.file))]
  const importPath = (f: string) => {
    const rel = relative(dirname(file), join(root, f)).split(sep).join('/').replace(/\.tsx$/, '')
    return rel.startsWith('.') ? rel : `./${rel}`
  }
  const code = `'use client'
// Made by @stacksketch/variants while next dev runs. Don't edit it; add it to .gitignore.
import { VariantCanvas } from '@stacksketch/variants/canvas'
import type { CanvasComponent } from '@stacksketch/variants/canvas'
${files.map((f, i) => `import * as m${i} from ${JSON.stringify(importPath(f))}`).join('\n')}

const components: Omit<CanvasComponent, 'Component'>[] = ${JSON.stringify(components, null, 2)}
const modules: Record<string, Record<string, unknown>> = { ${files.map((f, i) => `${JSON.stringify(f)}: m${i}`).join(', ')} }

export default function Variants() {
  return (
    <VariantCanvas
      components={components.map((c) => ({ ...c, Component: modules[c.file]?.[c.exportName ?? c.name] as CanvasComponent['Component'] }))}
      themes={${JSON.stringify(options.themes ?? ['light', 'dark'])}}
      themeAttribute=${JSON.stringify(options.themeAttribute ?? 'class')}
    />
  )
}
`
  return { file, code }
}

function write(root: string, options: NextVariantsOptions) {
  const { file, code } = nextPage(root, options)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, code)
  return file
}

type NextConfig = Record<string, unknown>
type ConfigFn = (phase: string, ctx: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>

/**
 * Next.js: wrap the config, and while `next dev` runs a page at `/__variants`
 * renders every component in `src/` and `components/` as a grid of its prop
 * combinations. The page is rewritten when a component changes.
 */
export function withStacksketchVariants(config: NextConfig | ConfigFn = {}, options: NextVariantsOptions = {}): ConfigFn {
  return async (phase, ctx) => {
    if (phase === 'phase-development-server') {
      const root = process.cwd()
      const file = write(root, options)
      console.log(`  Variants: /__variants (${relative(root, file)})`)
      let timer: NodeJS.Timeout | undefined
      for (const dir of options.dirs ?? ['src', 'components'])
        if (existsSync(join(root, dir)))
          watch(join(root, dir), { recursive: true }, (_event, name) => {
            if (!name?.endsWith('.tsx') || name.includes('__variants')) return
            clearTimeout(timer)
            timer = setTimeout(() => write(root, options), 200)
          })
    }
    return typeof config === 'function' ? config(phase, ctx) : config
  }
}

export default withStacksketchVariants
