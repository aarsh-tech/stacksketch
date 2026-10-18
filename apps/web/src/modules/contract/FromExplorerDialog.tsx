import { useMemo, useState } from 'react'
import { ArrowRight, Braces, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import { addSchemaEndpoint, applyOverrides, contractProblems, HTTP_METHODS } from '@stacksketch/core'
import type { HttpMethod } from '@stacksketch/core'
import { Button, Dialog, Labeled, Select, TextInput } from '@/components/ui/primitives'
import { useInference } from '@/modules/api-explorer/inference/useInference'
import { useExplorer } from '@/store/explorer'
import { uid, useContract } from '@/store/contract'
import { useUi } from '@/store/ui'

/** Add the API explorer's response (with the user's schema edits) to the contract as an endpoint. */
export function FromExplorerDialog({ onClose }: { onClose: () => void }) {
  const samples = useExplorer((s) => s.samples)
  const rootName = useExplorer((s) => s.rootName)
  const overrides = useExplorer((s) => s.overrides)
  const explorerMethod = useExplorer((s) => s.method)
  const explorerUrl = useExplorer((s) => s.url)
  const contract = useContract((s) => s.contract)
  const replace = useContract((s) => s.replace)
  const setModule = useUi((s) => s.setModule)
  const { schema: inferred, pending } = useInference(samples, rootName)
  const schema = useMemo(() => (inferred ? applyOverrides(inferred, overrides) : null), [inferred, overrides])
  const [method, setMethod] = useState<HttpMethod>(explorerMethod)
  const [url, setUrl] = useState(explorerUrl)
  const [id] = useState(uid)

  const added = useMemo(() => (schema ? addSchemaEndpoint(contract, schema, { id, method, url }) : null), [schema, contract, id, method, url])
  const endpoint = added?.contract.endpoints.find((e) => e.id === id)
  const newTypes = added ? added.contract.types.slice(contract.types.length).map((t) => t.name) : []
  const problems = useMemo(
    () => (added ? contractProblems(added.contract).filter((p) => p.target.kind === 'endpoint' && p.target.id === id).map((p) => p.message) : []),
    [added, id],
  )

  const add = () => {
    if (!added || !endpoint) return
    const before = contract
    const selected = useContract.getState().selected
    replace(added.contract, { kind: 'endpoint', id })
    onClose()
    toast.success(`Added ${endpoint.method} ${endpoint.path}`, {
      description: added.renamed.length ? `Renamed ${added.renamed.map(([a, b]) => `${a} to ${b}`).join(', ')}, since the contract already had different types with those names.` : undefined,
      action: { label: 'Undo', onClick: () => replace(before, selected) },
    })
  }

  return (
    <Dialog
      title="Add an endpoint from the API explorer"
      onClose={onClose}
      footer={
        schema ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={add}>
              Add {method} {endpoint?.path ?? ''}
            </Button>
          </>
        ) : null
      }
    >
      {!schema ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Braces size={20} className="text-ink-3" />
          <p className="max-w-sm text-[13px] text-ink-2">
            {pending ? 'Reading the API explorer’s samples…' : 'The API explorer doesn’t have a valid JSON response yet. Paste one there, then come back to add it as an endpoint.'}
          </p>
          {pending ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onClose()
                setModule('api-explorer')
              }}
            >
              Open the API explorer
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            The response becomes the endpoint's {method === 'POST' ? '201' : '200'} body, and its types join the contract's. Query keys in the URL become query params.
          </p>
          <div className="flex gap-1.5">
            <Labeled label="Method" className="w-24 shrink-0">
              <Select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="w-full font-mono">
                {HTTP_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Labeled>
            <Labeled label="URL" className="flex-1">
              <TextInput value={url} onChange={(e) => setUrl(e.target.value)} className="w-full font-mono" placeholder="https://api.example.com/v1/orders" />
            </Labeled>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-3">Path</dt>
            <dd className="truncate font-mono text-ink">{endpoint?.path}</dd>
            <dt className="text-ink-3">Base URL</dt>
            <dd className="truncate font-mono text-ink">{added?.contract.baseUrl || <span className="font-sans text-ink-3">none yet</span>}</dd>
            <dt className="text-ink-3">Response</dt>
            <dd className="truncate font-mono text-t-ref">{schema.rootName}</dd>
            {newTypes.length ? (
              <>
                <dt className="text-ink-3">New types</dt>
                <dd className="font-mono text-ink-2">{newTypes.join(', ')}</dd>
              </>
            ) : null}
            {added?.reused.length ? (
              <>
                <dt className="text-ink-3">Reused</dt>
                <dd className="font-mono text-ink-2">{added.reused.join(', ')}</dd>
              </>
            ) : null}
            {added?.renamed.length ? (
              <>
                <dt className="text-ink-3">Renamed</dt>
                <dd className="text-ink-2">
                  {added.renamed.map(([a, b]) => (
                    <span key={a} className="mr-2 font-mono">
                      {a} → {b}
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
          {problems.length ? (
            <div role="status" className="flex gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
              <p>
                {problems.join(' ')} Change the method or URL, or fix it after adding: until then it's left out of the code.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
