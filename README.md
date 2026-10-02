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

## Contracts

Teams meet only in `contracts/*`: zod schemas, the types inferred from them and a description of
what the data means, with no behaviour. A consumer validates what it receives and maps it into its
own model; TypeScript types alone would not protect two apps that are deployed independently and
whose versions can drift.

- **`@baseline/host-contract`** — display currency and active user, passed by the shell to every
  remote and checked by version number.
- **`@baseline/people-contract`** — employees, rate records and the `rates-changed` event. A rate
  applies from its `validFrom` (inclusive) until the day before the employee's next record; before
  the first there is none; at most one record per day. It also ships `rateSemanticsVectors`: worked
  examples that People and Delivery each run against their own reading of the rules, so a
  disagreement fails a test instead of mispricing an allocation.
- **`@baseline/delivery-contract`** — workload per employee-month, either within capacity or over
  it with the allocation to blame, and the `workload-changed` event.
- The contracts define events as notifications: they say who changed and the consumer re-reads the
  data. Adding an optional field keeps v1, and so does a new event type, since a consumer dispatches
  on the SSE event name; consumers ignore fields they do not know. A change of meaning is a new
  version.
- Delivery reads People's payloads in one place, `apps/delivery/src/infrastructure/peopleContract.ts`.
  A rate history that parses but contradicts itself (two records on one day) is refused as a whole:
  there is no right answer to price the person's days with. So is a payload that uses an id twice.

## Domain rules

Calculation logic lives in `apps/delivery/src/domain` as plain TypeScript and is tested without a
browser. That folder compiles against its own `tsconfig.domain.json` (no DOM, no Node types), and
lint rejects React, contracts or app code imported from it. `apps/people/src/domain` follows the
same rules for the rate history and the register search, listed at the end of this section.

- **Working days** are Monday to Friday; public holidays are ignored.
- **Rates are effective-dated.** A rate applies from its `validFrom` (inclusive) until the next one;
  the last has no end; before the first there is no rate, so those days cost nothing and are
  reported as unpriced.
- **Months split.** An allocation is spread evenly over the month's working days; each run of days
  at one rate is a slice priced at that rate. One person-month is `weeklyHours × workingDays / 5`.
- **Four units, one stored value.** Allocations are stored in person-months only. Hours, % of
  capacity and cost (in the display currency) are computed for one employee-month on the way out;
  a value typed in any unit is converted back. Cost converts through that month's blended rate, so
  it cannot be entered for a month without any rate. Switching units never writes anything.
- **Display rounding reconciles.** `roundForDisplay` (`apps/delivery/src/domain/rounding`) rounds
  a grid of rows × months for display so that every total equals the sum of the figures it totals:
  along a row, down a column (a group's row is the sum of its children) and overall. Each figure is
  its exact value rounded down or up and the grand total is rounded to nearest. Totals and group
  figures stay as close to exact as possible and leaf cells absorb the rest — on a single row that is
  largest-remainder rounding. Values count as the decimals they are written as: 1.005 is exactly half
  a cent, although binary floats store it just below.
- **The work breakdown** nests at most three levels deep within one project; a parent's figures
  are derived from its children. Adding a child to a leaf that holds allocations moves them onto the
  new child instead of dropping them. Moving an item under such a leaf is refused: the arriving item
  may be a parent, or hold its own allocations for the same people and months, so the leaf's
  allocations would have nowhere to go. Deleting an item takes its subtree and their allocations;
  the user confirms a summary first, and if anything in it changed meanwhile nothing is deleted.
- **Allocations** sit on leaves, inside their project's months, one per person, item and month;
  setting one to zero removes it. A changed amount takes a revision above every current one, which
  orders edits for the capacity check below.
- **Capacity is cross-project.** A person's load in a month is the sum of their allocations on every
  project. Above one person-month (100 %) they are over capacity, and the cause is the most recently
  edited allocation that contributes. Over-allocation is flagged, never blocked.
- **Edit order in the seed.** The seed carries no timestamps, so the order of the file stands in for
  the order of edits: an allocation listed later counts as edited more recently, and is the one
  blamed when a person-month is over capacity.
- The case study's reference calculation (A. Okafor, March 2026: 22 days, 176 h, 88 h, €7,880.00,
  blended €89.5455/h) is a test: `apps/delivery/src/domain/pricing.test.ts`.

People's rules (`apps/people/src/domain`):

- **Rate history.** Records can be added, corrected and removed at any date, backdated ones
  included. An employee has at most one record per `validFrom`, and a rate is positive, at most €10,000
  an hour, with at most two decimals: 1.005 is refused, not rounded to a rate nobody entered. The
  contract applies the same rule, and a test keeps the two in step.
- **Effective periods** run from a record's `validFrom` to the day before the next one (inclusive);
  the last has no end.
- **The only record is not removed** by `removeRate`: the employee would have no rate at all, and
  their days would cost nothing and be reported as unpriced. `clearRates` does that on purpose.
  Removing the first of several does the same to the days before the next record.
- **Search** matches every word of the query against name and role together, ignoring case and
  accents (and folding letters like ł and ø); a blank query matches everyone. Results keep register
  order.

## Repository

