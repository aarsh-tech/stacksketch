import type { Plugin, ViteDevServer } from 'vite'

import { componentFiles, readComponents } from './props'
import type { FindOptions } from './props'

export interface VariantsOptions extends FindOptions {
  /** where the canvas is served, default `/__variants` */
  path?: string
  /** default `['light', 'dark']` */
  themes?: string[]
  /** `class` (default) puts the theme name on each grid as a class; anything else is an attribute, like `data-theme` */
  themeAttribute?: string
  /** modules to import first, for global CSS and fonts: `['/src/index.css']` */
  setup?: string[]
  /** a module whose default export wraps every variant, for providers */
  wrapper?: string
}

const ID = 'virtual:stacksketch-variants'
const RESOLVED = '\0' + ID

/** The code of the canvas page: imports every component module and hands them to the canvas with their props. */
export function canvasModule(root: string, options: VariantsOptions = {}): string {
  const components = readComponents(componentFiles(root, options), root)
  const files = [...new Set(components.map((c) => c.file))]
  const lines = [
    `import { mountCanvas } from '@stacksketch/variants/mount'`,
    ...(options.setup ?? []).map((m) => `import ${JSON.stringify(m)}`),
    ...(options.wrapper ? [`import Wrapper from ${JSON.stringify(options.wrapper)}`] : []),
    ...files.map((f, i) => `import * as m${i} from ${JSON.stringify(f)}`),
    `const components = ${JSON.stringify(components, null, 2)}`,
    `const modules = { ${files.map((f, i) => `${JSON.stringify(f)}: m${i}`).join(', ')} }`,
    `mountCanvas(document.getElementById('stacksketch-variants'), {`,
    `  components: components.map((c) => ({ ...c, Component: modules[c.file]?.[c.exportName ?? c.name] })),`,
    `  themes: ${JSON.stringify(options.themes ?? ['light', 'dark'])},`,
    `  themeAttribute: ${JSON.stringify(options.themeAttribute ?? 'class')},`,
    ...(options.wrapper ? ['  Wrapper,'] : []),
    `})`,
  ]
  return lines.join('\n') + '\n'
}

/**
 * Vite plugin: serves a canvas at `/__variants` in dev with every component in
 * `src/` rendered as a grid of its prop combinations, per theme. Props come
 * from the components' TypeScript types; there's nothing to write by hand.
 */
export function stacksketchVariants(options: VariantsOptions = {}): Plugin {
  const path = options.path ?? '/__variants'
  let root = process.cwd()
  let server: ViteDevServer | undefined
  return {
    name: 'stacksketch-variants',
    apply: 'serve',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      return id === ID ? RESOLVED : undefined
    },
    load(id) {
      return id === RESOLVED ? canvasModule(root, options) : undefined
    },
    configureServer(s) {
      server = s
      s.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (url !== path && !url.startsWith(`${path}/`) && !url.startsWith(`${path}?`) && !url.startsWith(`${path}#`)) return next()
        const html = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Variants</title></head>
  <body style="margin:0"><div id="stacksketch-variants"></div><script type="module" src="/@id/__x00__${ID}"></script></body>
</html>`
        res.setHeader('Content-Type', 'text/html')
        res.end(await s.transformIndexHtml(url, html))
      })
      s.httpServer?.once('listening', () => {
        const address = s.resolvedUrls?.local[0]
        if (address) s.config.logger.info(`  Variants: ${address.replace(/\/$/, '')}${path}`)
      })
    },
    // a component's props may have changed: rebuild the page's list
    handleHotUpdate(ctx) {
      if (!ctx.file.endsWith('.tsx') || !server) return
      const mod = server.moduleGraph.getModuleById(RESOLVED)
      if (mod) server.moduleGraph.invalidateModule(mod)
    },
  }
}

export default stacksketchVariants
