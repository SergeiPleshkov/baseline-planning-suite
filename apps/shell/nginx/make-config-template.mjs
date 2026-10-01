// Turns the development config.json into the deployed template: same currencies and users, but the
// remote entries become placeholders that the container fills in from its environment at start-up.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('usage: make-config-template.mjs <config.json> <template>');

const config = JSON.parse(readFileSync(source, 'utf8'));
config.remotes = {
  people: '${PEOPLE_REMOTE_ENTRY}',
  delivery: '${DELIVERY_REMOTE_ENTRY}',
};
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
