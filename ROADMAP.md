# Roadmap

Build these in order, one per branch or PR. Each item lists what "done" means. Tick the box when an item ships, and **release each phase on GitHub as soon as it works on its own** rather than waiting for the whole thing.

The aim: **one local workbench for the contract between frontend and backend**. An API response becomes types, types become a form, the form becomes a component with variants, and the QA overlay checks the result against Figma. Backend developers design the same contract and get a mock server and code from it.

Every module reads and writes the shared schema in `packages/core/src/types.ts`. If a module needs something the schema can't express, extend the schema (with a version bump and a migration) rather than inventing a side format.

---

## Phase 1: API explorer (v0.1)

### - [x] 1. JSON to schema, types, Zod, mock, fetch, JSON Schema

- Infer the shared schema from a pasted response; merge array items; optional and nullable keys; string formats; integer vs decimal.
- Generators in `packages/core/src/generate/`, each a pure function with Vitest tests.
- Workbench shell with the module sidebar; planned modules show what they'll do.
- Done: shipped in the initial commit.

### - [x] 2. Graph view on the canvas

- A "Tree | Graph" switch in the Structure pane. Graph draws one node per type and an edge per ref, with React Flow (`@xyflow/react`) and ELK auto-layout, like Schemasketch's tables.
- Click a node to highlight its declaration in the generated code.
- Export the graph as PNG and SVG.
- Done when the sample response lays out cleanly in both themes and at phone width (graph pans and zooms by touch).

### - [x] 3. Edit the schema, not just read it

- Rename a type, mark a field optional/required/nullable, change a field's type or format (e.g. string → enum of the sample values), from the tree.
- Edits live in an overrides layer on top of inference, so pasting a new sample keeps them.
- Enum detection: offer "make this an enum" for strings with a few distinct values (`status`, `currency`).
- Done when every edit shows up in all five outputs and survives a reload.

### - [x] 4. More inputs and outputs

- Several samples at once (tabs), merged into one schema: the best way to catch optional fields.
- Import from a cURL command or HAR file (parse it locally; never send requests from the app).
- Outputs: Valibot, Yup, TanStack Query hook, Axios function, Python Pydantic, Go structs.
- Move parsing and inference into a Web Worker when the input is over ~500 KB, so big responses don't freeze typing.

### - [ ] 5. Release v0.1

- Deploy to Netlify (`netlify.toml` is ready). Add screenshots and a short GIF to the README.
- Publish the repo, tag `v0.1.0`, write the release notes.
- Status: screenshots, GIF, release notes ([CHANGELOG.md](CHANGELOG.md)) and the `v0.1.0` tag are done. Still to do: deploy to Netlify and publish the GitHub release from the tag.

---

## Phase 2: Form builder (v0.2)

### - [x] 6. Canvas form builder

- Drag fields (text, number, select, radio, checkbox, date, file, textarea) onto a form canvas; reorder by dragging; group into sections and steps.
- "New form from schema": pick a type from the API explorer and get its fields with types and validation already set.
- Validation rules per field (required, min/max, pattern, custom message), mapped to Zod.
- Conditional visibility ("show GST number only if business type is company").
- Done: forms live in `packages/core/src/form/` (model, `formFromSchema`, `toFormZod`, `formToSchema`) and the module in `apps/web/src/modules/form-builder/`. A form is a flat list of fields with section and step markers; each field's value maps to a shared-schema `Shape`.

### - [x] 7. Form code export

- React Hook Form + `@hookform/resolvers/zod` + Tailwind, as one component file plus its schema.
- Live preview you can fill in, with validation messages.
- Done when the exported code compiles in a fresh Vite app with no edits.
- Done: `toFormComponent` in `packages/core/src/form/react.ts`; its tests type-check it with its schema under a fresh Vite app's compiler settings. The exported files were also built in a fresh `create-vite` React + TypeScript app with Tailwind, unedited, and filled in there in Chrome. The preview (`Preview.tsx`) runs the exported Zod schema itself (`formZodRuntime`) with the same rules as the component for empty inputs, hidden fields and steps.

---

## Phase 3: API contract and mock server (v0.3), backend developers join

### - [x] 8. API contract designer

- Endpoints with method, path, path/query params, request body, responses per status code, error shapes. Bodies are shared-schema types.
- Group endpoints by resource; reuse types across endpoints.
- Export and import OpenAPI 3.1 (`packages/core/src/openapi/`).
- Generated fetch functions get typed request bodies.
- Done: the contract model lives in `packages/core/src/contract/` (`Contract` holds shared-schema `ObjectType`s and endpoints whose params, bodies and responses are `Shape`s), with `toOpenApi` / `fromOpenApi` (3.0 and 3.1) in `packages/core/src/openapi/`. `toContractClient` writes a typed fetch client with typed request bodies; its tests type-check it with its types and Zod schemas under strict `tsc` and run it against a stubbed `fetch`. The module is `apps/web/src/modules/contract/`; the explorer's response can be added as an endpoint.

### - [x] 9. Mock API server (`packages/cli`)

- `npx stacksketch mock contract.json` serves every endpoint locally, with data from the same mock generator.
- Per-endpoint delay and forced status (to build loading and error states), CORS on by default.
- Optional in-memory CRUD so POST then GET returns what you created.
- The workbench can export the contract file the CLI reads.
- Done: the request handling is pure, in `packages/core/src/mock/api.ts` (`createMockApi`, tested in `mock.test.ts`); `packages/cli` is a thin Node `http` wrapper bundled by esbuild into one dependency-free file. It also reads OpenAPI 3 files, reloads when the file is saved, and takes `?__status=` / `?__delay=` (or `x-mock-status` / `x-mock-delay`) on any request. Per-endpoint delay and status are set in the endpoint editor and saved in the contract (`endpoint.mock`). Not yet published to npm, so `npx stacksketch` works after `npm publish` from `packages/cli`; until then run `node packages/cli/dist/cli.js mock contract.json`. The workbench's Mock API server page runs the same `createMockApi` in the browser, as a request console over the current contract.

