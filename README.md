# Baseline Planning Suite

Baseline answers one question for a delivery organisation: who is working on what, for how long,
and what it costs. It is built as three independently deployable micro-frontends — **shell**,
**people** and **delivery** — owned by two teams that never import each other's source.

> Work in progress. This README only describes what already exists; it grows with the code.

## Repository

| Path                      | What it is                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| `seed/baseline-seed.json` | Fixtures shipped with the exercise. Ids and values are kept verbatim.    |
| `tsconfig.base.json`      | Strict compiler settings every package extends.                          |
| `eslint.config.js`        | Type-aware lint rules shared by the whole workspace (`no-explicit-any`). |

## Development

Requires Node 24 and pnpm (version pinned in `package.json` → `packageManager`).

```bash
pnpm install
pnpm lint
pnpm format:check
```
