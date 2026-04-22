# Copilot Instructions

## Build, Test, Lint

```bash
npm run build        # Compile TypeScript (tsc) → dist/
npm test             # Run all tests (vitest run)
npm run test:watch   # Run tests in watch mode
npx vitest run src/__tests__/export.test.ts                # Run a single test file
npx vitest run src/__tests__/export.test.ts -t "resolveList"  # Run a single describe/test by name
```

No linter is configured.

## Architecture

This is a CLI tool that exports Microsoft To-Do task lists to Markdown via the Microsoft Graph API.

- **`src/index.ts`** — CLI entry point using Commander. Defines `todo list` and `todo export` commands. Global `--verbose` flag for detailed error diagnostics.
- **`src/auth.ts`** — OAuth 2.0 device-code flow via MSAL. Caches tokens at `~/.todo-cli/token-cache.json`. Uses `Tasks.ReadWrite` scope (required for attachment access on personal accounts).
- **`src/graph.ts`** — Microsoft Graph API client. Defines the `TodoTask`, `TodoTaskList`, `ChecklistItem`, `LinkedResource`, `TaskAttachment`, and `RecurrencePattern` interfaces. Uses the `/lists/delta` endpoint (workaround for a Graph API bug that omits some lists). Fetches tasks with `$expand=checklistItems,linkedResources`. Separate functions for attachment metadata and content download.
- **`src/export.ts`** — Core logic: list resolution, formatting, ordering-source parsing, metadata formatting, Markdown rendering (including HTML-to-Markdown conversion via Turndown), attachment download, and file writing. All pure-logic functions are exported individually for testing.

Data flows in one direction: `index → export → graph → auth`.

## Conventions

- **ES module imports use `.js` extensions** (e.g., `import { foo } from "./bar.js"`), required by Node16 module resolution even though source files are `.ts`.
- **User-facing messages go to `stderr`** (`console.error`), keeping `stdout` clean for potential piped output.
- **Tests mock `graph.ts` and `node:fs`** using `vi.mock()` at the top of the test file, so the export logic can be tested without network calls or filesystem side effects.
- **List resolution** follows a strict priority: exact ID → exact name (case-insensitive) → partial name (case-insensitive substring). See `spec.md` for the full specification.
- **Keep `README.md`, `spec.md`, and this file up to date** when adding or changing commands, options, output format, or architecture.
