import { build } from 'esbuild'

// node side (the plugins): typescript and vite stay the app's own
await build({ entryPoints: ['src/vite.ts', 'src/next.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outdir: 'dist', external: ['typescript', 'vite'], logLevel: 'warning' })
// browser side (the canvas): React stays the app's own, so the canvas renders with the same copy as the components
await build({ entryPoints: ['src/canvas.tsx', 'src/mount.tsx'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', outdir: 'dist', external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'], logLevel: 'warning' })
