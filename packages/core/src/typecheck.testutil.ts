/// <reference types="node" />
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Type-check virtual files with the real compiler, resolving packages from this package's node_modules.
 * `extra` options add to the defaults, e.g. the stricter settings of a fresh Vite app.
 */
export function typecheck(files: Record<string, string>, extra: ts.CompilerOptions = {}): string[] {
  const dir = fileURLToPath(new URL('./__tsc__/', import.meta.url)).replace(/\\/g, '/')
  const virtual = new Map(Object.entries(files).map(([name, code]) => [dir + name, code]))
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    skipLibCheck: true,
    types: [],
    jsx: ts.JsxEmit.ReactJSX,
    ...extra,
  }
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, lang, ...rest) => (virtual.has(name) ? ts.createSourceFile(name, virtual.get(name) as string, lang) : getSourceFile.call(host, name, lang, ...rest))
  host.fileExists = (name) => virtual.has(name) || fileExists.call(host, name)
  host.directoryExists = (name) => [...virtual.keys()].some((f) => f.startsWith(`${name.replace(/\/$/, '')}/`)) || ts.sys.directoryExists(name)
  host.readFile = (name) => virtual.get(name) ?? readFile.call(host, name)
  const program = ts.createProgram([...virtual.keys()], options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName.slice(dir.length) ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
}
