# Stacksketch

**One local workbench for the contract between frontend and backend.**

Paste an API response and get TypeScript types, Zod schemas, realistic mock data, a typed fetch function and JSON Schema in one go. Later phases add a form builder, an API contract designer, a mock API server and a browser extension for pixel-perfect QA, all reading the same shared schema.

Free, open source, no account, no backend. Everything runs in your browser and nothing you paste is uploaded.

> Status: **phase 1** (API explorer). See [ROADMAP.md](ROADMAP.md) for what's next.

## What works today

### API explorer

- Paste a JSON response, open a `.json` file, or start from the sample.
- **Structure tree**: every nested object as a named type, with optional and nullable fields, detected formats (`uuid`, `email`, `date-time`, `date`, `uri`) and integer vs decimal numbers. Hover a field to see sample values.
- **TypeScript**: `interface` or `type`, optional `readonly`, format notes as comments.
- **Zod 4**: schemas with `z.email()`, `z.uuid()`, `z.iso.datetime()` and friends, each with its inferred type.
- **Mock data**: realistic, seeded fake data that passes its own Zod schema. It reuses real values from your sample for fields like `status` and `currency`.
- **Fetch**: a typed `fetch` wrapper. Path params (`/users/:id` or `/users/{id}`) become arguments, and it validates the response with Zod (or just casts, if you prefer).
- **JSON Schema** (draft 2020-12), ready for OpenAPI 3.1.
- Arrays of objects are merged, so a key missing from some items becomes optional and a key that's sometimes `null` becomes nullable.
- Clear JSON errors with line and column ("Trailing comma before '}'"), and a click jumps to the spot.
- Copy or download every output. Light and dark themes. Works at phone width.

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

The API explorer creates it, the form builder will turn it into fields, and the contract designer will attach it to endpoints. That's what lets a response become types, then a form, then a mocked endpoint, without retyping anything.

## Sibling project

Schemasketch draws database diagrams from DBML. Phase 6 connects the two, so a diagram can become Prisma schema, migrations and CRUD endpoints here.

## License

MIT
