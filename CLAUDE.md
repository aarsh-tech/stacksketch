# Stacksketch: notes for Claude Code

Stacksketch is one local workbench for the contract between frontend and backend. Phase 1 is the API explorer: paste a JSON response, get TypeScript, Zod, mock data, a typed fetch function and JSON Schema. Phase 2 is the form builder; phase 3 is the API contract designer and the mock server CLI (both built); phase 7 is the API client. It's a static React app with **no backend and no database**; state lives in `localStorage`. It deploys to Netlify. The plan is in `ROADMAP.md`.

It's a sibling of Schemasketch (`D:\Personal_Projects\schemasketch`) and shares its stack, conventions and look.

## Commands (pnpm only, never npm or yarn)

Run from the repo root:

```bash
pnpm install
pnpm dev         # the workbench at http://localhost:5174
pnpm test        # Vitest in packages/core
pnpm typecheck   # every package
pnpm lint        # oxlint; keep it at zero warnings
pnpm build       # apps/web → apps/web/dist; must pass before you say a task is done
pnpm release:extension  # Chrome Web Store zip → release/; listing texts in docs/chrome-web-store
```

## Monorepo

```
apps/web/                         the workbench (Vite 8, React 19, Tailwind 4, Zustand 5)
  src/App.tsx                     theme, toaster, picks the current module
  src/components/Shell.tsx        top bar, module sidebar, mobile drawer
  src/components/ui/primitives.tsx Button, IconButton, Tabs, Segmented, Pane, TextInput, Select, Checkbox
  src/modules/registry.ts         every module: name, phase, ready, audience, surface, copy for its planned page
  src/modules/Planned.tsx         page for modules that aren't built yet
  src/components/CodeView.tsx     read-only highlighted code (CodeMirror), shared by the modules
  src/modules/api-explorer/       phase 1: ApiExplorer.tsx (three panes), StructureTree.tsx
  src/modules/form-builder/       phase 2: FormBuilder.tsx (dnd-kit context, three panes), Palette, Canvas, Inspector, FromSchemaDialog, Preview (RHF + Zod, its own lazy chunk); lazy-loaded
  src/store/ui.ts                 theme + current module (persisted: stacksketch:ui)
  src/store/explorer.ts           API explorer input and options (persisted: stacksketch:explorer)
  src/modules/contract/           phase 3: ContractDesigner.tsx (list, editor, code), Editors, ShapePicker, ImportDialog (OpenAPI; yaml is lazy), FromExplorerDialog; lazy-loaded
  src/store/forms.ts              form builder forms and selection (persisted: stacksketch:forms)
  src/store/contract.ts           the API contract and selection (persisted: stacksketch:contract)
  src/lib/codemirror.ts           syntax colours from theme tokens
packages/core/                    @stacksketch/core: pure TypeScript, no DOM, no React
  src/types.ts                    THE SHARED SCHEMA. Every module reads and writes this.
  src/infer.ts                    JSON samples → Schema (merging, optional/nullable, formats, naming)
  src/names.ts                    PascalCase, singular, item names, safe property keys
  src/parse.ts                    JSON.parse with line/column and plain-English errors
  src/generate/                   typescript, zod, mock, fetch, jsonSchema: one pure function each
  src/contract/                   the API contract: types, model (paths, names, problems, usableContract, addSchemaEndpoint), shapes (the type picker's parts), generate (types, Zod, typed client)
  src/openapi/                    toOpenApi, fromOpenApi (3.0 and 3.1, takes a parsed object), toYaml
  src/mock/api.ts                 createMockApi (pure request → response for the mock server), readContractFile
  src/request/                    the API client: types, model (build, variables, cURL, assertions, captures, from contract endpoints), check (checkShape, checkContract, findEndpoint), postman, runner, send (sendWithFetch, shared by page/extension/proxy), bridge (page ↔ extension messages)
apps/extension/                   phase 4: Chrome MV3. src/content.ts (shadow-root overlay, measure, pins, stacking scan), src/bridge.ts (relays the API client's requests), src/background.ts (also sends them, CORS-free), src/panel/ (React side panel; reuses apps/web's primitives and tokens through the @ alias); vite builds the panel, build.mjs the IIFE scripts
  src/inspect/ (in core)          stackingReasons, stackingTree, compareStacking, gapBetween, checkType, qaReport
packages/variants/                phase 5: props.ts (TypeScript compiler reads components and props), vite.ts (plugin, /__variants), next.ts (writes a dev-only page), canvas.tsx + mount.tsx (React grid); built by build.mjs; fixture/ is a demo app
  src/variants/grid.ts (in core)  defaultAxes, defaultArgs, variantGrid; src/form/sample.ts sampleFormValues for the form states view
  src/db/ (in core)               dbml.ts (parseDbml, readSchemasketchFile), generate.ts (tablesToTypes, toPrisma, toSqlMigration, dbCrudContract, toExpressRoutes, toNextRoutes)
  src/flows/ (in core)            flowSequence, toMermaid, toSequenceSvg
  apps/web modules                db-code/DbCode.tsx (store: stacksketch:db), flows/Flows.tsx (store: stacksketch:flows)
  apps/web api-client/            phase 7: ApiClient.tsx (three panes), RequestList, RequestEditor, ResponseView, Dialogs (environments, import, runner, CORS help), transport.ts (mock, browser, extension bridge, proxy); store: stacksketch:client, history in memory
packages/cli/                     `stacksketch mock <file>`: Node http wrapper around createMockApi; `stacksketch proxy` (src/proxy.ts) sends the API client's requests; bundled by esbuild (build.mjs) into dist/cli.js
  src/form/                       the form model (types, model), formFromSchema, toFormZod (+ formZodRuntime for the preview), toFormComponent (react.ts), formToSchema
  src/core.test.ts                Vitest; the Zod tests eval the generated code against real zod
  src/form.test.ts                form model and generator tests; typecheck.testutil.ts runs strict tsc on generated code
  src/contract.test.ts            contract model, client (compiled and run against a stubbed fetch), OpenAPI round trip and import
```

