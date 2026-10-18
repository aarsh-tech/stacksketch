import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

// node side (the plugins): typescript and vite stay the app's own
await build({ entryPoints: ['src/vite.ts', 'src/next.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outdir: 'dist', external: ['typescript', 'vite'], logLevel: 'warning' })
// browser side (the canvas): React stays the app's own, so the canvas renders with the same copy as the components
await build({ entryPoints: ['src/canvas.tsx', 'src/mount.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', outdir: 'dist', external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'], logLevel: 'warning' })

// type declarations, so an app's vite.config.ts or Next.js page type-checks. Core isn't published, so the
// core types the package uses (from core's variants/grid.ts) ship with it as dist/types/core.d.ts
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const run = (...args) => execFileSync(process.execPath, [tsc, ...args], { stdio: 'inherit' })
rmSync('dist/types', { recursive: true, force: true })
const tmp = join(tmpdir(), `stacksketch-variants-types-${process.pid}`)
run('../core/src/variants/grid.ts', '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler', '--rootDir', '../core/src', '--outDir', tmp)
mkdirSync('dist/types', { recursive: true })
copyFileSync(join(tmp, 'variants', 'grid.d.ts'), 'dist/types/core.d.ts')
rmSync(tmp, { recursive: true, force: true })
run('-p', 'tsconfig.types.json')
for (const f of readdirSync('dist/types').filter((n) => n.endsWith('.d.ts')))
  writeFileSync(
    join('dist/types', f),
    readFileSync(join('dist/types', f), 'utf8')
      .replaceAll(`'@stacksketch/core'`, `'./core.js'`)
      // relative imports get their extension, so the types resolve under nodenext too
      .replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'"),
  )
