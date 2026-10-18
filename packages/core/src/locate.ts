import { schemaName } from './generate/zod'

/** The generated outputs that declare one block per type. `zod` also covers Valibot and Yup, which use the same names. */
export type DeclarationLanguage = 'typescript' | 'zod' | 'jsonschema' | 'pydantic' | 'go'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function startPattern(name: string, language: DeclarationLanguage): RegExp {
  switch (language) {
    case 'typescript':
      return new RegExp(`^export (interface|type) ${escape(name)}\\b`)
    case 'zod':
      return new RegExp(`^export const ${escape(schemaName(name))}\\b`)
    case 'jsonschema':
      // an entry of $defs, which toJsonSchema indents by four spaces
      return new RegExp(`^ {4}${escape(JSON.stringify(name))}: \\{`)
    case 'pydantic':
      return new RegExp(`^class ${escape(name)}\\(`)
    case 'go':
      return new RegExp(`^type ${escape(name)} `)
  }
}

/** Net bracket depth change of a line, ignoring brackets inside quotes. */
function depthChange(line: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
  }
  return depth
}

/**
 * Where a type is declared in generated code, as 1-based inclusive lines,
 * or null when the output has no declaration for it. A Zod block includes
 * the `z.infer` type line that follows it.
 */
export function findDeclaration(code: string, typeName: string, language: DeclarationLanguage): { from: number; to: number } | null {
  const lines = code.split('\n')
  const start = startPattern(typeName, language)
  const from = lines.findIndex((l) => start.test(l))
  if (from < 0) return null
  if (language === 'pydantic') {
    // a class runs on while lines are indented (a blank line inside it is followed by an indented one)
    let to = from
    for (let i = from + 1; i < lines.length && (/^\s/.test(lines[i]) || (lines[i] === '' && /^\s/.test(lines[i + 1] ?? ''))); i++) to = i
    return { from: from + 1, to: to + 1 }
  }
  let depth = 0
  let to = from
  for (let i = from; i < lines.length; i++) {
    depth += depthChange(lines[i])
    to = i
    if (depth <= 0) break
  }
  if (language === 'zod' && lines[to + 1]?.startsWith(`export type ${typeName} =`)) to++
  return { from: from + 1, to: to + 1 }
}
