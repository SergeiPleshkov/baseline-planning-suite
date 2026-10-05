# Baseline Planning Suite

Baseline answers one question for a delivery organisation: who is working on what, for how long,
and what it costs. It is built as three independently deployable micro-frontends — **shell**,
**people** and **delivery** — owned by two teams that never import each other's source.

Start with **Run it** and **Breaking a remote on purpose**, then the map of the repository and
**Decisions**; the rest describes how each part behaves.

## Run it

```bash
docker compose up --build
```

From a clean clone, with only Docker installed, open http://localhost:8080. Nothing is built on the
host: every image installs and builds inside Docker. Three containers, one per deployable unit; only
the shell's is published.

```
browser ─► :8080  shell (nginx: the shell bundle, the gateway, /config.json made from env)
                   ├─ /mf/people/        ─► people    (remote bundle, standalone page)
                   ├─ /api/people/v1/    ─► people    (API, JSON store on a volume, events)
                   ├─ /mf/delivery/      ─► delivery  (remote bundle, standalone page)
                   └─ /api/delivery/v1/  ─► delivery  (API, JSON store on a volume, events)
```

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
- The gateway looks its upstreams up again every few seconds instead of once at start-up, so it
  starts and stays up while a remote is down; only that remote's paths answer 502, and a service
  that was just started can still answer 502 for a moment.

## Breaking a remote on purpose

- In the shell header open **Diagnostics → Break People** (or Delivery). This adds
  `?break=people` to the URL; the shell then points that remote at an entry that does not exist,
  exactly like a missing deployment. The panel explains what failed, the other panel keeps working.
  **Restore all remotes** removes the parameter.
- With Docker, `docker compose stop people` is a real outage: the panel shows what failed after
  about two seconds, and `docker compose start people` followed by **Retry** brings it back.
- Or point a remote at an entry that is not a manifest, without rebuilding anything (the gateway
  answers that path with the shell page, so the load fails on parsing):
  `PEOPLE_REMOTE_ENTRY=/mf/nowhere/mf-manifest.json docker compose up -d shell` (and
  `DELIVERY_REMOTE_ENTRY` likewise) rewrites `/config.json` when the shell container starts. Run
  `docker compose up -d shell` without the variable to put it back. (Git Bash on Windows rewrites a
  value that starts with `/`; prefix the command with `MSYS_NO_PATHCONV=1`.)
- Or stop a remote's dev server: its panel fails at once with a connection error (a remote that
  hangs instead is given up on after ten seconds); start the server again and press **Retry** — the
  remote loads without reloading the page.

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
- **One React.** `react` and `react-dom` are shared as singletons: hosted, the remotes render with
  the shell's React and React DOM. With `strictVersion`, a remote whose React range the shell's
  version does not satisfy fails to load, and its panel says why, instead of running on a React it
  was not built for.
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
| `contracts/people`        | People contract v1 — employees, rates, rate semantics and test vectors. |
| `contracts/delivery`      | Delivery contract v1 — workload per employee-month.                     |
| `seed/baseline-seed.json` | Fixtures shipped with the exercise. Ids and values are kept verbatim.   |
| `tsconfig.base.json`      | Strict compiler settings every package extends.                         |
| `eslint.config.js`        | Type-aware lint rules (`no-explicit-any`, hooks, team-boundary checks). |
| `docker-compose.yml`      | The three containers; each app's `Dockerfile` sits in its folder.       |
| `e2e`                     | Browser tests (Playwright) of the running Docker stack.                 |
| `scripts/smoke.mjs`       | Checks a running stack from outside: config, manifests, APIs, streams.  |
| `.github/workflows`       | CI: checks, then the compose stack with smoke and browser tests.        |
| `knip.json`               | Settings for `pnpm knip`: unused files, exports and dependencies.       |
| `CLAUDE.md`, `.claude/`   | Project rules and guardrails for AI-assisted work with Claude Code.     |

The three apps share one layout under `src/`. The shell has no rules of its own and no server, so it
has only `infrastructure/` (runtime config, loading the remotes) and `ui/`.

