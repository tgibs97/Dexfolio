# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React 19 + TypeScript SPA: page-level composition lives in `App.tsx`, reusable UI in `src/components/`, and browser API/catalog helpers beside their tests. `worker/` contains the Hono API, authentication, validation, D1 access, and R2 image handling. Shared request and domain types belong in `shared/`. Worker integration tests live in `test/worker/`; UI tests are colocated as `*.test.ts` or `*.test.tsx`. Database changes go in numbered SQL files under `migrations/`, maintenance utilities in `scripts/`, and production output in generated `dist/`.

## Build, Test, and Development Commands

- `npm ci`: install the locked Node 22+ dependency set.
- `npm run dev`: build fallback assets, then run Vite on port 5173 and Wrangler on 8787.
- `npm run build`: produce the deployable SPA in `dist/`.
- `npm test`: run both browser/component and Cloudflare Worker test suites.
- `npm run test:watch`: run UI tests interactively while developing.
- `npm run check`: run formatting, linting, type checks, all tests, and a production build; use this before opening a PR.
- `npm run db:migrate:local` / `npm run db:seed:local`: initialize local D1 data.

## Coding Style & Naming Conventions

Use strict TypeScript and functional React components. Prettier enforces 2-space indentation, single quotes, trailing commas, and a 120-character line width; run `npm run format`. ESLint includes TypeScript, React Hooks, and Vite refresh rules. Name components and their files in PascalCase (`CardDialog.tsx`), functions and variables in camelCase, and tests after the unit under test (`Binder.test.tsx`). Keep cross-runtime types in `shared/` rather than duplicating them.

## Testing Guidelines

Vitest, Testing Library, and `happy-dom` cover the UI. Worker tests use Cloudflare's Vitest pool with real migration setup for D1/R2 workflows. Add regression tests with behavior changes, including authorization and validation cases for API mutations. No numeric coverage threshold is configured; meaningful workflow coverage is expected.

## Commit & Pull Request Guidelines

History currently contains only `Init`, so no formal commit convention is established. Use short, imperative subjects such as `Add card history filtering`. Keep commits focused. PRs should explain the user-visible change, note schema or configuration impacts, link relevant issues, and include screenshots for UI changes. Confirm `npm run check` passes.

## Security & Configuration

Copy `.dev.vars.example` to `.dev.vars` for local secrets; never commit passwords, session secrets, API keys, `.wrangler/`, or generated output. Review migrations and remote seed/deploy commands carefully because they affect production Cloudflare resources.
