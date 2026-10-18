import { useMemo, useState } from 'react'
import { ArrowRight, Braces, CircleSlash } from 'lucide-react'
import { toast } from 'sonner'

import { applyOverrides, formFromSchema } from '@stacksketch/core'
import type { Schema, Widget } from '@stacksketch/core'
import { Button, Dialog } from '@/components/ui/primitives'
import { cx } from '@/lib/cx'
import { useInference } from '@/modules/api-explorer/inference/useInference'
import { useExplorer } from '@/store/explorer'
import { uid, useForms } from '@/store/forms'
import { useUi } from '@/store/ui'
import { widgetInfo } from './widgets'

/** The type a form is most likely wanted for: what the response lists (`orders: Order[]`), else the response itself. */
function suggestType(schema: Schema): string | undefined {
  const root = schema.root.kind === 'array' ? schema.root.items : schema.root
  const rootName = root.kind === 'ref' ? root.name : undefined
  const listed = schema.types
    .find((t) => t.name === rootName)
    ?.fields.map((f) => f.shape)
    .find((s) => s.kind === 'array' && s.items.kind === 'ref')
  return listed?.kind === 'array' && listed.items.kind === 'ref' ? listed.items.name : (rootName ?? schema.types[0]?.name)
}

function WidgetIcon({ widget }: { widget: Widget }) {
  const Icon = widgetInfo(widget).icon
  return <Icon size={13} className="shrink-0 text-accent" />
}

/** Pick a type from the API explorer's schema (with the user's edits) and make a form of it. */
export function FromSchemaDialog({ onClose }: { onClose: () => void }) {
  const samples = useExplorer((s) => s.samples)
  const rootName = useExplorer((s) => s.rootName)
  const overrides = useExplorer((s) => s.overrides)
  const addForm = useForms((s) => s.addForm)
  const setModule = useUi((s) => s.setModule)
  const { schema: inferred, pending } = useInference(samples, rootName)
  const schema = useMemo(() => (inferred ? applyOverrides(inferred, overrides) : null), [inferred, overrides])

  const types = schema?.types ?? []
  const suggested = schema ? suggestType(schema) : undefined
  const [picked, setPicked] = useState<string | null>(null)
  const typeName = picked && types.some((t) => t.name === picked) ? picked : suggested
  const preview = useMemo(() => (schema && typeName ? formFromSchema(schema, typeName, uid) : null), [schema, typeName])
  const fields = preview?.form.items.filter((i) => i.kind === 'field') ?? []

  const create = () => {
    if (!preview) return
    addForm(preview.form)
    onClose()
    toast.success(`Made ${preview.form.name} with ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}`, {
      description: preview.skipped.length ? `Left out ${preview.skipped.map((s) => s.key).join(', ')}.` : undefined,
    })
  }

  return (
    <Dialog
      title="New form from a type"
      onClose={onClose}
      footer={
        schema ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={create} disabled={!fields.length}>
              Make a form of {typeName}
            </Button>
          </>
        ) : null
      }
    >
      {!schema ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Braces size={20} className="text-ink-3" />
          <p className="max-w-sm text-[13px] text-ink-2">
            {pending ? 'Reading the API explorer’s samples…' : 'The API explorer doesn’t have a valid JSON response yet. Paste one there, then come back to make a form of any of its types.'}
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <fieldset>
            <legend className="pb-1.5 text-[12px] font-medium text-ink-3">Types in {schema.rootName}</legend>
            <div className="space-y-px">
              {types.map((t) => (
                <label
                  key={t.name}
                  className={cx(
                    'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] has-focus-visible:outline-2 has-focus-visible:outline-accent',
                    t.name === typeName ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-hover',
                  )}
                >
                  <input type="radio" name="type" className="sr-only" checked={t.name === typeName} onChange={() => setPicked(t.name)} />
                  <span className="flex-1 truncate font-mono font-medium text-t-ref">{t.name}</span>
                  <span className="text-[11.5px] text-ink-3">{t.fields.length} fields</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="min-w-0">
            <p className="pb-1.5 text-[12px] font-medium text-ink-3">The form will have</p>
            {fields.length ? (
              <ul className="space-y-1">
                {preview?.form.items.map((i) =>
                  i.kind === 'field' ? (
                    <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                      <WidgetIcon widget={i.widget} />
                      <span className="truncate text-ink">{i.label}</span>
                      {i.required ? <span className="text-danger">*</span> : null}
                      <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{i.key}</span>
                    </li>
                  ) : (
                    <li key={i.id} className="pt-1.5 text-[11.5px] font-semibold text-ink-2">
                      {i.kind === 'section' ? i.title : null}
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-3">No fields a form can ask for.</p>
            )}
            {preview?.skipped.length ? (
              <>
                <p className="pt-4 pb-1.5 text-[12px] font-medium text-ink-3">Left out</p>
                <ul className="space-y-1">
                  {preview.skipped.map((s) => (
                    <li key={s.key} className="flex gap-2 text-[12.5px] text-ink-2">
                      <CircleSlash size={13} className="mt-0.5 shrink-0 text-ink-3" />
                      <span>
                        <span className="font-mono text-ink">{s.key}</span>: {s.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  )
}
