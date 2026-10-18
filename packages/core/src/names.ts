const IDENT = /^[A-Za-z_$][\w$]*$/

/** "created_at" / "created-at" / "createdAt" → "CreatedAt"; never empty, never starts with a digit. */
export function pascalCase(input: string): string {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const out = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (!out) return 'Item'
  return /^\d/.test(out) ? `T${out}` : out
}

export function camelCase(input: string): string {
  const p = pascalCase(input)
  // keep leading acronyms readable: "URLList" → "urlList", "ID" → "id"
  const m = /^[A-Z]+(?=[A-Z][a-z]|\d|$)/.exec(p)
  if (m) return m[0].toLowerCase() + p.slice(m[0].length)
  return p[0].toLowerCase() + p.slice(1)
}

const IRREGULAR: Record<string, string> = {
  children: 'child',
  people: 'person',
  men: 'man',
  women: 'woman',
  data: 'datum',
  media: 'medium',
  criteria: 'criterion',
}

/** A good-enough English singular for naming the items of an array. */
export function singular(word: string): string {
  const lower = word.toLowerCase()
  const irregular = IRREGULAR[lower]
  if (irregular) return lower === word ? irregular : irregular[0].toUpperCase() + irregular.slice(1)
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + (word.endsWith('IES') ? 'Y' : 'y')
  if (/(ss|x|ch|sh|zz)es$/i.test(word)) return word.slice(0, -2)
  if (/(ss|us|is)$/i.test(word)) return word
  if (/s$/i.test(word) && word.length > 2) return word.slice(0, -1)
  return word
}

/** The name for the items of an array called `name`, e.g. "users" → "User", "info" → "InfoItem". */
export function itemName(name: string): string {
  const pascal = pascalCase(name)
  // singularise the last word only: "OrderLines" → "OrderLine"
  const m = /^(.*?)([A-Z][a-z0-9]*|[A-Z0-9]+)$/.exec(pascal)
  const [head, last] = m ? [m[1], m[2]] : ['', pascal]
  const one = singular(last)
  if (one === last || /datum|medium/i.test(one)) return `${pascal}Item`
  return head + one
}

/** An object key as it must appear in TypeScript / JavaScript source. */
export function propertyKey(key: string): string {
  return IDENT.test(key) ? key : JSON.stringify(key)
}

export function isIdentifier(s: string): boolean {
  return IDENT.test(s)
}