---

## Phase 4: Companion browser extension (v0.4), `apps/extension`

### - [x] 10. Extension plumbing

- Chrome MV3 extension built with Vite: content script, side panel, messaging. Only runs on pages the user turns it on for (localhost by default).

### - [x] 11. Pixel-perfect QA overlay

- Drop a Figma frame export (PNG) over the page; opacity slider, difference blend, nudge with arrow keys, lock to an element.
- Measure tool: distances between elements, computed font size and line height vs the design.
- Pin comments; export a QA report (Markdown with screenshots).

### - [x] 12. Stacking inspector

- Exploded 3D view of stacking contexts with their z-index.
- Explain why an element creates a stacking context (transform, opacity < 1, position + z-index, isolation, filter, will-change…), in plain words.
- Done (10–12): `apps/extension` is a Chrome MV3 extension (Vite builds the React side panel, esbuild the IIFE content script and service worker). The content script is registered only for enabled sites (`localhost` and `127.0.0.1` by default; others are added from the panel with an optional host permission) and draws in a shadow root. The pure parts are in `packages/core/src/inspect/` with tests: `stackingReasons`, `stackingTree`, `compareStacking`, `gapBetween`, `checkType` and `qaReport`. Not yet on the Chrome Web Store: load `apps/extension/dist` unpacked. The workbench has both too: the QA overlay compares a page screenshot with the design (`diffPixels` in `inspect/diff.ts` finds and boxes the areas that drift), and the stacking inspector scans pasted HTML and CSS in a preview frame with the scan the extension uses (`apps/web/src/lib/stackingScan.ts`) and the same panel.

---

## Phase 5: Variant canvas (v0.5)

### - [x] 13. Render every prop combination

- Vite and Next.js plugin that finds a component's props (from its TypeScript types) and renders sizes × states × themes on a grid.
- Forms from the form builder preview as empty, filled, error and submitting.
- Done: `packages/variants` (`@stacksketch/variants`) reads components and props with the TypeScript compiler (`props.ts`), serves `/__variants` from a Vite plugin (`vite.ts`) or writes a Next.js page while `next dev` runs (`next.ts`), and renders the grid with per-cell error boundaries (`canvas.tsx`). The grid logic is `packages/core/src/variants/grid.ts`. `packages/variants/fixture` is a small app to try it on (`pnpm --filter @stacksketch/variants fixture`). Forms get a States view in the form builder, filled in by `sampleFormValues`. Not yet on npm. The workbench's Variant canvas page reads props from one pasted file's text (`componentsFromSource` in `variants/source.ts`), compiles it with sucrase (lazy) and draws the grid in a shadow root.

---

## Phase 6: Bridges (v0.6)

### - [x] 14. DB to code, with Schemasketch

- Import a Schemasketch project file; each table becomes a shared-schema type.
- Generate Prisma schema, SQL migrations and CRUD endpoint stubs (Express / Next.js route handlers).
- Done: `packages/core/src/db/` reads DBML and Schemasketch project files (`parseDbml`, `readSchemasketchFile`) and generates shared-schema types, Prisma 7 schemas (validated in the tests by Prisma's own schema engine, for PostgreSQL, MySQL and SQLite), SQL migrations (run in the tests on PGlite and `node:sqlite`), a CRUD contract (`dbCrudContract`, which the module adds to the API contract) and Express and Next.js handlers (type-checked with the contract's Zod schemas). The module is `apps/web/src/modules/db-code/`.

### - [x] 15. API flows

- Sequence diagrams built from contract endpoints (login → refresh token → fetch profile), with the data each step sends.
- Export SVG and Mermaid.
- Done: `packages/core/src/flows/flow.ts` (`flowSequence`, `toMermaid`, `toSequenceSvg`) and the module in `apps/web/src/modules/flows/`. Each step is a contract endpoint and the response it shows (the success one, or an error to draw the failure path), with an optional note.

---

## Phase 7: API client (v0.7), both sides test the same requests

### - [x] 16. Send requests to the real API, checked against the contract

- Requests with params, headers, auth and bodies; environments with `{{variables}}`; folders; history for the session.
- Checks on status, time, headers and body values, and a check that the response matches the contract endpoint. Values captured from a response feed the next request. A runner sends a folder in order and writes a Markdown report.
- Gets past CORS without a server of ours: through the browser extension's service worker, or `stacksketch proxy` on the developer's machine. A mock transport answers from the contract in the tab.
- Imports cURL and Postman collections and environments; exports Postman collections.
- This changes the "never send requests from the app" rule from phase 1: the app still sends nothing on its own, but the API client sends the requests the user writes, to the URLs they type.
- Done: the model is pure, in `packages/core/src/request/`: `model.ts` (building, variables, cURL, assertions, captures, requests from contract endpoints), `check.ts` (`checkShape`, `checkContract`, `findEndpoint`), `postman.ts`, `runner.ts` (`runRequests`, `runReport`), `send.ts` (`sendWithFetch`, shared by the page, the extension and the proxy) and `bridge.ts` (the page-to-extension messages). Tested in `request.test.ts`. The module is `apps/web/src/modules/api-client/` (store `stacksketch:client`). The extension adds `bridge.js` (relays the page's requests) and a grant window that asks for a host's permission; `packages/cli/src/proxy.ts` is `stacksketch proxy`, which only answers allowed origins on 127.0.0.1.
