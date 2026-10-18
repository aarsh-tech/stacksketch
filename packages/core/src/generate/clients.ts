import { pascalCase } from '../names'
import type { Schema } from '../types'
import { BODY_NOTE, endpoint, fetchFunction } from './fetch'
import type { FetchOptions } from './fetch'

/** The same endpoint as `toFetch`, called with Axios. Axios throws on non-2xx statuses itself. */
export function toAxios(schema: Schema, options: FetchOptions = {}): string {
  const e = endpoint(schema, options)
  const verb = e.method.toLowerCase()
  const args = [...e.paramArgs, ...(e.hasBody ? ['body: unknown'] : []), 'config?: AxiosRequestConfig']
  const call = e.hasBody ? `axios.${verb}(${e.url.expr}, body, config)` : `axios.${verb}(${e.url.expr}, config)`
  const body = e.validate
    ? `  const { data } = await ${call}\n  return ${e.parse('data')}`
    : `  const { data } = await ${call.replace(`axios.${verb}(`, `axios.${verb}<${e.type}>(`)}\n  return data`
  return [
    `import axios from 'axios'`,
    `import type { AxiosRequestConfig } from 'axios'`,
    e.importLine,
    ...(e.hasBody ? ['', BODY_NOTE] : []),
    '',
    `export async function ${e.fn}(${args.join(', ')}): Promise<${e.type}> {\n${body}\n}`,
    '',
  ].join('\n')
}

/**
 * A TanStack Query v5 hook around the fetch function: `useQuery` for GET,
 * `useMutation` for everything else.
 */
export function toQueryHook(schema: Schema, options: FetchOptions = {}): string {
  const e = endpoint(schema, options)
  const params = e.url.params
  let hook: string
  if (e.method === 'GET') {
    const name = `use${e.fn.replace(/^get(?=[A-Z])/, '')}`
    const key = e.url.keyParts.length ? e.url.keyParts.join(', ') : `'${e.fn}'`
    hook = `export function ${name === 'use' ? 'useResource' : name}(${e.paramArgs.join(', ')}) {
  return useQuery({
    queryKey: [${key}] as const,
    queryFn: ({ signal }) => ${e.fn}(${[...params, '{ signal }'].join(', ')}),
  })
}`
  } else {
    const vars = [...params, ...(e.hasBody ? ['body'] : [])]
    const types = [...e.paramArgs, ...(e.hasBody ? ['body: unknown'] : [])]
    const fn =
      vars.length === 0
        ? `() => ${e.fn}()`
        : vars.length === 1
          ? `(${types[0]}) => ${e.fn}(${vars[0]})`
          : `({ ${vars.join(', ')} }: { ${types.join('; ')} }) => ${e.fn}(${vars.join(', ')})`
    hook = `export function use${pascalCase(e.fn)}() {
  return useMutation({
    mutationFn: ${fn},
  })
}`
  }
  return [
    `import { ${e.method === 'GET' ? 'useQuery' : 'useMutation'} } from '@tanstack/react-query'`,
    e.importLine,
    ...(e.hasBody ? ['', BODY_NOTE] : []),
    '',
    fetchFunction(e),
    hook,
    '',
  ].join('\n')
}