| Path                      | What it is                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| `apps/shell`              | Host: navigation, display currency, active user, remote loading.        |
| `apps/people`             | Remote: the employee register (team People).                            |
| `apps/delivery`           | Remote: work breakdown and staffing grid (team Delivery).               |
| `contracts/host`          | Host contract v1 — what the shell pushes into every remote.             |
| `contracts/people`        | People contract v1 — employees, rates, rate semantics and test vectors. |
| `contracts/delivery`      | Delivery contract v1 — workload per employee-month.                     |
| `seed/baseline-seed.json` | Fixtures shipped with the exercise. Ids and values are kept verbatim.   |
| `tsconfig.base.json`      | Strict compiler settings every package extends.                         |
| `eslint.config.js`        | Type-aware lint rules (`no-explicit-any`, hooks, team-boundary checks). |
| `docker-compose.yml`      | The three containers; each app's `Dockerfile` sits in its folder.       |
| `CLAUDE.md`, `.claude/`   | Project rules and guardrails for AI-assisted work with Claude Code.     |

## Development

Requires Node 24 and pnpm (version pinned in `package.json` → `packageManager`).

```bash
pnpm install
pnpm dev        # shell http://localhost:3000 · people :3001 · delivery :3002
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Each remote also runs on its own: open http://localhost:3001 or http://localhost:3002.

The servers run separately from the front ends. `pnpm --filter @baseline/people dev:server` and
`pnpm --filter @baseline/delivery dev:server` start them on :3011 and :3012, importing the seed into
`data/` the first time; delete that folder to start over. `pnpm build` also bundles each server
into `dist-server/main.js`.

## Services

People and Delivery each run a small Hono server next to their bundle. It serves the API below and,
in a container, the built bundle as well. Both answer errors as `{ "error": { "code", "message" } }`:
400 for a request that is not well formed (including a field the service does not know, which is
never silently ignored), 404 for something that does not exist, 409 for a rule that refuses the
change, 413 and 415 for a body that is too large (64 KB) or not JSON, 422 for a value that is not
acceptable. Only `application/json` is accepted for writes, so a page on another origin cannot write
with a plain form post.

- **People**, under `/api/people/v1`: `GET /employees`, `GET /rates`, `POST /employees/:id/rates`,
  `PATCH /rates/:id`, `DELETE /rates/:id`, `DELETE /employees/:id/rates` (clears them all, on
  purpose) and `GET /events`. Reads follow the people contract; writes go through the domain rules
  above.
- **Delivery**, under `/api/delivery/v1`: `GET /plan`, `GET /workload`, `POST /items`,
  `PATCH /items/:id` (rename, move, or both in one change), `GET /items/:id/deletion-summary`,
  `POST /items/:id/deletion` (takes the summary back as the confirmation; a POST because a DELETE
  has no defined body), `PUT /allocations` (zero removes) and `GET /events`. Every command runs
  through the same domain code as the browser. The confirmation lists the allocations with their
  amounts: if an id or an amount differs from what is stored now, nothing is deleted. An allocation
  is at most 100 person-months. Delivery does not check an employee id against People.
- **Storage.** One JSON document per service, written to a temporary file, flushed and renamed over
  the old one. The first start imports the service's own part of the seed; after that the stored
  document is the truth. A change is stored before it is visible or announced, and changes run one
  after another. A data file that cannot be read, or breaks a domain rule, stops the service at start-up with its path
  in the message; it is never replaced by the seed. On `SIGTERM` the service drops open event
  streams and finishes pending writes before it exits.
- **Revisions.** Each service counts its changes; reads and successful commands carry the revision
  they reflect. An event says who changed and at which revision, and is sent only after the change
  is stored. Delivery's stream announces workload changes only, when a published figure differs:
  adding or moving an item, or adding a child to a leaf (which moves its allocations without
  changing anyone's workload), is silent. Other tabs pick up tree edits when they next read `/plan`.
- **Seed.** Delivery shows the six over-allocated person-months of the case study, e.g. M. Brandt in
  June 2026 at 1.18, blamed on `alloc-073`; a test recomputes them from the raw seed. People refuses
  to start on a seed that breaks its rate rules; a test checks the shipped one does not.

## Running with Docker

```bash
docker compose up --build
```

Open http://localhost:8080. Three containers, one per deployable unit; only the shell's is published.

- **shell** is nginx: it serves the shell and forwards `/mf/people/` and `/mf/delivery/` to the
  remotes, so the browser sees one origin and no CORS is needed. Its `/config.json` is generated
  when the container starts, from `PEOPLE_REMOTE_ENTRY` and `DELIVERY_REMOTE_ENTRY`.
- **people** and **delivery** are Node containers running their server: the API, the federated
  remote at `/mf-manifest.json` and the standalone page at `/`, reachable as
  http://localhost:8080/mf/people/ and http://localhost:8080/mf/delivery/. The server is bundled
  with its dependencies, so the image holds no `node_modules`.
- The gateway also forwards `/api/people/v1/` and `/api/delivery/v1/`, with buffering off so event
  streams arrive as they are sent.
- Each service keeps its data in a named volume: it survives a restart, and
  `docker compose down -v` resets it to the seed.
- Each image builds from the repository root, e.g. `docker build -f apps/people/Dockerfile .`, and
  downloads packages in a layer that depends only on `pnpm-lock.yaml`.
- The gateway looks its upstreams up on every request, so it starts and stays up while a remote is
  down; only that remote's paths answer 502.

## Breaking a remote on purpose

- In the shell header open **Diagnostics → Break People** (or Delivery). This adds
  `?break=people` to the URL; the shell then points that remote at an entry that does not exist,
  exactly like a missing deployment. The panel explains what failed, the other panel keeps working.
  **Restore all remotes** removes the parameter.
- With Docker, `docker compose stop people` is a real outage: the panel shows what failed after
  about two seconds, and `docker compose start people` followed by **Retry** brings it back.
- Or stop a remote's dev server: its panel times out with a message; start the server again and
  press **Retry** — the remote loads without reloading the page.