```
domain/           plain TypeScript, the rules: its own tsconfig, no DOM, no I/O, no contracts
application/      stores, view models and ports; checks what a schema cannot, and maps contract
                  data to and from the domain; no React, I/O only through the ports
infrastructure/   the I/O behind the ports: gateways that check each answer against its schema,
                  change feeds, runtime config
ui/               React components and their CSS Modules
server/           Hono API, JSON store, event bus (bundled to dist-server/main.js)
*App.tsx          the app's root component: ShellApp, and the PeopleApp and DeliveryApp that
                  the remotes expose as ./App; index.tsx and bootstrap.tsx start it
```

Lint keeps the imports pointing inwards. Outside its tests, the domain depends on no package and on
no other part of its app. Application code imports only application and domain code, never React,
and reaches the network and browser storage only through its ports. The server imports neither the
browser's adapters nor the UI, and no front-end code imports the server.

## Decisions

The choices the case study leaves open, with what each one costs. The first is the one it asks to
be defended.

### Who computes cost: Delivery, from the rates People publishes

Delivery reads the rate records and prices the grid itself, with pure functions
(`priceMonth` and `costOf` in `apps/delivery/src/domain/pricing.ts`), instead of asking People for a
computed cost.

1. **Splitting a month is a rule of the plan, not of the rates.** R1 spreads an allocation evenly
   over the working days of its month. If People returned the cost it would have to know Delivery's
   calendar and that spreading rule, and the coupling would run the wrong way.
2. **Speed.** Switching the unit, or reading new rates, reprices every cell of the grid, hundreds of
   them, and a cost typed into a cell is converted back through that month's blended rate. Doing
   that in the browser is immediate; a request to People per cell would not be, and would make the
   unit switch depend on People being up.
3. **Failure.** If People goes down while Delivery is open, Delivery keeps pricing with the rates it
   last read and says the figures may be out of date, with a Refresh button. If the page is loaded
   while People is down there are no rates to read: hours and cost say why they are not shown, and
   person-months and percent keep working.
4. **Testability.** R1 to R3 are arithmetic in a few modules that run without a browser or a
   network, and the reference calculation is a golden test (`pricing.test.ts`).

**What it costs.** Delivery has to read the rates exactly as People means them: `validFrom` is
inclusive, there is no end date, and before the first record there is no rate. Two things hold that
together. The meaning is part of the People contract (v1) together with `rateSemanticsVectors`,
which both teams run against their own code, and a change of meaning is a new contract version.
And Delivery reads People's payloads in one place and refuses a history that contradicts itself.

**When I would choose the opposite.** If hourly rates were confidential to Delivery, People would
publish only totals, and the month-splitting rule would have to be agreed across the boundary
instead of owned by one side.

### The data layer: a small service per team

People and Delivery each run a Hono service next to their bundle. It is the only writer of that
team's data, imports its own part of the seed on first start, and answers over REST with schemas
from the team's contract. The browser never reads another team's store. The consumer validates what
it receives at the edge and maps it into its own model; TypeScript types alone do not protect two
apps that deploy on their own schedules.

### Transport: REST for state, server-sent events for "something changed"

An event carries no data worth trusting, only who changed and at which revision. A consumer reads
the event by name, ignores the rest of the payload and fetches the data again over REST, so there is
one source of truth and no bug from events arriving out of order. Every (re)connection is followed
by a full read, because what happened in between is unknown. This works the same in the shell, in a
standalone remote and in another tab, because the change goes through the service and not through
the page.

Rejected: a bus in the shell (it does not exist in standalone, and the shell would start to know
other teams' data) and `BroadcastChannel` (one browser only, and it needs a live publisher on the
page). The price is a read per change and one open connection per stream; the connection budget is
the **Limits** note in the People screen section.

### State ownership

| Data                                         | Owner    | How others get it                                           |
| -------------------------------------------- | -------- | ----------------------------------------------------------- |
| Employee, rate records                       | People   | REST and `rates-changed` (`@baseline/people-contract`)      |
| Project, work breakdown item, allocation     | Delivery | not published                                               |
| Workload per employee and month, over/within | Delivery | REST and `workload-changed` (`@baseline/delivery-contract`) |
| Display currency, active user                | Shell    | props to each remote (`@baseline/host-contract`)            |

