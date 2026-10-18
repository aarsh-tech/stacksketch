import { Braces, Crosshair, Database, FormInput, LayoutGrid, Layers, SendHorizontal, Server, Waypoints, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ModuleId =
  | 'api-explorer'
  | 'form-builder'
  | 'contract'
  | 'api-client'
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
  /** for built modules that run outside the workbench: how to start them */
  setup?: string[]
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
    ready: true,
    audience: 'frontend',
    surface: 'workbench',
    summary: 'Drag fields onto a canvas, set validation and when each one shows, and get a Zod schema for it.',
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
    ready: true,
    audience: 'backend',
    surface: 'workbench',
    summary: 'Design endpoints with typed params, bodies and responses, and export OpenAPI 3.1 and a typed client.',
    details: [
      'Method, path, params, request body, responses and error codes for every endpoint.',
      'Bodies are the same shared schemas, so frontend types and backend validation never drift.',
      'Exports OpenAPI 3.1, and imports an existing spec to visualise it.',
    ],
    connects: 'Feeds the mock server and types the request bodies in generated fetch functions.',
  },
  {
    id: 'api-client',
    name: 'API client',
    icon: SendHorizontal,
    phase: 7,
    ready: true,
    audience: 'both',
    surface: 'workbench',
    summary: 'Send requests to your real API, check every response against the contract, and run them all in order.',
    details: [
      'Requests with params, headers, bearer, basic or API key auth and JSON, text or form bodies; environments fill {{variables}}.',
      'Checks on status, time, headers and body values, plus a check that the response matches the API contract.',
      'Save a login’s token or a new id into the environment, and run a whole folder in order with a Markdown report.',
      'Send from the page, or through the browser extension or stacksketch proxy to get past CORS. Imports Postman collections and cURL.',
    ],
    connects: 'Makes requests from the API contract, checks responses against it, adds missing endpoints to it, and opens responses in the API explorer.',
  },
  {
    id: 'mock-server',
    name: 'Mock API server',
    icon: Server,
    phase: 3,
    ready: true,
    audience: 'both',
    surface: 'plugin',
    summary: 'Send requests to a fake API made from your contract, here or as a local server, with realistic data, delays and errors.',
    details: [
      'Try every endpoint of the API contract right in the workbench; POST then GET returns what you created.',
      'npx stacksketch mock serves the same fake API on localhost for your app.',
      'Simulate slow responses, 401s and 500s to build loading and error states before the backend exists.',
    ],
    connects: 'Serves the API contract; the QA overlay and variant canvas can run against it.',
    setup: [
      'Build it: pnpm build (the CLI lands in packages/cli/dist/cli.js).',
      'In the API contract, open the contract settings and download contract.json (or use any OpenAPI 3 file).',
      'Run node packages/cli/dist/cli.js mock contract.json, or npx stacksketch mock contract.json once it’s published. It serves on http://localhost:4010.',
      'Set a delay or a forced status per endpoint in the contract, or add ?__status=500 or ?__delay=2000 to any request.',
    ],
  },
  {
    id: 'qa-overlay',
    name: 'QA overlay',
    icon: Crosshair,
    phase: 4,
    ready: true,
    audience: 'frontend',
    surface: 'extension',
    summary: 'Lay a Figma export over a screenshot of your page and see where spacing, type and colour drift.',
    details: [
      'Overlay, swipe and difference views; every area that differs is found and boxed for you.',
      'Measure, pin comments with screenshots, and export a QA report.',
      'The companion extension does the same on the live localhost page.',
    ],
    connects: 'Lives in the workbench and in the companion extension, next to the stacking inspector.',
    setup: [
      'Build it: pnpm build (the extension lands in apps/extension/dist).',
      'In Chrome, open chrome://extensions, turn on Developer mode, click "Load unpacked" and pick apps/extension/dist.',
      'Click the Stacksketch button in the toolbar to open the side panel. It runs on localhost and the hosted workbench by default; turn it on for other sites from the panel.',
    ],
  },
  {
    id: 'stacking',
    name: 'Stacking inspector',
    icon: Layers,
    phase: 4,
    ready: true,
    audience: 'frontend',
    surface: 'extension',
    summary: 'See HTML and CSS as an exploded 3D stack and find out why your modal is behind the header.',
    details: [
      'Shows every stacking context and its z-index as layers.',
      'Explains the cause in plain words, e.g. "this parent has transform, which starts a new stacking context".',
      'Paste markup here, or inspect a live page with the companion extension.',
    ],
    connects: 'Shares the extension panel and page plumbing with the QA overlay.',
    setup: [
      'Build it: pnpm build (the extension lands in apps/extension/dist).',
      'In Chrome, open chrome://extensions, turn on Developer mode, click "Load unpacked" and pick apps/extension/dist.',
      'Click the Stacksketch button in the toolbar to open the side panel. It runs on localhost and the hosted workbench by default; turn it on for other sites from the panel.',
    ],
  },
  {
    id: 'variants',
    name: 'Variant canvas',
    icon: LayoutGrid,
    phase: 5,
    ready: true,
    audience: 'frontend',
    surface: 'plugin',
    summary: 'Render every prop combination of a component on one grid, with props read from its TypeScript types.',
    details: [
      'Sizes × states × themes on one grid, like a Storybook page you never had to write.',
      'Paste a component here to try it; variants that throw are marked in red.',
      'Runs as a Vite or Next.js plugin so it can load your real components.',
    ],
    connects: 'Previews forms from the form builder in empty, error, loading and filled states.',
    setup: [
      'It isn’t on npm yet, so make a file of it: in the Stacksketch repo run pnpm --filter @stacksketch/variants build, then pnpm pack inside packages/variants. That makes stacksketch-variants-0.5.0.tgz.',
      'In your app, install that file: pnpm add -D /path/to/stacksketch/packages/variants/stacksketch-variants-0.5.0.tgz (npm i -D works too).',
      'Vite: in vite.config.ts, import { stacksketchVariants } from "@stacksketch/variants/vite" and add stacksketchVariants({ setup: ["/src/index.css"] }) after react() in plugins. setup loads your global styles.',
      'Next.js: in next.config.ts, import { withStacksketchVariants } from "@stacksketch/variants/next" and export default withStacksketchVariants(yourConfig). It writes app/__variants/page.tsx while next dev runs; add that to .gitignore.',
      'Run your dev server and open /__variants. Every exported component in src/ is there, sizes across and kinds down, once per theme. A variant that throws is marked in red.',
      'Forms: in the form builder, switch the canvas to States to see a form empty, filled in, with errors and submitting.',
    ],
  },
  {
    id: 'db-code',
    name: 'DB to code',
    icon: Database,
    phase: 6,
    ready: true,
    audience: 'backend',
    surface: 'workbench',
    summary: 'Turn a Schemasketch diagram into types, a Prisma schema, SQL migrations and CRUD endpoints.',
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
    ready: true,
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
