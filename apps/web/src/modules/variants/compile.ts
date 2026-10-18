import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'

/**
 * Turn one pasted .tsx file into its exports, in the page: sucrase strips the
 * types and JSX (it's small, and loaded only when the variant canvas opens),
 * then the code runs with React, clsx and CSS imports provided.
 */

type Sucrase = typeof import('sucrase')
let loading: Promise<Sucrase> | null = null
export const loadSucrase = () => (loading ??= import('sucrase'))

/** clsx and classnames, which components often use for their class names */
function classNames(...args: unknown[]): string {
  const out: string[] = []
  for (const a of args) {
    if (!a) continue
    if (typeof a === 'string' || typeof a === 'number') out.push(String(a))
    else if (Array.isArray(a)) out.push(classNames(...a))
    else if (typeof a === 'object') for (const [k, v] of Object.entries(a)) if (v) out.push(k)
  }
  return out.join(' ')
}

const MODULES: Record<string, unknown> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  'react-dom': ReactDOM,
  clsx: { __esModule: true, default: classNames, clsx: classNames },
  classnames: { __esModule: true, default: classNames },
}

export type Compiled = { ok: true; exports: Record<string, unknown> } | { ok: false; stage: 'compile' | 'run'; message: string }

export function compileComponents(sucrase: Sucrase, source: string): Compiled {
  let code: string
  try {
    code = sucrase.transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: 'Component.tsx' }).code
  } catch (e) {
    return { ok: false, stage: 'compile', message: e instanceof Error ? e.message : String(e) }
  }
  const module = { exports: {} as Record<string, unknown> }
  const require = (name: string) => {
    if (name in MODULES) return MODULES[name]
    if (/\.(css|scss|sass|less)$/.test(name)) return {}
    throw new Error(`"${name}" can’t be loaded here. The workbench provides react, clsx and classnames; put the styles in the CSS tab and paste anything else the component needs into the same file. The Vite plugin renders components with all their imports.`)
  }
  try {
    // the user's own code, run on purpose: that's what a variant canvas does
    new Function('require', 'module', 'exports', 'React', code)(require, module, module.exports, React)
  } catch (e) {
    return { ok: false, stage: 'run', message: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, exports: module.exports }
}
