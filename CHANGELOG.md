# Changelog

## Unreleased: bridges (phase 6)

- **DB to code**: read DBML or a Schemasketch project file and get shared-schema types, a Prisma 7 schema (PostgreSQL, MySQL, SQLite), SQL migrations for the same three, and CRUD handlers for Express or Next.js. One click adds every table to the API contract with CRUD endpoints.
- The tests check the output with the real tools: Prisma's schema engine, PostgreSQL (PGlite) and SQLite run the migrations, and the handlers type-check with the contract's Zod schemas.
- **API flows**: sequence diagrams built from contract endpoints, with the data each step sends and gets back, error paths and notes, exported as SVG or Mermaid.

## Unreleased: the variant canvas (phase 5)

- **`@stacksketch/variants`**: a Vite plugin and a Next.js config wrapper that serve `/__variants`, with every exported component rendered as a grid of its prop combinations per theme. Props are read from TypeScript; enum and boolean props become rows and columns, the rest get controls.
- Broken variants are caught per cell and counted.
- **Form states**: the form builder's States view shows a form empty, filled in, with errors and submitting. Sample values come from `sampleFormValues`, tested against the form's own schema.

## Unreleased: the browser extension (phase 4)

- **Browser extension** (`apps/extension`, Chrome MV3) with a side panel. It only runs on sites you turn it on for, `localhost` by default.
- **QA overlay**: a Figma PNG over the page with opacity, difference blending, @2x/@3x scale, arrow-key nudging and locking to an element.
- **Measure**: element size and type on hover, the gap between two elements drawn on the page, and type checked against the design's values.
- **Comments and report**: numbered pins with screenshots, exported as a Markdown QA report.
- **Stacking inspector**: every stacking context as an exploded 3D stack, why each one is a context in plain words, and which of two paints on top and why.

## Unreleased: the form builder (phase 2) and the API contract (phase 3)

### API contract

- **API contract**, a new module for designing the endpoints both sides agree on: method, path, path and query params, a JSON request body, and a response per status code (including `default`). Endpoints are grouped by resource.
- Bodies, responses and params are shared-schema types that every endpoint reuses. Edit a type's fields, rename it everywhere at once, and see what uses it before deleting it.
- **From the API explorer**: add the explorer's response as an endpoint. Its URL is split into base URL, path and query params, matching types are reused and clashing ones renamed.
- **OpenAPI 3.1 export** (YAML or JSON) and **OpenAPI 3.0 / 3.1 import**, read locally. The import understands `$ref`, `allOf`, `oneOf`/`anyOf` and both ways of writing nullable, names inline objects from where they sit, and lists what it had to simplify or leave out.
- **Typed client**: a `fetch` function per endpoint with typed path params, query params and **request body**, and a Zod-checked (or cast) return type. Error statuses throw `ApiError` with the status and body. It ships with the contract's TypeScript types and Zod schemas. The tests compile all three together under strict `tsc` (`exactOptionalPropertyTypes` included) and call the client against a stubbed `fetch` with real Zod.
- Problems (duplicate routes, object query params, a body on a GET, a type that's gone) are listed and marked; those parts are left out of the output until they're fixed.
- Zod output declares recursive types (a category holding its subcategories) with getters, the way Zod 4 expects.

### Mock API server

- **`stacksketch mock <file>`** (`packages/cli`) serves a contract or an OpenAPI 3 file locally, with data from the mock generator, CORS on, and path params echoed into the data.
- Per-endpoint delay and forced status, set in the endpoint editor; `?__status=` / `?__delay=` or `x-mock-*` headers on any request; a global `--delay`.
- In-memory CRUD (POST then GET returns what you created), reload on save, and plain-English 404, 405 and 400 answers.
- The contract designer downloads `contract.json` for it.

### Form builder

- **Form builder**, a new module. Drag text, paragraph, number, dropdown, radio, checkbox, date and file fields onto a form, reorder them by mouse, touch or keyboard, and group them into sections and steps.
- **New form from a type**: pick a type from the API explorer and its fields come in with their types and required-ness; nested objects become sections. What's left out (lists, mixed types, `id`, `createdAt`) is listed with the reason.
- Per-field validation (required, min, max, pattern) with custom messages, and conditional visibility ("show GST number only if business type is company").
- A Zod 4 schema for the form's values. Its tests run it against real Zod and type-check it under strict `tsc`, including forms with problems still to fix.
- **React component export**: React Hook Form with the form's Zod schema as its resolver, styled with Tailwind. Multi-step forms check each step before the next and jump back to the first step with an error; fields hidden by their condition drop out of the values. It compiles and runs unedited in a fresh Vite + React + TypeScript app.
- **Preview**: fill the form in on the canvas, with the exported schema's messages, steps and conditional fields, and see the values `onSubmit` gets.
- Whole-number fields check with `Number.isInteger` rather than Zod's `.int()`, which stops the parse and hid "required when shown" errors on other fields.

## v0.1.0: the API explorer (2026-10-18)

The first release of Stacksketch: paste an API response and get the code both sides of the contract need. It runs entirely in your browser. Nothing you paste or import is uploaded, and no request is ever sent from the app.

### Read a response

- Paste JSON, open one or more `.json` files, or start from the built-in sample.
- **Several samples at once.** Add a tab per response from the same endpoint and they merge into one schema, so keys missing from some responses become optional and keys that are sometimes `null` become nullable. A tab with broken JSON is left out (and marked) until you fix it.
- **Import from DevTools.** Pick JSON responses out of a HAR file, or paste a "Copy as cURL" command to set the method and URL for the client code. Both are parsed locally.
- Clear JSON errors with line and column, for example "Trailing comma before '}'". Click one to jump to it.
- Responses over about 500 KB are parsed in a Web Worker, so typing stays smooth.

### See and edit the structure

- **Tree view**: every nested object as a named type, with optional and nullable fields, detected formats (`uuid`, `email`, `date-time`, `date`, `uri`) and integer vs decimal numbers.
- **Graph view**: one card per type with an edge for each reference, laid out automatically. Click a card to highlight its declaration in the generated code. Pan and pinch-zoom by touch; export PNG or SVG.
- **Edit the schema**: change a field's type or format, mark it optional, required or nullable, rename a type, or turn a string into an enum of its sample values. Fields like `status` and `currency` offer it in one click. Edits sit on top of inference, so they survive a reload and pasting a new sample.

### Generate code

- **TypeScript**: `interface` or `type`, optional `readonly`.
- **Validation**: Zod 4, Valibot 1 or Yup 1, each with its inferred type.
- **Mock data**: realistic, seeded, and it passes its own schema.
- **Client code**: a typed `fetch` function, an Axios function, or a TanStack Query hook. Path params become arguments; responses are validated with Zod or cast.
- **JSON Schema** (draft 2020-12, the format OpenAPI 3.1 uses).
- **Pydantic v2** models and **Go** structs with `json` tags.

Every generator is tested by running or compiling its output: the TypeScript outputs type-check under `tsc`, the Zod, Valibot and Yup schemas validate the sample and reject broken data, the Pydantic models validate in Python, and the Go structs are checked with `gofmt` and `go vet` when Go is installed.

### Also

- Light and dark themes; works at phone width, one pane at a time.
- Copy or download every output.
- The shared schema format (`packages/core/src/types.ts`) is at version 2, which adds enums. Version 1 data still loads.

### What's next

Phase 2 is the form builder: turn a type from the explorer into a form with validation and export React Hook Form + Zod code. See [ROADMAP.md](ROADMAP.md).