`apps/web` imports `@stacksketch/core` straight from its TypeScript source (`exports` points at `src/index.ts`), so there's no build step for core.

## Rules that keep the app working

- **One schema format.** New modules consume and produce `Schema` from `packages/core/src/types.ts`. Need more? Extend it, bump `version`, and keep old data loading. Never add a parallel format.
- **Logic goes in `packages/core`, UI goes in `apps/web`.** Inference, generators, OpenAPI, form models: pure functions in core, with tests. Components only call them.
- **Generated code must compile and run.** Every generator has a test that proves it (the Zod tests run the output; add a `tsc` check when you add a generator that emits TypeScript).
- **Nothing leaves the browser unless the user sends it.** No analytics, no remote fetches of user data, no servers of ours. Imports read local files or pasted text. The one thing that sends requests is the API client, and only the requests the user writes, to the URLs they type, from the page, the extension (no cookies attached) or `stacksketch proxy` on their own machine (allowed origins only, bound to 127.0.0.1).
- **Heavy libraries are lazy-loaded** with dynamic `import()`. Keep the main bundle small.
- **Never call setState inside an effect.** oxlint flags it. Derive values during render, or remount with a `key`.
- **Persisted shapes** (`stacksketch:ui`, `stacksketch:explorer`, `stacksketch:forms`, `stacksketch:contract`, `stacksketch:db`, `stacksketch:flows`, `stacksketch:client`): when you change one, bump the persist `version` and add a `migrate`.
- **Adding a module**: set `ready: true` in `modules/registry.ts`, put it in `src/modules/<id>/`, and route it in `App.tsx`.

## UI conventions

- **Colours only from tokens.** Use the `--c-*` variables in `apps/web/src/index.css`, exposed to Tailwind as `bg-panel`, `text-ink-2`, `border-line`, `text-accent`, and the type colours `text-t-string`, `text-t-number`, `text-t-boolean`, `text-t-null`, `text-t-ref`. Never hard-code hex values in components. Every UI must work in light and dark.
- The accent is clay (`--c-accent`), Schemasketch's is pine green: same family, different ink.
- Fonts: Schibsted Grotesk (UI) and JetBrains Mono (code, keys, types).
- Reuse `components/ui/primitives.tsx` before writing new ones. `Pane` gives the standard header + toolbar + body.
- Copy is sentence case, plain and specific. A button says what it does ("Copy the Zod schema", not "Submit"). Errors say what went wrong and how to fix it.
- Make everything keyboard reachable with a visible focus ring, and make it work at phone width (below `xl` the API explorer shows one pane at a time).
- Toasts come from `sonner`: `toast.success`, `toast.error(title, { description })`.

## Before you say a feature is done

1. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` all pass.
2. You've tried it at `pnpm dev`, in light and dark, and at phone width.
3. The sample response (`apps/web/src/lib/sample.ts`) still produces sensible output in every tab.
4. The README's feature list is updated, and the item is ticked off in `ROADMAP.md`.
