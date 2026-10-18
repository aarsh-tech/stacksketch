export type ParseResult = { ok: true; value: unknown } | { ok: false; message: string; line?: number; column?: number }

class JsonError extends Error {
  readonly index: number
  constructor(message: string, index: number) {
    super(message)
    this.index = index
  }
}

/**
 * A small validating scanner, used only after JSON.parse has failed, because
 * browsers disagree on whether (and how) their messages give a position.
 */
function locate(text: string): JsonError | null {
  let i = 0
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++
  }
  const show = (c: string | undefined) => (c === undefined ? 'end of input' : `'${c}'`)
  const fail = (msg: string): never => {
    throw new JsonError(msg, i)
  }

  const string = () => {
    i++ // opening quote
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i++
        return
      }
      if (c === '\\') {
        i++
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail('Bad \\u escape: it needs four hex digits')
          i += 5
        } else if ('"\\/bfnrt'.includes(text[i] ?? '')) i++
        else fail(`Unknown escape \\${text[i] ?? ''}`)
        continue
      }
      if (c === '\n') fail('Unterminated string: strings cannot span lines')
      i++
    }
    fail('Unterminated string')
  }

  const value = (): void => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') return void i++
      for (;;) {
        ws()
        if (text[i] !== '"') fail(text[i] === "'" ? 'Use double quotes for property names' : text[i] === '}' ? "Trailing comma before '}'" : `Expected a property name in double quotes, found ${show(text[i])}`)
        string()
        ws()
        if (text[i] !== ':') fail(`Expected ':' after the property name, found ${show(text[i])}`)
        i++
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === '}') return void i++
        fail(text[i] === '"' ? 'Missing comma between properties' : `Expected ',' or '}', found ${show(text[i])}`)
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') return void i++
      for (;;) {
        ws()
        if (text[i] === ']') fail("Trailing comma before ']'")
        value()
        ws()
        if (text[i] === ',') {
          i++
          continue
        }
        if (text[i] === ']') return void i++
        fail(`Expected ',' or ']', found ${show(text[i])}`)
      }
    }
    if (c === '"') return string()
    if (c === "'") fail('Use double quotes for strings')
    const lit = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i))
    if (lit) {
      i += lit[0].length
      return
    }
    if (c === undefined) fail('Unexpected end of input: something is missing at the end')
    if (/[A-Za-z_]/.test(c)) fail(/^(undefined|NaN|Infinity)/.test(text.slice(i)) ? `${/^\w+/.exec(text.slice(i))?.[0]} is not valid JSON` : 'Unquoted text: strings and property names need double quotes')
    fail(`Unexpected ${show(c)}`)
  }

  try {
    value()
    ws()
    if (i < text.length) fail(`Unexpected ${show(text[i])} after the end of the JSON value`)
    return null
  } catch (e) {
    return e instanceof JsonError ? e : null
  }
}

/** JSON.parse with an error that says what is wrong and where, in 1-based line and column. */
export function parseJson(text: string): ParseResult {
  if (!text.trim()) return { ok: false, message: 'Paste a JSON response to get started.' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    const err = locate(text)
    if (!err) return { ok: false, message: e instanceof Error ? e.message : String(e) }
    const before = text.slice(0, err.index).split('\n')
    return { ok: false, message: err.message, line: before.length, column: before[before.length - 1].length + 1 }
  }
}
