import { build } from 'esbuild'

// one file with no dependencies, so npx starts it straight away; yaml is CommonJS and needs require in an ES module
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/cli.js',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)" },
  logLevel: 'warning',
})
