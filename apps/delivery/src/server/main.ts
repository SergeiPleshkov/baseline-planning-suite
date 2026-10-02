import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { WorkloadChangedEvent } from '@baseline/delivery-contract';
import { Hono } from 'hono';
import { createDeliveryService } from '../application/deliveryService';
import { documentFromState, stateFromDocument } from '../application/planDocument';
import { createDeliveryApi } from './deliveryApi';
import { createEventBus } from './eventBus';
import { jsonFileStore } from './jsonFileStore';
import { startFromStore } from './startup';
import { deliveryDocumentFromSeed } from './seed';

const API_BASE = '/api/delivery/v1';

const port = Number(process.env.PORT ?? 3012);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const staticDir = relative(process.cwd(), resolve(process.env.STATIC_DIR ?? './dist'));
const seedFile = resolve(process.env.SEED_FILE ?? '../../seed/baseline-seed.json');

const dataFile = join(dataDir, 'delivery.json');
const store = jsonFileStore(dataFile);

const initial = await startFromStore({
  store,
  file: dataFile,
  seed: async () =>
    deliveryDocumentFromSeed(JSON.parse(await readFile(seedFile, 'utf8')) as unknown),
  parse: stateFromDocument,
  toDocument: documentFromState,
  onImport: () => {
    console.log(`delivery: imported the seed from ${seedFile}`);
  },
});

const events = createEventBus<WorkloadChangedEvent>();
const service = createDeliveryService({
  initial,
  write: (document) => store.write(document),
  newItemId: () => `item-${randomUUID()}`,
  newAllocationId: () => `alloc-${randomUUID()}`,
  notify: events.publish,
});

const app = new Hono();
app.route(API_BASE, createDeliveryApi({ service, subscribe: events.subscribe }));

// The bundle is public: any origin may read the manifest and the chunks.
app.use('*', async (context, next) => {
  await next();
  context.header('Access-Control-Allow-Origin', '*');
  const path = new URL(context.req.url).pathname;
  if (path === '/' || path === '/index.html' || path === '/mf-manifest.json') {
    context.header('Cache-Control', 'no-cache');
  }
});
app.use('*', serveStatic({ root: staticDir }));

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`delivery: listening on :${String(port)}, data in ${dataDir}`);
});

// Open event streams never end on their own, so they are cut, and pending writes finish first.
const stop = () => {
  server.close();
  if ('closeAllConnections' in server) server.closeAllConnections();
  void store.idle().then(() => {
    process.exit(0);
  });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
