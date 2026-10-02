import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(
  await readFile(new URL('../recovery/floot-target-manifest.json', import.meta.url), 'utf8')
);

const EXPECTED_ORIGIN = 'https://pa-entity-x402.floot.app';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';

const expected = [
  ['/_api/pa-entity-one', '$0.001', '1000'],
  ['/_api/pa-business', '$0.005', '5000'],
  ['/_api/vendor-intake-gate', '$0.020', '20000'],
  ['/_api/sec-filings', '$0.005', '5000'],
  ['/_api/us-address-geocode', '$0.005', '5000'],
  ['/_api/ofac-sdn-screen', '$0.005', '5000'],
  ['/_api/domain-rdap', '$0.005', '5000'],
  ['/_api/treasury-average-rates', '$0.005', '5000'],
];

assert.equal(manifest.x402Version, 2);
assert.equal(manifest.resources.length, 8);

const resources = new Map(
  manifest.resources.map((resource) => [new URL(resource.resource).pathname, resource])
);
assert.equal(resources.size, 8);

for (const [path, price, amount] of expected) {
  const resource = resources.get(path);
  assert(resource, 'missing ' + path);
  assert.equal(new URL(resource.resource).origin, EXPECTED_ORIGIN);
  assert.equal(resource.method, 'GET');
  assert.equal(resource.price, price);
  assert.equal(resource.accepts.length, 1);
  const terms = resource.accepts[0];
  assert.equal(terms.scheme, 'exact');
  assert.equal(terms.network, NETWORK);
  assert.equal(terms.amount, amount);
  assert.equal(String(terms.asset).toLowerCase(), USDC);
  assert.equal(String(terms.payTo).toLowerCase(), PAY_TO);
  assert.equal(terms.maxTimeoutSeconds, 60);
  assert.equal(terms.extra?.name, 'USD Coin');
  assert.equal(terms.extra?.version, '2');
}

console.log('PASS 8/8 Floot target manifest resources');
