// Checks a running stack from the outside, the way a browser reaches it: through the gateway only.
//   node scripts/smoke.mjs [base-url] [--down=people,delivery]
// `--down` names the remotes that were stopped on purpose: their paths must answer with a gateway
// error while the shell and the other remote stay healthy.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const REMOTES = ['people', 'delivery'];
const API = { people: '/api/people/v1', delivery: '/api/delivery/v1' };
const GATEWAY_ERRORS = [502, 503, 504];
const READY_WITHIN_MS = 90_000;
const REQUEST_TIMEOUT_MS = 10_000;
// A service that was just started may still be booting, and the gateway caches addresses for a few seconds.
const SETTLE_WITHIN_MS = 30_000;

const args = process.argv.slice(2);
const base = (args.find((arg) => !arg.startsWith('--')) ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const down = new Set(
  (args.find((arg) => arg.startsWith('--down='))?.slice('--down='.length) ?? '')
    .split(',')
    .filter((name) => name !== ''),
);
for (const name of down) {
  if (!REMOTES.includes(name)) throw new Error(`--down: unknown remote "${name}"`);
}

const seed = JSON.parse(
  readFileSync(new URL('../seed/baseline-seed.json', import.meta.url), 'utf8'),
);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchWithin(path, init = {}) {
  return fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function getJson(path) {
  const response = await fetchWithin(path);
  expect(response.status === 200, `${path} answered ${String(response.status)}, expected 200`);
  return response.json();
}

async function expectGatewayError(path) {
  const response = await fetchWithin(path);
  expect(
    GATEWAY_ERRORS.includes(response.status),
    `${path} answered ${String(response.status)}, expected a gateway error while its service is stopped`,
  );
}

/** Waits for the gateway itself, not for the remotes: a stopped remote must not hold it up. */
async function waitForGateway() {
  const deadline = Date.now() + READY_WITHIN_MS;
  for (;;) {
    try {
      if ((await fetchWithin('/config.json')).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${base} did not come up in time`);
    await sleep(1_000);
  }
}

/** Tries again for a while: what fails once may only be late. The last failure is the one reported. */
async function settle(run) {
  const deadline = Date.now() + SETTLE_WITHIN_MS;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(1_000);
    }
  }
}

/** The first bytes of the stream arrive at once only if nothing in front of it buffers. */
async function expectOpenStream(path) {
  const response = await fetchWithin(path);
  expect(response.status === 200, `${path} answered ${String(response.status)}, expected 200`);
  const type = response.headers.get('content-type') ?? '';
  expect(type.startsWith('text/event-stream'), `${path} is ${type}, expected an event stream`);
  const reader = response.body?.getReader();
  expect(reader !== undefined, `${path} has no body`);
  const giveUp = new AbortController();
  const first = await Promise.race([
    reader.read(),
    sleep(3_000, 'late', { signal: giveUp.signal }),
  ]);
  giveUp.abort();
  await reader.cancel();
  expect(first !== 'late', `${path} sent nothing within 3 s: something buffers the stream`);
}

const sameNames = (served, expected) =>
  served.length === expected.length &&
  expected.every((each) => served.some((one) => one.id === each.id && one.name === each.name));

const differsFromSeed = (what, served, expected) =>
  `the ${what} differ from the seed (${String(served.length)} against ${String(expected.length)}); a stack holding other data is reset by \`docker compose down -v\``;

const checks = [];
const check = (name, run) => checks.push({ name, run });

check('the shell page is served', async () => {
  const response = await fetchWithin('/');
  expect(response.status === 200, `/ answered ${String(response.status)}`);
  expect((await response.text()).includes('<div id="root">'), '/ does not look like the shell');
});

check('config.json holds same-origin remote entries, currencies and users', async () => {
  const config = await getJson('/config.json');
  for (const name of REMOTES) {
    const entry = config.remotes?.[name];
    expect(
      typeof entry === 'string' && entry.startsWith('/'),
      `remotes.${name} is ${JSON.stringify(entry)}, expected a path on this origin`,
    );
  }
  expect(
    config.currencies?.some((currency) => currency.code === 'EUR' && currency.ratePerEur === 1),
    'EUR at 1 is missing from currencies',
  );
  expect(Array.isArray(config.users) && config.users.length > 0, 'users is empty');
});

for (const name of REMOTES) {
  const entry = `/mf/${name}/mf-manifest.json`;
  if (down.has(name)) {
    check(`the ${name} manifest answers with a gateway error`, () => expectGatewayError(entry));
    check(`the ${name} API answers with a gateway error`, () =>
      expectGatewayError(`${API[name]}/${name === 'people' ? 'employees' : 'plan'}`),
    );
    continue;
  }
  check(`the ${name} manifest names its remote and its entry script loads`, async () => {
    const manifest = await getJson(entry);
    expect(manifest.name === name, `manifest.name is ${String(manifest.name)}`);
    const { path = '', name: file } = manifest.metaData?.remoteEntry ?? {};
    expect(typeof file === 'string' && file !== '', 'the manifest has no remote entry');
    const script = `${path}${file}`;
    const response = await fetchWithin(`/mf/${name}/${script}`);
    expect(response.status === 200, `${script} answered ${String(response.status)}`);
    expect(
      (response.headers.get('content-type') ?? '').includes('javascript'),
      `${script} is not served as JavaScript`,
    );
  });
}

if (!down.has('people')) {
  check('People serves every employee of the seed', async () => {
    const { employees } = await getJson(`${API.people}/employees`);
    expect(
      sameNames(employees, seed.employees),
      differsFromSeed('employees', employees, seed.employees),
    );
  });
  check('People serves its rates with a revision', async () => {
    const { revision, rates } = await getJson(`${API.people}/rates`);
    expect(Number.isInteger(revision) && revision >= 1, `revision is ${String(revision)}`);
    expect(rates.length > 0, 'no rates');
  });
  check('People streams change events through the gateway', () =>
    expectOpenStream(`${API.people}/events`),
  );
}

if (!down.has('delivery')) {
  check('Delivery serves every project of the seed', async () => {
    const plan = await getJson(`${API.delivery}/plan`);
    expect(
      sameNames(plan.projects, seed.projects),
      differsFromSeed('projects', plan.projects, seed.projects),
    );
  });
  check('Delivery serves workload per employee and month', async () => {
    const { entries } = await getJson(`${API.delivery}/workload`);
    expect(entries.length > 0, 'no workload entries');
  });
  check('Delivery streams change events through the gateway', () =>
    expectOpenStream(`${API.delivery}/events`),
  );
}

await waitForGateway();
let failed = 0;
for (const { name, run } of checks) {
  try {
    await settle(run);
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${String(checks.length - failed)} of ${String(checks.length)} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
