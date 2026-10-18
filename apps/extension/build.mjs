import { build } from 'esbuild'

// content scripts can't be ES modules, so the content script and service worker are single IIFE files
for (const name of ['content', 'background'])
  await build({ entryPoints: [`src/${name}.ts`], bundle: true, format: 'iife', target: 'chrome116', outfile: `dist/${name}.js`, logLevel: 'warning' })
