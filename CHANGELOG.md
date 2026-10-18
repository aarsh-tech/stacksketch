# Changelog

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