### Persistence: one JSON document per service, on a named volume

A change is written to a temporary file, flushed and renamed over the old document, one change at a
time, and only then becomes visible and announced. The data survives a page reload and a container
restart; `docker compose down -v` resets it to the seed. The service reaches the file through a small
`JsonFileStore`, so a database could replace it without touching the domain.

Rejected: browser storage. A standalone Delivery would have no rates whenever People is not open,
and transport between the remotes would shrink to `BroadcastChannel`. The price of a file is one
writer per service, so no second instance of either, and the whole document is rewritten on every
change, which is cheap at 720 allocations.

### The bundler: Rsbuild 2 with Module Federation 2

It is the path the Module Federation team ships: the runtime API (`registerRemotes`, `loadRemote`),
`mf-manifest.json`, and fast builds inside Docker. Webpack 5 shares the core but is slower, and
Vite-based federation is weaker for singletons. Only `react` and `react-dom` are shared, as
singletons with `strictVersion`: one React on the page, and a remote whose React range the shell's
version does not satisfy fails to load instead of running on a React it was not built for. The cost
is an order of deployment: the shell upgrades React before any remote raises its minimum. Contracts
and zod are bundled into every app: they hold no state and are small. `dts` is off, because types
come from the contracts and not from another app's build.

### Smaller decisions

- **One stored unit: person-months,** as a double, never quantised. Hours, % and cost are conversions
  at the edges, so switching units writes nothing, and a rate change moves cost but not effort.
- **Rounding is a flow problem.** Totals along rows, down the tree and overall must all equal the sum
  of what is shown. Largest remainder solves one row; for a tree by months the constraints nest, so
  a minimum-cost flow over 0/1 edges finds shown figures that are each the exact value rounded up
  or down. Totals and group figures get priority over cells (equal weights were refuted by an example:
  3.006 shown as 3.00). Exact values are held as integers in ten-thousandths of a display step, so
  1.005 is recognised as a half.
- **R4: the leaf's allocations move onto the new child,** and the user is told how many. Moving an
  item under a leaf that holds allocations is refused, since the leaf's allocations would have no
  place to go. Silent loss never happens.
- **The grid opens on the project's own months,** not on the seed's `gridHorizon` (Apr 26 – Mar 27):
  the reference cell is in March 2026, which that horizon leaves out. A preset restores it.
- **Edit order stands in for time.** The seed has no timestamps, so the order of the file decides
  which allocation is "most recently edited"; every change made afterwards takes a revision above
  all others.
- **Over capacity is flagged, never blocked.** A month is over capacity above 1 person-month plus
  1e-9, a tolerance against floating-point noise and not a rounding budget.
- **No UI library.** The tree, the grid (an ARIA treegrid with one tab stop) and the dialogs
  (native `<dialog>`) are written here; styles are CSS Modules.

## Where each rule lives

The case study numbers its rules R1 to R5. Paths are under `apps/delivery/src` unless noted.

| Rule                                            | Code                                                                                                                                                                                                                                                                | Tests                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Effective-dated rates, months split          | `domain/calendar.ts` (working days), `domain/rateTimeline.ts` (rate on a date), `domain/pricing.ts` (slices, cost, blended rate); People's own record rules in `apps/people/src/domain/rates.ts`                                                                    | `pricing.test.ts` (reference calculation), `calendar.test.ts`, `rateTimeline.test.ts`; the contract's vectors run in `application/peopleContract.test.ts` and in People's `contract.test.ts` |
| R2 Four units, one stored value                 | `domain/units.ts` (conversions), `application/figures.ts` (display precision), `application/cellEntry.ts` (typed text to person-months)                                                                                                                             | `units.test.ts`, `figures.test.ts`, `cellEntry.test.ts`                                                                                                                                      |
| R3 Totals add up                                | `domain/rounding/roundForDisplay.ts` and `cheapestCirculation.ts`, applied to the whole grid in `application/gridView.ts`                                                                                                                                           | `roundForDisplay.test.ts` and `cheapestCirculation.test.ts` (properties), `gridView.test.ts`                                                                                                 |
| R4 Parents are derived; a leaf's allocations    | `domain/breakdown.ts` (add, move, delete), derived rows in `application/gridView.ts`, wording in `application/messages.ts`                                                                                                                                          | `breakdown.test.ts`, `deliveryStore.test.ts`                                                                                                                                                 |
| R5 Capacity across projects, the cause is named | `domain/capacity.ts` (workload and cause), published at `GET /api/delivery/v1/workload`; People's badge in `apps/people/src/application/peopleStore.ts`; the list of over-capacity months in `application/overload.ts`, the cell marks in `application/gridView.ts` | `capacity.test.ts`, `overload.test.ts`, `server/deliveryApi.test.ts`; People's `peopleStore.test.ts`                                                                                         |

