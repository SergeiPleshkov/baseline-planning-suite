# Baseline Planning Suite

Baseline answers one question for a delivery organisation: who is working on what, for how long,
and what it costs. It is built as three independently deployable micro-frontends — **shell**,
**people** and **delivery** — owned by two teams that never import each other's source.

> Work in progress. This README only describes what already exists; it grows with the code.

## How the pieces fit

```
shell (host, :3000) ── reads /config.json at start-up ──► registers remotes at runtime
   │  pushes display currency + active user as props (@baseline/host-contract)
   ├──► people   (remote, :3001)  exposes ./App
   └──► delivery (remote, :3002)  exposes ./App
```

- **Runtime remote resolution.** No remote URL is compiled into the shell. It fetches
  `/config.json` when it starts and registers `people` and `delivery` from there
  (`apps/shell/public/config.json` is the development copy).
- **One React.** `react` and `react-dom` are shared as `singleton` with `strictVersion`. Hosted,
  the remotes run on the shell's React; a remote built for an incompatible major fails to load
  instead of starting a second React.
- **Standalone and hosted from one build.** Each remote's `index.html` mounts the same component
  the shell loads through `./App`, wrapped in a minimal stand-in host.
- **Isolation on failure.** Every remote renders in its own panel with a load timeout, an error
  boundary and a Retry button. A failing remote is replaced by a message; the rest keeps working.
- **Team boundaries are linted.** Packages reach each other only through `@baseline/*-contract`
  packages; relative imports into another package fail `pnpm lint`.

## Repository

| Path                      | What it is                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| `apps/shell`              | Host: navigation, display currency, active user, remote loading.        |
| `apps/people`             | Remote: the employee register (team People).                            |
| `apps/delivery`           | Remote: work breakdown and staffing grid (team Delivery).               |
| `contracts/host`          | Host contract v1 — what the shell pushes into every remote.             |
| `seed/baseline-seed.json` | Fixtures shipped with the exercise. Ids and values are kept verbatim.   |
| `tsconfig.base.json`      | Strict compiler settings every package extends.                         |
| `eslint.config.js`        | Type-aware lint rules (`no-explicit-any`, hooks, team-boundary checks). |

## Development

Requires Node 24 and pnpm (version pinned in `package.json` → `packageManager`).

```bash
pnpm install
pnpm dev        # shell http://localhost:3000 · people :3001 · delivery :3002
pnpm typecheck
pnpm lint
pnpm build
```

Each remote also runs on its own: open http://localhost:3001 or http://localhost:3002.

## Breaking a remote on purpose

- In the shell header open **Diagnostics → Break People** (or Delivery). This adds
  `?break=people` to the URL; the shell then points that remote at an entry that does not exist,
  exactly like a missing deployment. The panel explains what failed, the other panel keeps working.
  **Restore all remotes** removes the parameter.
- Or stop a remote's dev server: its panel times out with a message; start the server again and
  press **Retry** — the remote loads without reloading the page.
