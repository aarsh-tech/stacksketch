import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Download, Plus, Trash2, TriangleAlert, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'

import { flowSequence, openApiPath, resourceGroups, statusText, stepStatuses, toMermaid, toSequenceSvg } from '@stacksketch/core'
import type { Flow, SvgPalette } from '@stacksketch/core'
import { CodeView } from '@/components/CodeView'
import { Button, Group, IconButton, Labeled, Segmented, Select, Tabs, TextInput } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { copyText, downloadText } from '@/lib/download'
import { useContract } from '@/store/contract'
import { activeFlowOf, uid, useFlows } from '@/store/flows'
import type { FlowsMobilePane } from '@/store/flows'
import { useUi } from '@/store/ui'

/** Draw inline with the theme's own colours, so the diagram follows light and dark. */
const THEMED: SvgPalette = {
  background: 'var(--c-panel)',
  ink: 'var(--c-ink)',
  muted: 'var(--c-ink-2)',
  line: 'var(--c-line-strong)',
  box: 'var(--c-raised)',
  accent: 'var(--c-accent)',
  error: 'var(--c-danger)',
  font: "'Schibsted Grotesk Variable', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, Menlo, monospace",
}

/** The same colours, resolved, for an SVG file that has to stand on its own. */
function resolvedPalette(): SvgPalette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { ...THEMED, background: v('--c-panel'), ink: v('--c-ink'), muted: v('--c-ink-2'), line: v('--c-line-strong'), box: v('--c-raised'), accent: v('--c-accent'), error: v('--c-danger') }
}

