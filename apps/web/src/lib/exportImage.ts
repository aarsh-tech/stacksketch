import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import type { Node } from '@xyflow/react'

const PADDING = 40

/**
 * Renders the whole graph (not just what's on screen) to a PNG or SVG data
 * URL, in the theme the app is showing.
 */
export async function renderGraph(container: HTMLElement, nodes: Node[], format: 'png' | 'svg'): Promise<string> {
  const viewport = container.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport || nodes.length === 0) throw new Error('There is nothing on the graph to export yet.')
  const { toPng, toSvg } = await import('html-to-image')

  const bounds = getNodesBounds(nodes)
  const width = Math.ceil(bounds.width + PADDING * 2)
  const height = Math.ceil(bounds.height + PADDING * 2)
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, PADDING / Math.max(width, height))

  const options = {
    backgroundColor: getComputedStyle(container).getPropertyValue('--c-canvas').trim() || '#ffffff',
    width,
    height,
    pixelRatio: format === 'svg' ? 1 : Math.min(3, Math.max(1.5, 4000 / Math.max(width, height))),
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    filter: (el: HTMLElement) => !el.classList?.contains('react-flow__handle'),
  }
  // html-to-image doesn't carry CSS onto SVG paths, so the edges would come out without a stroke:
  // copy the resolved colours onto them as attributes for the duration of the render
  const paths = [...viewport.querySelectorAll<SVGPathElement>('.react-flow__edge-path')]
  for (const p of paths) {
    const cs = getComputedStyle(p)
    p.setAttribute('stroke', cs.stroke)
    p.setAttribute('stroke-width', cs.strokeWidth)
  }
  try {
    return await (format === 'png' ? toPng(viewport, options) : toSvg(viewport, options))
  } finally {
    for (const p of paths) {
      p.removeAttribute('stroke')
      p.removeAttribute('stroke-width')
    }
  }
}
