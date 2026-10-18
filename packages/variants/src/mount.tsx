import { createRoot } from 'react-dom/client'

import { VariantCanvas } from './canvas'
import type { CanvasProps } from './canvas'

/** Mount the canvas into an element (the Vite plugin's page calls this). */
export function mountCanvas(el: HTMLElement, props: CanvasProps) {
  createRoot(el).render(<VariantCanvas {...props} />)
}
