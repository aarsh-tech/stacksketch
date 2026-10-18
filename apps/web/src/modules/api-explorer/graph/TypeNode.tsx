import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'

import { refsOf } from '@stacksketch/core'
import { cx } from '@/lib/cx'
import { useFocus } from '@/store/explorer'
import { ShapeLabel } from '../StructureTree'
import { ALIAS_ID, HEADER_H, ROW_H } from './layout'
import type { TypeNodeData } from './layout'

export type TypeFlowNode = Node<TypeNodeData, 'type'>

/** A type as a card: its name, then one row per field. Fields that point at a type get an edge handle. */
export const TypeNode = memo(function TypeNode({ data, selected }: NodeProps<TypeFlowNode>) {
  const { type, isRoot, alias } = data
  const focused = useFocus((s) => s.type === type.name)
  const lit = selected || focused
  return (
    <div
      className={cx(
        'h-full w-full overflow-hidden rounded-lg border bg-raised font-mono shadow-[0_1px_3px_rgb(0_0_0/0.08)] transition-shadow',
        lit ? 'border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--c-accent)_25%,transparent)]' : 'border-line-strong',
      )}
      title={alias ? undefined : `${type.name}: click to show its declaration in the code`}
    >
      {alias ? null : <Handle type="target" position={Position.Top} isConnectable={false} />}
      <div className={cx('relative flex items-center gap-2 px-3', !alias && 'border-b border-line bg-panel')} style={{ height: HEADER_H }}>
        {isRoot ? <span className="rounded bg-accent-soft px-1 py-px font-sans text-[10.5px] font-medium text-accent">root</span> : null}
        <span className="truncate text-[12.5px] font-semibold text-t-ref">{type.name}</span>
        {alias ? (
          <>
            <span className="truncate text-[12px]">
              <span className="text-ink-3">= </span>
              <ShapeLabel shape={alias.shape} />
            </span>
            <Handle type="source" position={Position.Bottom} id={ALIAS_ID} isConnectable={false} />
          </>
        ) : null}
      </div>
      {alias ? null : type.fields.length ? (
        type.fields.map((f) => (
          <div key={f.key} className="relative flex items-center gap-2 px-3 text-[12px]" style={{ height: ROW_H }}>
            <span className="truncate text-ink">
              {f.key}
              {f.optional ? <span className="text-warn">?</span> : null}
            </span>
            <span className="ml-auto truncate pl-2 text-right">
              <ShapeLabel shape={f.shape} />
            </span>
            {refsOf(f.shape).length ? <Handle type="source" position={Position.Right} id={f.key} isConnectable={false} /> : null}
          </div>
        ))
      ) : (
        <p className="px-3 text-[12px] leading-[26px] text-ink-3">empty object</p>
      )}
    </div>
  )
})
