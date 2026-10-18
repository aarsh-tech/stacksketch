/**
 * JSON values as YAML, for exporting OpenAPI documents. Only what JSON can
 * hold: strings are written plain when that's unambiguous and double-quoted
 * (JSON style, which YAML reads the same way) otherwise.
 */

// plain when it can't be read as anything but a string: no indicators, colons, hashes or leading digits
const PLAIN = /^[A-Za-z_/$][A-Za-z0-9 _/$.()+,;=@~'-]*$/
const RESERVED = /^(true|false|yes|no|on|off|null|y|n|~)$/i

function str(s: string): string {
  return PLAIN.test(s) && !RESERVED.test(s) && !s.endsWith(' ') ? s : JSON.stringify(s)
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return str(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return '[]'
  return '{}'
}

const isBlock = (v: unknown) => typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)

function lines(v: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const out: string[] = []
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!isBlock(item)) {
        out.push(`${pad}- ${scalar(item)}`)
        continue
      }
      // the item's own block, with its first line moved up onto the dash
      const inner = lines(item, indent + 2)
      inner[0] = `${pad}- ${inner[0].slice(indent + 2)}`
      out.push(...inner)
    }
    return out
  }
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (value === undefined) continue
    if (isBlock(value)) out.push(`${pad}${str(key)}:`, ...lines(value, indent + 2))
    else out.push(`${pad}${str(key)}: ${scalar(value)}`)
  }
  return out
}

export function toYaml(value: unknown): string {
  return isBlock(value) ? lines(value, 0).join('\n') + '\n' : scalar(value) + '\n'
}
