# Baseline Planning Suite

Three independently deployable micro-frontends on Rsbuild 2 + Module Federation 2: `apps/shell`
(host), `apps/people` and `apps/delivery` (remotes owned by two different teams). README.md explains
how they fit together and which domain rules are implemented.

## Commands

Run from the repository root:

- `pnpm test` — Vitest; domain tests run in Node, no browser
- `pnpm typecheck` — also compiles each `src/domain` with `tsconfig.domain.json` (no DOM, no Node)
- `pnpm lint`, `pnpm knip` (unused files, exports, dependencies), `pnpm format:check`
- `pnpm build`
- `pnpm dev` — shell :3000, people :3001, delivery :3002
- `pnpm --filter @baseline/people dev:server`, `…/delivery dev:server` — the APIs on :3011, :3012
- `docker compose up --build` — the whole system on :8080 behind the shell's gateway
- `pnpm smoke`, `pnpm e2e` — against that running stack: gateway checks and Playwright (set
  `E2E_BROWSER_CHANNEL=msedge` to use an installed browser)

## Boundaries

These are enforced by lint and tsconfig; keep them green rather than working around them.

- Teams meet only through `contracts/*` (`@baseline/*-contract`): types and runtime schemas, no
  behaviour. Never import another app's source.
- `apps/*/src/domain` is plain TypeScript: no React, no DOM, no I/O, no contracts. Contract data is
  mapped to domain types outside the domain.
- `apps/*/src/application` imports only application and domain code and no React; it reaches the
  network and browser storage only through its ports.
- The shell owns display currency and the active user and passes them as `RemoteAppProps`; each
  remote owns everything else it shows.
- Remote URLs come from runtime configuration, never from the bundle.

## Domain conventions

- Allocations are stored in person-months only; hours, % of capacity and cost are conversions at
  the edges. Money is EUR internally.
- Domain operations that can fail return `Result`; value constructors (`isoDate`, `yearMonth`,
  `rateTimeline`) throw `RangeError` on invalid input.
- Dates are `IsoDate` / `YearMonth` branded strings; date arithmetic is UTC only.
- Values are rounded only for display, and displayed totals must equal the sum of displayed parts.

## Code style

- TypeScript strict, no `any`. Prefer discriminated unions and branded types to flags and casts.
- No UI component, table, grid or tree libraries; styles are CSS Modules.
- Tests sit next to the code (`*.test.ts`). Use fast-check properties for invariants, and check
  that a property can actually fail.
- Comments explain a non-obvious why only. Don't restate the code or describe what doesn't exist yet.
- README describes only what exists; update it in the same change.

## Workflow

- Work in small, reviewable steps; finish each with format, typecheck, lint, test and build green.
- Don't commit or push — the maintainer does. Don't edit `seed/`: fixtures stay byte-for-byte.
