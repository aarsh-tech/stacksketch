import { readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import ts from 'typescript'

import type { ComponentInfo, PropInfo, PropType } from '@stacksketch/core'

/**
 * Find React components and their props by reading TypeScript types: every
 * exported PascalCase function (or forwardRef / memo component) whose return
 * type is JSX. Props declared inside node_modules (all of a button's HTML
 * attributes) are left out, except `children` and `disabled`.
 */

export interface FindOptions {
  /** folders to look in, relative to `root` */
  dirs?: string[]
  /** files to skip */
  exclude?: RegExp[]
}

export const DEFAULT_EXCLUDE = [/\.(test|spec|stories)\.tsx$/, /(^|[\\/])main\.tsx$/, /(^|[\\/])(node_modules|dist|__variants)[\\/]/]

/** Every .tsx file under the folders, skipping `exclude`. */
export function componentFiles(root: string, options: FindOptions = {}): string[] {
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const path = join(dir, name)
      if (exclude.some((r) => r.test(path))) continue
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.tsx')) out.push(path)
    }
  }
  for (const d of options.dirs ?? ['src']) walk(join(root, d))
  return out.sort()
}

const KEEP_FROM_LIBS = new Set(['children', 'disabled'])

function propType(t: ts.Type, checker: ts.TypeChecker): PropType {
  const parts = (t.isUnion() ? t.types : [t]).filter((x) => !(x.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)))
  if (!parts.length) return { kind: 'other' }
  if (parts.every((x) => x.isStringLiteral())) return { kind: 'enum', values: parts.map((x) => (x as ts.StringLiteralType).value) }
  if (parts.every((x) => x.flags & (ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Boolean))) return { kind: 'boolean' }
  const text = checker.typeToString(t)
  if (/ReactNode|ReactElement|JSX\.Element|ReactPortal/.test(text)) return { kind: 'node' }
  if (parts.every((x) => x.getCallSignatures().length > 0)) return { kind: 'function' }
  if (parts.every((x) => x.flags & (ts.TypeFlags.NumberLike))) return { kind: 'number' }
  if (parts.every((x) => x.flags & ts.TypeFlags.StringLike)) return { kind: 'string' }
  return { kind: 'other' }
}

const isJsx = (text: string) => /Element|ReactNode|ReactElement|ReactPortal|^null$/.test(text)

/** Components exported by `files`, with their props. `root` makes the file paths the dev server imports (`/src/Button.tsx`). */
export function readComponents(files: string[], root: string): ComponentInfo[] {
  const program = ts.createProgram(files, {
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  })
  const checker = program.getTypeChecker()
  const out: ComponentInfo[] = []
  for (const file of files) {
    const sf = program.getSourceFile(file)
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf)
    if (!sf || !moduleSymbol) continue
    const path = '/' + relative(root, file).split(sep).join('/')
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const exportName = symbol.getName()
      const name = exportName === 'default' ? basename(file, '.tsx') : exportName
      if (!/^[A-Z]/.test(name)) continue
      const type = checker.getTypeOfSymbolAtLocation(symbol, sf)
      const signature = type.getCallSignatures()[0]
      if (!signature || signature.parameters.length > 2 || !isJsx(checker.typeToString(signature.getReturnType()))) continue
      const props: PropInfo[] = []
      const param = signature.parameters[0]
      if (param) {
        const propsType = checker.getTypeOfSymbolAtLocation(param, sf)
        for (const prop of propsType.getProperties()) {
          const fromLib = prop.declarations?.some((d) => d.getSourceFile().fileName.includes('node_modules')) ?? false
          if (fromLib && !KEEP_FROM_LIBS.has(prop.getName())) continue
          if (prop.getName() === 'ref' || prop.getName() === 'key') continue
          const t = checker.getTypeOfSymbolAtLocation(prop, sf)
          props.push({ name: prop.getName(), optional: Boolean(prop.flags & ts.SymbolFlags.Optional), type: propType(t, checker), text: checker.typeToString(t) })
        }
      }
      out.push({ name, file: path, props, ...(exportName === 'default' ? { exportName } : {}) })
    }
  }
  return out
}
