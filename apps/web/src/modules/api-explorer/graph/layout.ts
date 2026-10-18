import { refsOf, rootTypeName, typesTopDown } from '@stacksketch/core'
import type { ObjectType, Schema, Shape } from '@stacksketch/core'

export const HEADER_H = 36
export const ROW_H = 26
const CHAR_W = 7.3 // JetBrains Mono at 12px
const MIN_W = 180
const MAX_W = 420

/** The same text the tree's ShapeLabel shows, for sizing nodes before they render. */
export function shapeText(shape: Shape): string {
  switch (shape.kind) {
    case 'number':
      return shape.integer ? 'integer' : 'number'
    case 'ref':
      return shape.name
    case 'enum':
      return 'enum'
    case 'array':
      return shape.items.kind === 'union' ? `(${shapeText(shape.items)})[]` : `${shapeText(shape.items)}[]`
    case 'union':
      return shape.options.map(shapeText).join(' | ')
    default:
      return shape.kind
  }
}

export interface TypeNodeData {
  [key: string]: unknown
  type: ObjectType
  isRoot: boolean
  /** set when the root is an array or union rather than an object: `OrdersList = Order[]` */
  alias?: { name: string; shape: Shape }
}

export interface GraphNode {
  id: string
  data: TypeNodeData
  width: number
  height: number
}

export interface GraphEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
}

export const ALIAS_ID = '__root__'

/** One node per reachable type, one edge per field that points at a type. */
export function buildGraph(schema: Schema): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const types = typesTopDown(schema)
  const rootRef = schema.root.kind === 'ref' ? schema.root.name : null
  const nodes: GraphNode[] = types.map((type) => {
    const longest = Math.max(0, ...type.fields.map((f) => f.key.length + (f.optional ? 1 : 0) + shapeText(f.shape).length))
    const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, 40 + longest * CHAR_W, 70 + type.name.length * 8)))
    return { id: type.name, data: { type, isRoot: type.name === rootRef }, width, height: HEADER_H + ROW_H * Math.max(1, type.fields.length) }
  })
  const edges: GraphEdge[] = []
  for (const type of types)
    for (const f of type.fields)
      for (const target of new Set(refsOf(f.shape))) edges.push({ id: `${type.name}.${f.key}->${target}`, source: type.name, sourceHandle: f.key, target })

  if (!rootRef) {
    const name = rootTypeName(schema)
    const text = `${name} = ${shapeText(schema.root)}`
    nodes.unshift({
      id: ALIAS_ID,
      data: { type: { name, fields: [] }, isRoot: true, alias: { name, shape: schema.root } },
      width: Math.round(Math.min(MAX_W, Math.max(MIN_W, 70 + text.length * CHAR_W))),
      height: HEADER_H,
    })
    for (const target of new Set(refsOf(schema.root))) edges.push({ id: `${ALIAS_ID}->${target}`, source: ALIAS_ID, sourceHandle: ALIAS_ID, target })
  }
  return { nodes, edges }
}

/** Changes whenever what the graph draws changes, and only then. */
export function graphKey(graph: { nodes: GraphNode[] }): string {
  return graph.nodes
    .map((n) => `${n.id}:${n.data.alias ? shapeText(n.data.alias.shape) : n.data.type.fields.map((f) => `${f.key}${f.optional ? '?' : ''}=${shapeText(f.shape)}`).join(',')}`)
    .join('|')
}

type XY = { x: number; y: number }

interface ElkNode {
  id: string
  x?: number
  y?: number
}

/** Top-down layered layout, root first: the structure pane is taller than it is wide. */
async function runLayout(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Promise<Record<string, XY>> {
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  const seen = new Set<string>()
  const edges = graph.edges
    .filter((e) => e.source !== e.target)
    .filter((e) => {
      const k = `${e.source}->${e.target}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  const out = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.spacing.nodeNode': '28',
      'elk.spacing.componentComponent': '60',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges,
  })
  const positions: Record<string, XY> = {}
  for (const c of (out.children ?? []) as ElkNode[]) positions[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) }
  return positions
}

function gridLayout(nodes: GraphNode[]): Record<string, XY> {
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  const positions: Record<string, XY> = {}
  nodes.forEach((n, i) => (positions[n.id] = { x: (i % cols) * (MAX_W + 60), y: Math.floor(i / cols) * 320 }))
  return positions
}

/**
 * Layouts by graph key, so the graph can read them with React's `use()`.
 * Kept small: an old schema's layout is cheap to redo.
 */
const cache = new Map<string, Promise<Record<string, XY>>>()

export function layoutFor(key: string, graph: { nodes: GraphNode[]; edges: GraphEdge[] }): Promise<Record<string, XY>> {
  let p = cache.get(key)
  if (!p) {
    // if ELK fails to load or throws, a plain grid is better than no graph
    p = runLayout(graph).catch(() => gridLayout(graph.nodes))
    cache.set(key, p)
    if (cache.size > 24) cache.delete(cache.keys().next().value as string)
  }
  return p
}
