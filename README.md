# Stacksketch

**One local workbench for the contract between frontend and backend.**

Paste an API response and get TypeScript types, a Zod, Valibot or Yup schema, realistic mock data, a typed fetch, Axios or TanStack Query client, JSON Schema, Pydantic models and Go structs in one go. The form builder turns any of those types into a form with validation and conditional fields. Later phases add an API contract designer, a mock API server and a browser extension for pixel-perfect QA, all reading the same shared schema.

Free, open source, no account, no backend. Everything runs in your browser and nothing you paste is uploaded.

> Status: **v0.1.0, phase 1** (API explorer), with phase 2 (the form builder) built and waiting for its release. See [CHANGELOG.md](CHANGELOG.md) for what's in it and [ROADMAP.md](ROADMAP.md) for what's next.

![Pasting a response, flipping through the outputs, picking a type on the graph and turning a field into an enum](docs/screenshots/demo.gif)

| Light, editing a field | Dark, graph view | Phone |
| --- | --- | --- |
| ![The API explorer in light mode: the response, the structure tree with a field editor open, and the Zod schema](docs/screenshots/explorer-light.png) | ![The API explorer in dark mode: the schema as a graph with the Buyer type highlighted in the TypeScript output](docs/screenshots/explorer-dark-graph.png) | ![The structure tree at phone width in dark mode](docs/screenshots/explorer-phone.png) |

## What works today

### API explorer

- Paste a JSON response, open `.json` files, or start from the sample.
- **Several samples at once**: add a tab per response from the same endpoint and they merge into one schema, which is the surest way to find optional fields. A tab with broken JSON is left out until you fix it.
- **Import from DevTools**: pick responses out of a HAR file (Network → "Save all as HAR with content"), or paste a "Copy as cURL" command to set up the client code. Both are read locally; nothing is sent.
- **Structure tree**: every nested object as a named type, with optional and nullable fields, detected formats (`uuid`, `email`, `date-time`, `date`, `uri`) and integer vs decimal numbers. Hover a field to see sample values.
- **Edit the schema**: click the pencil on any field to change its type or format, mark it optional, required or nullable, turn a string into an enum of its sample values, or rename the type it holds. Fields like `status` and `currency` offer "enum?" in one click. Edits live on top of inference, so they survive a reload and pasting a new sample, and every output picks them up.
- **Graph view**: switch the Structure pane from Tree to Graph to see one card per type with an edge for each reference, laid out automatically. Click a card to highlight its declaration in the generated code. Pan and pinch-zoom by touch, and export the graph as PNG or SVG.
- **TypeScript**: `interface` or `type`, optional `readonly`, format notes as comments.
- **Validation**: Zod 4, Valibot 1 or Yup 1 schemas, each with its inferred type and the right checks for emails, UUIDs, URLs and dates.
- **Mock data**: realistic, seeded fake data that passes its own Zod schema. It reuses real values from your sample for fields like `status` and `currency`.
- **Client code**: a typed `fetch` wrapper, an Axios function or a TanStack Query hook (`useQuery` for GET, `useMutation` otherwise). Path params (`/users/:id` or `/users/{id}`) become arguments, and the response is validated with Zod (or just cast, if you prefer).
- **Pydantic and Go**: Pydantic v2 models with snake_case fields and aliases, and Go structs with `json` tags, pointers for nullable fields and named types for enums.
- **JSON Schema** (draft 2020-12), ready for OpenAPI 3.1.
- Arrays of objects are merged, so a key missing from some items becomes optional and a key that's sometimes `null` becomes nullable.
- Big responses (over about 500 KB) are parsed in a Web Worker, so typing stays smooth.
- Clear JSON errors with line and column ("Trailing comma before '}'"), and a click jumps to the spot.
- Copy or download every output. Light and dark themes. Works at phone width.

### Form builder

- **Drag fields onto a form**: text (plain, email, URL, phone, password), paragraph, number, dropdown, radio, checkbox, date (with or without a time) and file. Drag from the list, or click to add below the selected field.
- **Reorder** by dragging a field's handle, from the keyboard (focus the handle, Space, arrow keys, Space), or with Alt + ↑ / ↓ on a selected field.
- **Sections and steps**: drop a Section to group the fields below it under a heading, or a Step to start a new page of a multi-step form.
- **Start from a type**: pick any type the API explorer found (with your schema edits) and get its fields with types and required-ness filled in. Nested objects become sections with dotted keys (`buyer.email`). Lists, mixed types and server-set keys like `id` and `createdAt` are left out, and the dialog says why.
- **Validation per field**: required, min and max (characters for text, the value for numbers, megabytes for files), a regex pattern, and your own message for each rule. Default messages are plain English, built from the label ("Enter GST number").
- **Conditional fields**: show a field only when another one is, isn't, is filled in or is empty ("show GST number only if business type is company"). It's only required while it shows.
- **Zod schema** for the form's values, with every rule and message. Conditional fields are checked when they show, even while other fields still have errors, so multi-step forms validate step by step.
- **React component**: a React Hook Form + Zod component styled with Tailwind, next to its schema file. Steps check their own fields before moving on, hidden fields drop out of the values, inputs are labelled and wired to their hints and errors for screen readers, and it builds unedited in a fresh Vite app (`pnpm add react-hook-form @hookform/resolvers zod`).
- **Preview**: switch the canvas to Preview and fill the form in. It validates with the exact schema you'd export, walks through the steps, shows and hides conditional fields, and shows the values `onSubmit` would get.
- Problems are marked on the form (a duplicate key, a regex that doesn't compile, a condition on a field that's gone), and the code leaves those parts out until they're fixed, so it always compiles.
- Several forms, kept in your browser. Delete a field or a form and undo it from the toast.

## Run it locally

You need Node 20.19+ and pnpm.

```bash
pnpm install
pnpm dev        # http://localhost:5174
```

Other commands, from the repo root:

```bash
pnpm test       # unit tests (packages/core)
pnpm typecheck
pnpm lint
pnpm build      # builds apps/web into apps/web/dist
```

## How the repo is laid out

```
apps/
  web/              the workbench (Vite + React + Tailwind)
packages/
  core/             @stacksketch/core: the shared schema format, inference and code generators (pure TypeScript, no DOM)
```

Coming in later phases: `apps/extension` (QA overlay and stacking inspector), `packages/cli` (mock API server, `npx stacksketch mock`) and a Vite/Next plugin for the variant canvas.

## The shared schema

Every module speaks one format, defined in `packages/core/src/types.ts`. Objects are named types, and fields point at them with refs:

```ts
{ version: 1, rootName: 'OrdersResponse', root: { kind: 'ref', name: 'OrdersResponse' }, types: [/* Order, Buyer, … */] }
```

The API explorer creates it, the form builder turns it into fields (and gives one back for the form's values), and the contract designer will attach it to endpoints. That's what lets a response become types, then a form, then a mocked endpoint, without retyping anything.

## Sibling project

Schemasketch draws database diagrams from DBML. Phase 6 connects the two, so a diagram can become Prisma schema, migrations and CRUD endpoints here.

## License

MIT