const fileName = (flow: Flow) =>
  (flow.name || 'flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'flow'

export default function Flows() {
  const flow = useFlows(activeFlowOf)
  const flows = useFlows((s) => s.flows)
  const view = useFlows((s) => s.view)
  const mobilePane = useFlows((s) => s.mobilePane)
  const set = useFlows((s) => s.set)
  const update = useFlows((s) => s.update)
  const addFlow = useFlows((s) => s.addFlow)
  const replaceFlows = useFlows((s) => s.replaceFlows)
  const contract = useContract((s) => s.contract)
  const setModule = useUi((s) => s.setModule)
  const [copied, setCopied] = useState(false)

  const groups = useMemo(() => resourceGroups(contract), [contract])
  const { problems } = useMemo(() => flowSequence(flow, contract), [flow, contract])
  const svg = useMemo(() => toSequenceSvg(flow, contract, THEMED), [flow, contract])
  const mermaid = useMemo(() => toMermaid(flow, contract), [flow, contract])

  const setStep = (i: number, patch: Partial<Flow['steps'][number]>) => update((f) => ({ ...f, steps: f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const move = (i: number, by: number) =>
    update((f) => {
      const steps = [...f.steps]
      const [s] = steps.splice(i, 1)
      steps.splice(i + by, 0, s)
      return { ...f, steps }
    })

  const newFlow = () => {
    addFlow({ id: uid(), name: `Flow ${flows.length + 1}`, steps: [] })
    set({ mobilePane: 'steps' })
  }
  const deleteFlow = () => {
    const before = flows
    const active = flow.id
    const rest = flows.filter((f) => f.id !== flow.id)
    const next = rest.length ? rest : [{ id: uid(), name: 'Flow 1', steps: [] }]
    replaceFlows(next, next[0].id)
    toast.success(`Deleted ${flow.name || 'the flow'}`, { action: { label: 'Undo', onClick: () => replaceFlows(before, active) } })
  }

  const copyMermaid = async () => {
    try {
      await copyText(mermaid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
      toast.success('Copied the Mermaid diagram', { description: 'Paste it in a ```mermaid block: GitHub and most docs tools draw it.' })
    } catch {
      toast.error('Couldn’t copy', { description: 'Your browser blocked clipboard access. Select the text and copy it by hand.' })
    }
  }

  const show = (pane: FlowsMobilePane) => (mobilePane === pane ? 'flex' : 'max-xl:hidden')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line bg-panel px-3 py-2 xl:hidden">
        <Segmented
          label="Pane"
          className="w-full max-w-md"
          value={mobilePane}
          onChange={(p) => set({ mobilePane: p })}
          options={[
            { value: 'list', label: 'Flows' },
            { value: 'steps', label: 'Steps' },
            { value: 'diagram', label: 'Diagram' },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-px bg-line xl:grid-cols-[15rem_minmax(0,0.9fr)_minmax(0,1.3fr)]">
        <section className={cx('relative min-h-0 min-w-0 flex-col bg-panel', show('list'), 'xl:flex')} aria-label="Flows">
          <div className="absolute inset-0 overflow-y-auto px-3 py-3 scrollbar-thin">
            <p className="px-1 pb-1.5 text-[11.5px] font-medium text-ink-3">Flows</p>
            <ul className="space-y-px">
              {flows.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    aria-current={f.id === flow.id ? 'true' : undefined}
                    onClick={() => set({ activeFlow: f.id, mobilePane: 'steps' })}
                    className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]', f.id === flow.id ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}
                  >
                    <Workflow size={14} className={cx('shrink-0', f.id === flow.id ? 'text-accent' : 'text-ink-3')} />
                    <span className="flex-1 truncate">{f.name || 'Untitled flow'}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">{f.steps.length}</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" className="mt-2 w-full" onClick={newFlow}>
              <Plus size={13} />
              New flow
            </Button>
            <p className="mt-4 px-1 text-[11.5px] leading-snug text-ink-3">Steps are endpoints from the API contract. Change the contract and the diagrams follow.</p>
          </div>
        </section>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('steps'), 'xl:flex')} aria-label="Steps">
          <header className="flex h-10 shrink-0 items-center border-b border-line px-3.5">
            <h2 className="truncate text-[13px] font-semibold">{flow.name || 'Untitled flow'}</h2>
          </header>
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0 overflow-y-auto scrollbar-thin">
              {problems.length ? (
                <ul className="mx-4 mt-3.5 space-y-1 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
                  {problems.map((p) => (
                    <li key={p} className="flex gap-1.5">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                      {p}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Group title="Flow">
                <Labeled label="Name">
                  <TextInput value={flow.name} onChange={(e) => update((f) => ({ ...f, name: e.target.value }))} className="w-full" />
                </Labeled>
                <Labeled label="Description">
                  <TextInput value={flow.description ?? ''} onChange={(e) => update((f) => ({ ...f, description: e.target.value || undefined }))} className="w-full" />
                </Labeled>
              </Group>
              <Group
                title={`Steps (${flow.steps.length})`}
                aside={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!contract.endpoints.length}
                    onClick={() => update((f) => ({ ...f, steps: [...f.steps, { id: uid(), endpointId: contract.endpoints[0].id }] }))}
                  >
                    <Plus size={13} />
                    Add a step
                  </Button>
                }
              >
                {!contract.endpoints.length ? (
                  <div className="space-y-2 text-[12.5px] text-ink-3">
                    <p>The API contract has no endpoints yet. Flows are made of them.</p>
                    <Button variant="outline" size="sm" onClick={() => setModule('contract')}>
                      Open the API contract
                    </Button>
                  </div>
                ) : flow.steps.length ? (
                  <ol className="space-y-2">
                    {flow.steps.map((s, i) => {
                      const e = contract.endpoints.find((x) => x.id === s.endpointId)
                      return (
                        <li key={s.id} className="flex gap-2 rounded-md border border-line bg-raised p-2.5">
                          <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[10.5px] font-bold text-accent">{i + 1}</span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <Select aria-label={`Endpoint of step ${i + 1}`} value={e ? s.endpointId : ''} onChange={(ev) => setStep(i, { endpointId: ev.target.value, status: undefined })} className="w-full font-mono">
                              {e ? null : <option value="">Pick an endpoint</option>}
                              {groups.map((g) => (
                                <optgroup key={g.name} label={g.name}>
                                  {g.endpoints.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.method} {openApiPath(x.path)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </Select>
                            {e ? (
                              <Select
                                aria-label={`Response of step ${i + 1}`}
                                value={s.status === undefined ? '' : String(s.status)}
                                onChange={(ev) => setStep(i, { status: ev.target.value === '' ? undefined : ev.target.value === 'default' ? 'default' : Number(ev.target.value) })}
                                className="w-full"
                              >
                                <option value="">It works (the success response)</option>
                                {stepStatuses(e).map((st) => (
                                  <option key={st} value={String(st)}>
                                    {st} {e.responses.find((r) => r.status === st)?.description || statusText(st)}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                            <TextInput aria-label={`Note on step ${i + 1}`} placeholder="A note, like: keep the token" value={s.note ?? ''} onChange={(ev) => setStep(i, { note: ev.target.value || undefined })} className="w-full" />
                          </div>
                          <div className="-mt-0.5 -mr-1 flex shrink-0 flex-col">
                            <IconButton label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                              <ArrowUp size={14} />
                            </IconButton>
                            <IconButton label={`Move step ${i + 1} down`} disabled={i === flow.steps.length - 1} onClick={() => move(i, 1)}>
                              <ArrowDown size={14} />
                            </IconButton>
                            <IconButton label={`Remove step ${i + 1}`} onClick={() => update((f) => ({ ...f, steps: f.steps.filter((x) => x.id !== s.id) }))}>
                              <X size={14} />
                            </IconButton>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="text-[12.5px] text-ink-3">Add the calls in the order the app makes them: log in, refresh the token, fetch the profile.</p>
                )}
              </Group>
              <Group title="This flow">
                <Button variant="outline" size="sm" onClick={deleteFlow}>
                  <Trash2 size={13} />
                  Delete it
                </Button>
              </Group>
            </div>
          </div>
        </section>

        <section className={cx('min-h-0 min-w-0 flex-col bg-panel', show('diagram'), 'xl:flex')} aria-label="Diagram">
          <header className="flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-1.5">
            <div className="min-w-0 flex-1">
              <Tabs
                label="View"
                value={view}
                onChange={(v) => set({ view: v })}
                options={[
                  { value: 'diagram', label: 'Diagram' },
                  { value: 'mermaid', label: 'Mermaid' },
                ]}
              />
            </div>
            <IconButton label="Copy the Mermaid diagram" onClick={copyMermaid}>
              {copied ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
            </IconButton>
            <IconButton
              label={view === 'mermaid' ? `Download ${fileName(flow)}.mmd` : `Download ${fileName(flow)}.svg`}
              onClick={() =>
                view === 'mermaid' ? downloadText(`${fileName(flow)}.mmd`, mermaid) : downloadText(`${fileName(flow)}.svg`, toSequenceSvg(flow, contract, resolvedPalette()), 'image/svg+xml')
              }
            >
              <Download size={15} />
            </IconButton>
          </header>
          <div className="relative min-h-0 flex-1">
            {view === 'mermaid' ? (
              <div className="absolute inset-0">
                <CodeView code={mermaid} lang="yaml" label="Mermaid sequence diagram" />
              </div>
            ) : (
              // the SVG is ours: every piece of text in it is escaped by toSequenceSvg
              <div className="paper-grid absolute inset-0 overflow-auto p-4 scrollbar-thin">
                {flow.steps.length ? (
                  <div className="inline-block overflow-hidden rounded-lg border border-line shadow-pop" dangerouslySetInnerHTML={{ __html: svg }} />
                ) : (
                  <p className="py-10 text-center text-[13px] text-ink-3">Add a step to draw the flow.</p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