The reference calculation (Adaeze Okafor, March 2026: 88.00 h, €7,880.00, 50.0 %, €89.5455/h) is
checked three times: as a domain test, through the figures of the calculation panel, and in a
browser (`e2e`).

## Development

Requires Node 24 and pnpm; pnpm switches to the version pinned in `package.json` →
`packageManager`. Install it with `npm install -g --allow-scripts=pnpm pnpm`: recent npm skips a
package's install scripts unless they are allowed, and without its script pnpm has no working
command on Windows (elsewhere it runs through Node). The Dockerfiles install it the same way.

```bash
pnpm install
pnpm dev        # shell http://localhost:3000 · people :3001 · delivery :3002
pnpm test
pnpm typecheck
pnpm lint
pnpm knip       # unused files, exports and dependencies
pnpm build
```

`pnpm test` runs the unit and property tests only; the running system is checked separately, see
[Checks and CI](#checks-and-ci).

Each remote also runs on its own: open http://localhost:3001 or http://localhost:3002.

The bundles target Chrome and Edge 117, Firefox 119 and Safari 17.4 or later (`browserslist` in
each app's `package.json`), the first versions with `Map.groupBy`; no polyfills are added.

The servers run separately from the front ends. `pnpm --filter @baseline/people dev:server` and
`pnpm --filter @baseline/delivery dev:server` start them on :3011 and :3012, importing the seed into
`data/` the first time; delete that folder to start over. `pnpm build` also bundles each server
into `dist-server/main.js`.

## Checks and CI

Against a running stack (`docker compose up --build --detach --wait`), both reach it through the
gateway on http://localhost:8080 only:

```bash
pnpm smoke      # node scripts/smoke.mjs [base-url] [--down=people,delivery]
pnpm e2e        # Playwright, in e2e/
```

- **Smoke** checks that the shell and `/config.json` are served with same-origin remote entries,
  that each manifest names its remote and its entry script loads, that People serves every employee
  of the seed and Delivery every project, and that both event streams deliver their first bytes at
  once, which fails if something in front of them buffers, and that a page on another origin is
  not allowed to write to either API. `--down=people` is for a stack where that service was
  stopped on purpose: its paths must answer with a gateway error while everything else stays
  healthy.
- **Browser tests** read the reference cell (Adaeze Okafor, March 2026) in all four units and in
  USD and open its calculation; type the reference figure into it in every unit and with a unit
  written next to it (`7,880.00`, `€7,880`, `88 h`, `50%`), and a negative figure that must be
  refused; remove her first rate in People to see the days before the next one cost nothing and be
  marked; check that `?break=people` and `?break=delivery` take down one panel and leave the other
  working, and that a wide staffing grid does not squeeze People side by side; and correct her rate
  in People to see Delivery reprice without a reload, on the same page and in another tab. The
  browser runs in the Auckland time zone, because dates are UTC-only. The tests expect the seed
  data. They put her two rates and the reference cell back before and after each test, also when
  one failed halfway (a first rate added back gets a new id); any other edit made by hand stays,
  and `docker compose down -v` resets the stack. The first run needs a browser:
  `pnpm --filter @baseline/e2e exec playwright install chromium`, or set
  `E2E_BROWSER_CHANNEL=msedge` (or `chrome`) to use one that is installed. `E2E_BASE_URL` points
  the tests at another address.
- **CI** (`.github/workflows/ci.yml`) runs on every push to main and every pull request. The first
  job installs with the lockfile frozen and runs format check, typecheck, lint, knip, tests and
  build. The second builds the three images, starts them, runs smoke, the browser tests, and smoke
  again with People and then Delivery stopped.

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
- Delivery reads People's payloads in one place, `apps/delivery/src/application/peopleContract.ts`:
  its gateway hands them over unparsed, so that the schema and the rules no schema states are
  checked together. A rate history that parses but contradicts itself (two records on one day) is
  refused as a whole: there is no right answer to price the person's days with. So is a payload
  that uses an id twice.

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
- **Projects** keep the start and end dates of the seed. Allocations are per month, so every month
  the project runs on at least one day can be planned: one that starts on the 12th can be staffed
  for that whole month.
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
  after another. A data file that cannot be read, or breaks a domain rule, stops the service at
  start-up with its path in the message; it is never replaced by the seed. Data written in an older
  format is not converted: `docker compose down -v`, or deleting `data/` in development, starts
  again from the seed. On `SIGTERM` the service drops open event streams and finishes pending
  writes before it exits.
- **Revisions.** Each service counts its changes; reads and successful commands carry the revision
  they reflect. An event says who changed and at which revision, and is sent only after the change
  is stored. Delivery's stream announces workload changes only, when a published figure differs:
  adding or moving an item, or adding a child to a leaf (which moves its allocations without
  changing anyone's workload), is silent. Other tabs pick up tree edits when they next read `/plan`.
- **Seed.** Delivery shows the six over-allocated person-months of the case study, e.g. M. Brandt in
  June 2026 at 1.18, blamed on `alloc-073`; a test recomputes them from the raw seed. People refuses
  to start on a seed that breaks its rate rules; a test checks the shipped one does not.

## The People screen

The register lists the employees with their role, weekly hours, the hourly rate in force today (in
the shell's display currency) and a badge when Delivery shows them over capacity in some month.
Search matches name and role together, ignoring case and accents, and a role filter narrows it
further.

- **Rate history.** Choosing an employee opens their card: the rates with the period each one
  covers, and forms to add (also backdated), edit and remove them. Rates are typed in EUR, the
  currency they are stored in; a value typed in another currency would seldom be a whole cent. The
  display-currency equivalent is shown next to it. Removing a rate says what happens to the days
  around it first, and removing the only one is a separate "remove all rates" confirmation.
  Whatever the service refuses (a start date already taken, say) is shown in its own words.
- **Monthly load** comes from Delivery's workload contract: every month with allocations as a share
  of the person's capacity, over-capacity months marked with text as well as colour.
- **Without Delivery** the register and the rate editor keep working; the screen says the load
  figures are not available and offers to try again. The same happens while Delivery's event stream
  is broken, since the figures cannot then be trusted to follow it, and they come back by themselves
  once the stream reopens.
- **Where it gets its data.** The remote reads `config.json` next to its own files (the shell does
  not pass it) to find the People and Delivery APIs, so the addresses are not in the bundle. The
  paths in it are resolved against the address of the page, which works behind the gateway and the
  development proxies; the file ships in the remote's `dist` and is replaced to point elsewhere. In
  development the dev servers proxy `/api/people` and `/api/delivery` to the servers on :3011
  and :3012, like the gateway does.
- **Structure.** State lives in `PeopleStore` (no React, tested on its own); React only subscribes
  to it. The screen re-reads the rates after every change instead of patching its own copy.
- **Live updates.** The register follows People's `rates-changed` stream and the load follows
  Delivery's `workload-changed` stream (server-sent events), so a change made in another tab or by
  someone else shows without reloading. An event only says that something changed, and nothing it
  carries is read: the screen reads the data again, as it does after every (re)opening of a stream,
  since events in between may have been missed, and one more read follows a change announced
  during a read. Reads run one at a time. A stream that the server or the gateway refused (a 502
  while a service restarts) is opened again after a pause that doubles up to 15 seconds, because
  the browser does not retry those by itself.
- **When People or Delivery is not reachable.** If a read of the register fails, or its stream
  breaks, what was on screen stays, marked as possibly out of date; a read that failed is tried
  again after a pause that doubles up to 30 seconds. Whether the stream is broken and whether the
  last read failed are kept apart, so a good read does not hide a broken stream. Delivery's load
  is shown as unavailable ("load figures from Delivery are not available") while that stream is
  broken or a read of it fails, and comes back by itself. A change whose answer was lost is
  followed by a re-read, because it may have been saved. "Today" is the UTC date at the moment the
  screen opens.
- **Limits.** Each open page keeps its streams open: People holds two (its own and Delivery's),
  Delivery one. Browsers allow about six connections per address over HTTP/1.1, which is what the
  gateway speaks, so a handful of tabs can fill that budget. A connection that dies without
  closing (a laptop that slept) is not noticed until the browser reports it.

## The Delivery screen: work breakdown

Choose a project and its work breakdown is shown as a tree. It follows the ARIA tree pattern: one
tab stop, the arrow keys move between rows (Right opens an item or steps into it, Left closes it or
goes to its parent, Home and End jump), and the row that has the focus is the selected one.

- **Commands** act on the selected item through native `<dialog>` modals: add a child (or a
  top-level item), rename, move and delete.
- **Moving** offers only places the domain accepts, so a refused move cannot be picked: the level
  limit and the rule about leaves that hold allocations are applied before the list is shown.
- **Adding a child to a leaf with allocations** moves them onto the child and says so ("2 allocations
  were moved from … onto the new item …"). The button on the third level is disabled and the panel
  says why. Every leaf of the seed is on the third level, so to try it there, move a leaf that holds
  allocations up a level first: Design in Ledger Consolidation, moved under Ledger migration, hands
  its 18 allocations to the child added next.
- **Deleting** shows what goes: the items by name, the allocations and their total, read from the
  service. Confirming sends that summary back; if the subtree changed meanwhile nothing is deleted,
  the dialog says so and shows the new summary.
- **Optimistic changes.** Rename, move and delete show at once, are sent, and the plan is read
  again either way: that read is also the rollback when the service refuses. The domain code that
  checks the command is the same as on the server, so most refusals come back before anything is
  sent. Adding an item waits for the service, which gives the item its id. Commands run one at a
  time.
- **While something is saving**, Escape and a click outside a dialog do nothing, so that a refusal
  is always shown where it was asked for. The selected item is always visible: it is opened to
  when it is added or moved, and closing a parent that holds it selects the parent.
- **If the service cannot be read** the plan on screen stays, marked as possibly out of date, with a
  Retry. The plan does not follow changes made elsewhere yet.

## The Delivery screen: staffing grid

The Staffing view of the same project: the work breakdown as rows, with the people allocated to
each leaf below it, one column per month and a total column and row. It is an ARIA treegrid: one
tab stop, the arrow keys move between cells (Home and End go to the ends of a row, with Ctrl to the
corners; combinations with Alt, Shift or Cmd are left to the browser), and Enter or Space on an
item's name opens or closes it.

- **Rows.** A breakdown row's figures are sums of what is below it and are marked DERIVED. A person
  gets a row under a leaf once they have an allocation on it, or are assigned to it, listed by
  name and then id. Months outside the project's dates are shaded and empty. The grid scrolls in
  its own box, so the months and the totals stay in view on a long breakdown.
- **Editing.** A person's cell inside the project is edited in place. Enter or F2 opens it on its
  text, typing starts a new figure, Delete clears it; Enter saves and moves down, Tab saves and
  moves along (Shift+Tab back), Escape drops the text. Zero or blank removes the allocation.
- **What can be typed.** A figure is read in the unit shown and converted to person-months for
  that person and month. The grouping the cells use is read back (`1,250` is 1250, `0,5` is 0.5,
  and a group never starts with a zero, so `0,333` is a third), as are spaces between thousands
  and `7.880,00`; `7.880` alone is seven point eight eight, and is refused as money, where it could
  also mean 7880. A unit written before or after the number wins over the one shown: `88 h`, `50%`, `0.5 pm`, `€7,880`, `7880 EUR`. Money is in the
  display currency, or in EUR when written so. A negative figure, more than 100 person-months, and
  money in a month without a rate are refused with the reason. Text that cannot be saved when the
  focus moves to another cell is dropped, and a message above the grid names the cell and says
  why; moving to another window keeps the text being typed. A cell is saved only if the figure
  differs from what it showed, so pressing Enter on `0.33`, which displays an exact third, or
  typing `€7,880` over `7,880.00`, leaves the stored value and the order of edits alone. The
  change shows at once and is read back from the service; a refusal is shown above the grid.
- **Assigning.** "Assign person…" gives a person a row on a leaf before they have any allocation
  there. The row exists in this view only and is not saved: it stays after its figures are
  cleared, and is gone when the project is changed or the page is reloaded.
- **Over capacity.** A person's load in a month is summed over every project, the ones not on
  screen included. In an over-capacity month the allocation edited last carries a † and a red
  tint, with a tooltip saying whose load it is and why it is blamed; the other contributions are
  tinted lighter. Hovering a cell of the month says the load, where the other contributions are and
  which one is blamed. The seed has no timestamps and no authors, so "edited last" is the order of
  the edits (the file order for the seed) and the screen cannot say who made one or when. "Over
  capacity" above the grid lists every such person-month that involves the project, by name and
  month, with what it is made of and a Show button that opens the right row at the right month.
- **Without a rate.** In cost, a cell whose month has working days with no rate for that person
  carries a ◇ saying how many; those days count as zero in the cost, as the blended rate does.
- **Calculation.** The panel under the grid shows the person's cell that last had the focus,
  and lays it out like figure 4 of the case study: the working days and the hours in a
  person-month, the month split by rate with hours and cost per slice, the blended rate, and the person's load in
  that month by project and work item, with its edit order. Its figures are rounded together too,
  so slices add up to the totals shown. For the reference cell it reads 8 days at €80.00 =
  32.00 h, €2,560.00; 14 days at €95.00 = 56.00 h, €5,320.00; 88.00 h and €7,880.00 in all.
- **Months.** The grid opens on the project's own span (Mar 26 – Feb 27 for Ledger Consolidation,
  so the reference cell is on screen). ‹ and › move it by a month; "Project span" and
  "Apr 26 – Mar 27" are presets. The totals cover the months shown.
- **Four units.** Person-months (2 decimals), hours (2), % of capacity (1) and cost in the display
  currency (2). The reference cell reads 0.50 · 88.00 · 50.0 · 7,880.00. Switching only changes
  what is shown.
- **Rounding.** Every figure in one unit is rounded together by `roundForDisplay`, so each total is
  the sum of the figures it covers, in the rows, the columns and the grand total. Collapsing rows
  changes no figure.
- **People's data.** Hours need each person's contracted hours and cost also needs their rate
  history, both read from People's API at the address in `peopleApi` of the remote's `config.json`.
  If People cannot be read, person-months and percent still show, with people named by id; the
  screen says what is missing and offers Retry, and hours and cost say why they are not shown.
  The data is read when the Delivery remote starts and again whenever People announces that rates
  changed, in the same tab or another, without the grid going blank or losing the focus. If a read
  fails or People's stream breaks, the data on screen stays and a banner says it may be out of date,
  with a Refresh button; a failed read is tried again after a pause that doubles up to 30 seconds,
  the stream reopens by itself, and the banner goes once People has been read again and its
  stream is up. Nothing is hidden meanwhile.
- **State.** The unit, the months and the open rows stay while the Breakdown view is shown, and
  reset when another project is chosen.

## What I would do next

- **Record who edited an allocation, and when.** Edit order now stands in for time because the seed
  has neither; with real authors and timestamps the cause of an over-capacity month could be shown
  as "edited by … on …".
- **Fewer connections per page.** One multiplexed stream per page, or HTTP/2 at the gateway, would
  lift the six-connection budget that a handful of tabs can fill.
- **A database behind `JsonFileStore`** if a service ever needs a second instance; today each has
  exactly one writer.
- **Check employee ids against People, and price the rest.** Delivery's API stores whichever id it
  is given. The screen only offers people from the register, but an unknown id sent to the API makes
  hours and cost unavailable for the whole project, with a message naming the id, instead of for
  that person alone.
- **Holidays.** Working days are Monday to Friday by specification; the calendar is the one place to
  add a set of holiday dates.
- **Cache image layers in CI,** so the compose job does not build three images from scratch.
