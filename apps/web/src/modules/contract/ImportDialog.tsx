import { useRef, useState } from 'react'
import { FileUp, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { fromOpenApi, parseJson } from '@stacksketch/core'
import type { OpenApiImport } from '@stacksketch/core'
import { Button, Dialog, inputClass } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { uid, useContract } from '@/store/contract'

/** JSON or YAML text as a value. YAML's parser only loads when it's needed. */
async function readDocument(text: string): Promise<unknown> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Paste an OpenAPI document or open a file first.')
  if (trimmed.startsWith('{')) {
    const r = parseJson(trimmed)
    if (!r.ok) throw new Error(r.line ? `${r.message} (line ${r.line}, column ${r.column}).` : r.message)
    return r.value
  }
  const { parse, YAMLParseError } = await import('yaml')
  try {
    return parse(trimmed)
  } catch (e) {
    if (e instanceof YAMLParseError) {
      const at = e.linePos?.[0]
      throw new Error(`This isn’t valid YAML${at ? ` (line ${at.line}, column ${at.col})` : ''}: ${e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')}.`)
    }
    throw e
  }
}

/** Read an OpenAPI 3.0 or 3.1 file (or pasted text) and replace the contract with it. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const contract = useContract((s) => s.contract)
  const replace = useContract((s) => s.replace)
  const selected = useContract((s) => s.selected)
  const [text, setText] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [result, setResult] = useState<OpenApiImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const read = async (source: string) => {
    setReading(true)
    setError(null)
    setResult(null)
    try {
      setResult(fromOpenApi(await readDocument(source), uid))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }

  const open = async (f: File | undefined) => {
    if (!f) return
    const content = await f.text()
    setName(f.name)
    setText(content)
    await read(content)
  }

  const apply = () => {
    if (!result) return
    const before = contract
    const beforeSelected = selected
    const first = result.contract.endpoints[0]
    replace(result.contract, first ? { kind: 'endpoint', id: first.id } : { kind: 'contract' })
    onClose()
    toast.success(`Imported ${result.contract.title}`, {
      description: `${result.contract.endpoints.length} endpoints and ${result.contract.types.length} types${result.warnings.length ? `, with ${result.warnings.length} ${result.warnings.length === 1 ? 'thing' : 'things'} simplified` : ''}.`,
      action: { label: 'Undo', onClick: () => replace(before, beforeSelected) },
    })
  }

  const c = result?.contract
  return (
    <Dialog
      title="Import an OpenAPI file"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {c ? (
            <Button variant="primary" onClick={apply}>
              Replace the contract with {c.title}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => read(text)} disabled={reading || !text.trim()}>
              {reading ? 'Reading…' : 'Read it'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink-2">
          OpenAPI 3.0 or 3.1, as YAML or JSON. It's read here in your browser; nothing is uploaded. It replaces the contract you have now, and you can undo that.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            <FileUp size={13} />
            Open a file
          </Button>
          <input ref={file} type="file" accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml" className="hidden" onChange={(e) => open(e.target.files?.[0])} />
          <span className="truncate text-[12px] text-ink-3">{name ?? 'or paste it below'}</span>
        </div>
        <textarea
          aria-label="OpenAPI document"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setName(null)
            setResult(null)
            setError(null)
          }}
          placeholder={'openapi: 3.1.0\ninfo:\n  title: My API\n  version: 1.0.0\npaths:\n  /orders:\n    get: …'}
          rows={9}
          className={cx(inputClass, 'h-auto w-full resize-y py-1.5 font-mono text-[12px] leading-snug')}
        />
        {error ? (
          <p role="alert" className="flex items-start gap-1.5 text-[12.5px] text-danger">
            <TriangleAlert size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}
        {c ? (
          <div className="rounded-md border border-line bg-panel px-3 py-2.5 text-[12.5px]">
            <p className="font-medium text-ink">
              {c.title} <span className="font-mono text-ink-3">{c.apiVersion}</span>
            </p>
            <p className="text-ink-2">
              {c.endpoints.length} {c.endpoints.length === 1 ? 'endpoint' : 'endpoints'} and {c.types.length} {c.types.length === 1 ? 'type' : 'types'}
              {c.baseUrl ? (
                <>
                  , at <span className="font-mono">{c.baseUrl}</span>
                </>
              ) : null}
              .
            </p>
            {result.warnings.length ? (
              <>
                <p className="mt-2.5 font-medium text-ink-2">Simplified or left out</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
