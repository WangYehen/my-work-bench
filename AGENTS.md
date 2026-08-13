# Repository Guidelines

## Project Structure

- `Workbench/` contains the Vite + React application, local read-only server, shared data code, worker code, templates, and tests.
- `Workbench/src/` holds UI pages and components; `Workbench/server/`, `shared/`, and `worker/` contain runtime and indexing logic.
- `Workbench/tests/` contains Node test files (`*.test.mjs`). `Workbench/public/` and `Workbench/docs/` hold static assets and documentation.
- `个人知识库/` is the repository’s synthetic demo Vault. Do not place real personal data in it.

## Development Commands

Run commands from `Workbench/`:

```bash
npm install                 # install dependencies
npm run dev                 # start the loopback Vite server
npm test                    # build, then run the full test suite
npm run build               # create the production/site build
npm run privacy:scan        # scan the repository for private data
npm run demo:generate       # regenerate synthetic Douyin demo data
```

Use `npm run preview` to inspect a production build locally. Keep the app loopback-only by default.

## Coding and Naming Conventions

Use existing JavaScript/JSX patterns, two-space indentation, semicolons, and single-quoted strings where the surrounding file does. Name React components and page files in `PascalCase` (for example, `GraphPage.jsx`); name hooks and utility modules in `camelCase` (for example, `useVaultSync.js`). Keep route-specific styles and data contracts close to their feature. No repository-wide formatter or linter is configured, so match nearby code and run the relevant tests after edits.

## Testing Guidelines

Tests use Node’s built-in test runner. Name tests `*.test.mjs`; use focused scripts such as `npm run test:graph-motion` or `npm run test:social-insights` during development, then run `npm test` before submitting. Release changes must also pass `npm run build` and `npm run privacy:scan`.

## Commits and Pull Requests

Use short, imperative commit subjects consistent with the history, such as `Update README.md` or `Add Wiki agent maintenance schema`. Pull requests should explain the user-visible change, list validation commands, link related issues when applicable, and include screenshots or recordings for UI changes.

## Security and Data Boundaries

Only use clearly labelled synthetic demo data with invented titles, IDs, dates, and metrics. Never commit real Vault files, exports, comments, credentials, local paths, screenshots, or reports. Store local overrides in ignored files such as `Workbench/.env` and `Workbench/config/attention.local.json`; use `PERSONAL_DASHBOARD_VAULT_ROOT` for an external Vault.
