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

### - [ ] 9. Mock API server (`packages/cli`)

- `npx stacksketch mock contract.json` serves every endpoint locally, with data from the same mock generator.
- Per-endpoint delay and forced status (to build loading and error states), CORS on by default.
- Optional in-memory CRUD so POST then GET returns what you created.
- The workbench can export the contract file the CLI reads.

---

## Phase 4: Companion browser extension (v0.4), `apps/extension`

### - [ ] 10. Extension plumbing

- Chrome MV3 extension built with Vite: content script, side panel, messaging. Only runs on pages the user turns it on for (localhost by default).

### - [ ] 11. Pixel-perfect QA overlay

- Drop a Figma frame export (PNG) over the page; opacity slider, difference blend, nudge with arrow keys, lock to an element.
- Measure tool: distances between elements, computed font size and line height vs the design.
- Pin comments; export a QA report (Markdown with screenshots).

### - [ ] 12. Stacking inspector

- Exploded 3D view of stacking contexts with their z-index.
- Explain why an element creates a stacking context (transform, opacity < 1, position + z-index, isolation, filter, will-change…), in plain words.

---

## Phase 5: Variant canvas (v0.5)

### - [ ] 13. Render every prop combination

- Vite and Next.js plugin that finds a component's props (from its TypeScript types) and renders sizes × states × themes on a grid.
- Forms from the form builder preview as empty, filled, error and submitting.

---

## Phase 6: Bridges (v0.6)

### - [ ] 14. DB to code, with Schemasketch

- Import a Schemasketch project file; each table becomes a shared-schema type.
- Generate Prisma schema, SQL migrations and CRUD endpoint stubs (Express / Next.js route handlers).

### - [ ] 15. API flows

- Sequence diagrams built from contract endpoints (login → refresh token → fetch profile), with the data each step sends.
- Export SVG and Mermaid.
