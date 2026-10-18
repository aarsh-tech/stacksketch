import '@xyflow/react/dist/base.css'

import { Suspense, use, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { Background, BackgroundVariant, Panel, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow } from '@xyflow/react'
import type { Edge, OnSelectionChangeParams } from '@xyflow/react'
import type { RefObject } from 'react'
import { ImageDown, Maximize, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'

import type { Schema } from '@stacksketch/core'
import { IconButton } from '@/components/ui/primitives'
import { downloadDataUrl } from '@/lib/download'
import { renderGraph } from '@/lib/exportImage'
import { useExplorer, useFocus } from '@/store/explorer'
import { ALIAS_ID, buildGraph, graphKey, layoutFor } from './layout'
import type { GraphEdge, GraphNode } from './layout'
import { TypeNode } from './TypeNode'
import type { TypeFlowNode } from './TypeNode'

const nodeTypes = { type: TypeNode }
const XL = '(min-width: 80rem)'

/** Pick a type: highlight it in the code, switching away from tabs that have no declarations. */
function reveal(name: string) {
  const { output, set } = useExplorer.getState()
  if (output === 'mock' || output === 'fetch') set({ output: 'ts' })
  useFocus.getState().reveal(name)
}

/** Re-fit when the pane goes from hidden (phone layout) to shown, since React Flow can't fit a zero-size box. */
function FitWhenShown({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const flow = useReactFlow()
  useEffect(() => {
    const el = box.current
    if (!el) return
    let wasEmpty = el.clientWidth === 0
    const ro = new ResizeObserver(() => {
      const empty = el.clientWidth === 0
      if (wasEmpty && !empty) void flow.fitView({ padding: 0.15, maxZoom: 1 })
      wasEmpty = empty
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [box, flow])
  return null
}

function Controls({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const flow = useReactFlow()
  const save = async (format: 'png' | 'svg') => {
    try {
      if (!box.current) return
      const name = useExplorer.getState().rootName || 'schema'
      downloadDataUrl(`${name}.${format}`, await renderGraph(box.current, flow.getNodes(), format))
    } catch (e) {
      toast.error(`Couldn’t export the ${format.toUpperCase()}`, { description: e instanceof Error ? e.message : 'Try again, or zoom out first.' })
    }
  }
  const btn = 'bg-raised shadow-[0_1px_2px_rgb(0_0_0/0.1)] border border-line'
  return (
    <>
      <Panel position="top-right" className="flex gap-1">
        <IconButton label="Export the graph as PNG" className={btn} onClick={() => void save('png')}>
          <ImageDown size={15} />
        </IconButton>
        <IconButton label="Export the graph as SVG" className={btn} onClick={() => void save('svg')}>
          <span className="font-mono text-[10px] font-semibold">SVG</span>
        </IconButton>
      </Panel>
      <Panel position="bottom-left" className="flex gap-1">
        <IconButton label="Zoom in" className={btn} onClick={() => void flow.zoomIn()}>
          <Plus size={15} />
        </IconButton>
        <IconButton label="Zoom out" className={btn} onClick={() => void flow.zoomOut()}>
          <Minus size={15} />
        </IconButton>
        <IconButton label="Fit the graph to the pane" className={btn} onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 200 })}>
          <Maximize size={14} />
        </IconButton>
      </Panel>
    </>
  )
}

function Flow({ graph, positions }: { graph: { nodes: GraphNode[]; edges: GraphEdge[] }; positions: Record<string, { x: number; y: number }> }) {
  const box = useRef<HTMLDivElement>(null)
  // positions only matter on mount: the parent remounts this with a new key when the graph changes
  const [nodes, , onNodesChange] = useNodesState<TypeFlowNode>(
    graph.nodes.map((n) => ({ id: n.id, type: 'type', position: positions[n.id] ?? { x: 0, y: 0 }, data: n.data, width: n.width, height: n.height })),
  )
  const focus = useFocus((s) => s.type)
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const lit = focus !== null && (e.source === focus || e.target === focus)
        return { ...e, type: 'smoothstep', selectable: false, focusable: false, zIndex: lit ? 1 : 0, className: lit ? 'is-lit' : undefined }
      }),
    [graph.edges, focus],
  )

  const onSelectionChange = useCallback(({ nodes: picked }: OnSelectionChangeParams) => {
    const id = picked.length === 1 ? picked[0].id : null
    if (id && id !== ALIAS_ID && useFocus.getState().type !== id) reveal(id)
  }, [])

  return (
    <div ref={box} className="stacksketch-flow h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onSelectionChange={onSelectionChange}
        onNodeClick={(_, node) => {
          if (node.id === ALIAS_ID) return
          reveal(node.id)
          if (!window.matchMedia(XL).matches)
            toast(`${node.id} is highlighted in the code`, { action: { label: 'Show the code', onClick: () => useExplorer.getState().set({ mobilePane: 'code' }) } })
        }}
        onPaneClick={() => useFocus.getState().clear()}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        aria-label="Schema graph: one card per type, with an edge for each field that points at another type"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--c-line-strong)" />
        <Controls box={box} />
        <FitWhenShown box={box} />
      </ReactFlow>
    </div>
  )
}

function Graph({ schema }: { schema: Schema }) {
  const graph = useMemo(() => buildGraph(schema), [schema])
  const key = graphKey(graph)
  const positions = use(layoutFor(key, graph))
  return <Flow key={key} graph={graph} positions={positions} />
}

function Loading() {
  return <div className="paper-grid flex h-full items-center justify-center text-[12.5px] text-ink-3">Laying out the graph…</div>
}

/** The schema as a graph of types: lazy-loaded, since React Flow and ELK are heavy. */
export default function SchemaGraph({ schema }: { schema: Schema }) {
  // while a new layout is computed, keep showing the old graph instead of the loading state
  const deferred = useDeferredValue(schema)
  return (
    <ReactFlowProvider>
      <Suspense fallback={<Loading />}>
        <Graph schema={deferred} />
      </Suspense>
    </ReactFlowProvider>
  )
}
