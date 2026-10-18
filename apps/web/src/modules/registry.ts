import { Braces, Crosshair, Database, FormInput, LayoutGrid, Layers, Server, Waypoints, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ModuleId =
  | 'api-explorer'
  | 'form-builder'
  | 'contract'
  | 'mock-server'
  | 'qa-overlay'
  | 'stacking'
  | 'variants'
  | 'db-code'
  | 'flows'

export type Audience = 'frontend' | 'backend' | 'both'
/** where it runs: the workbench, the companion browser extension, or a dev-server plugin */
export type Surface = 'workbench' | 'extension' | 'plugin'

export interface ModuleInfo {
  id: ModuleId
  name: string
  icon: LucideIcon
  phase: number
  ready: boolean
  audience: Audience
  surface: Surface
  /** one line for the sidebar tooltip and the planned page */
  summary: string
  /** what it will do, for the planned page */
  details: string[]
  /** how it uses or feeds the other modules */
  connects: string
}

export const MODULES: ModuleInfo[] = [
  {
    id: 'api-explorer',
    name: 'API explorer',
    icon: Braces,
    phase: 1,
    ready: true,
    audience: 'both',
    surface: 'workbench',
    summary: 'Paste a JSON response, get TypeScript, Zod, mock data and a typed fetch function.',
    details: [],
    connects: 'Creates the shared schema every other module reads.',
  },
  {
    id: 'form-builder',
    name: 'Form builder',
    icon: FormInput,
    phase: 2,
    ready: false,
    audience: 'frontend',
    surface: 'workbench',
    summary: 'Drag fields onto a canvas and export React Hook Form + Zod + Tailwind code.',
    details: [
      'Start from a schema made in the API explorer: fields, types and validation are filled in for you.',
      'Conditional fields ("show GST number only if business type is company") and multi-step forms.',
      'Exports React Hook Form + Zod + Tailwind components you paste straight into your app.',
    ],
    connects: 'Reads schemas from the API explorer; forms open in the variant canvas to preview their states.',
  },
  {
    id: 'contract',
    name: 'API contract',
    icon: Waypoints,
    phase: 3,
    ready: false,
    audience: 'backend',
    surface: 'workbench',
    summary: 'Design endpoints visually and export an OpenAPI 3.1 spec both teams agree on.',
    details: [
      'Method, path, params, request body, responses and error codes for every endpoint.',
      'Bodies are the same shared schemas, so frontend types and backend validation never drift.',
      'Exports OpenAPI 3.1, and imports an existing spec to visualise it.',
    ],
    connects: 'Feeds the mock server and types the request bodies in generated fetch functions.',
  },
  {
    id: 'mock-server',
    name: 'Mock API server',
    icon: Server,
    phase: 3,
    ready: false,
    audience: 'both',
    surface: 'plugin',
    summary: 'One command serves a fake API from your contract, with realistic data, delays and errors.',
    details: [
      'npx stacksketch mock starts a local server from a contract file.',
      'Realistic data from the same generator as the API explorer’s mock tab.',
      'Simulate slow responses, 401s and 500s to build loading and error states before the backend exists.',
    ],
    connects: 'Serves the API contract; the QA overlay and variant canvas can run against it.',
  },
  {
    id: 'qa-overlay',
    name: 'QA overlay',
    icon: Crosshair,
    phase: 4,
    ready: false,
    audience: 'frontend',
    surface: 'extension',
    summary: 'Lay a Figma export over your localhost page and see where spacing and type drift.',
    details: [
      'Drop a Figma frame on top of the live page at any opacity, with difference blending.',
      'Highlights mismatched spacing, font sizes and alignment.',
      'Pin comments on the page and export a QA report.',
    ],
    connects: 'Lives in the companion extension next to the stacking inspector.',
  },
  {
    id: 'stacking',
    name: 'Stacking inspector',
    icon: Layers,
    phase: 4,
    ready: false,
    audience: 'frontend',
    surface: 'extension',
    summary: 'See the page as an exploded 3D stack and find out why your modal is behind the header.',
    details: [
      'Shows every stacking context and its z-index as layers.',
      'Explains the cause in plain words, e.g. "this parent has transform, which starts a new stacking context".',
      'Click a layer to jump to the element in DevTools.',
    ],
    connects: 'Shares the extension panel and page plumbing with the QA overlay.',
  },
  {
    id: 'variants',
    name: 'Variant canvas',
    icon: LayoutGrid,
    phase: 5,
    ready: false,
    audience: 'frontend',
    surface: 'plugin',
    summary: 'Render every prop combination of a component on one canvas, with zero config.',
    details: [
      'Sizes × states × themes on one grid, like a Storybook page you never had to write.',
      'Catches broken variants before release.',
      'Runs as a Vite or Next.js plugin so it can load your real components.',
    ],
    connects: 'Previews forms from the form builder in empty, error, loading and filled states.',
  },
  {
    id: 'db-code',
    name: 'DB to code',
    icon: Database,
    phase: 6,
    ready: false,
    audience: 'backend',
    surface: 'workbench',
    summary: 'Turn a Schemasketch diagram into Prisma schema, SQL migrations and CRUD endpoints.',
    details: [
      'Imports Schemasketch projects through a shared file format.',
      'Generates Prisma schema, SQL migrations and CRUD endpoint stubs.',
      'Each table becomes a shared schema, so the API explorer and form builder can use it too.',
    ],
    connects: 'Bridges Schemasketch into the rest of the workbench.',
  },
  {
    id: 'flows',
    name: 'API flows',
    icon: Workflow,
    phase: 6,
    ready: false,
    audience: 'both',
    surface: 'workbench',
    summary: 'Draw multi-step flows like login → refresh token → fetch profile as sequence diagrams.',
    details: [
      'Sequence diagrams on the canvas, built from endpoints in the API contract.',
      'Annotate each step with the data it sends and receives.',
      'Export as SVG or Mermaid for docs and pull requests.',
    ],
    connects: 'Uses endpoints from the API contract.',
  },
]

export const moduleById = (id: ModuleId) => MODULES.find((m) => m.id === id) ?? MODULES[0]

export const SURFACE_LABEL: Record<Surface, string> = {
  workbench: 'Workbench',
  extension: 'Browser extension',
  plugin: 'CLI / dev plugin',
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  both: 'Frontend + backend',
}
