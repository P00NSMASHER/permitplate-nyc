#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../docs/pa-entity-floot-recovery/', import.meta.url);
const target = JSON.parse(
  await readFile(new URL('../recovery/floot-target-manifest.json', import.meta.url), 'utf8')
);
const portfolio = JSON.parse(
  await readFile(new URL('../recovery/x402-portfolio-target.json', import.meta.url), 'utf8')
);
const manifestText = await readFile(new URL('x402.json', root), 'utf8');
const manifest = JSON.parse(manifestText);
const openapiText = await readFile(new URL('openapi.json', root), 'utf8');
const openapi = JSON.parse(openapiText);
const llms = await readFile(new URL('llms.txt', root), 'utf8');
const skill = await readFile(new URL('skill.txt', root), 'utf8');

const ORIGIN = 'https://pa-entity-x402.floot.app';
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

function pathOf(resource) {
  assert.equal(new URL(resource).origin, ORIGIN);
  return new URL(resource).pathname;
}

assert.equal(manifest.x402Version, 2);
assert.equal(manifest.resources.length, 8);

const actualByPath = new Map(
  manifest.resources.map((resource) => [pathOf(resource.resource), resource])
);
const targetByPath = new Map(
  target.resources.map((resource) => [pathOf(resource.resource), resource])
);
assert.equal(actualByPath.size, 8);
assert.equal(targetByPath.size, 8);

for (const [path, price, amount] of expected) {
  const actual = actualByPath.get(path);
  const targetResource = targetByPath.get(path);
  assert(actual, 'recovery manifest missing ' + path);
  assert(targetResource, 'target manifest missing ' + path);

  assert.equal(actual.method, 'GET');
  assert.equal(actual.price, price);
  assert.equal(actual.accepts?.length, 1);
  const terms = actual.accepts[0];
  assert.equal(terms.scheme, 'exact');
  assert.equal(terms.network, NETWORK);
  assert.equal(String(terms.amount), amount);
  assert.equal(String(terms.asset).toLowerCase(), USDC);
  assert.equal(String(terms.payTo).toLowerCase(), PAY_TO);
  assert.equal(terms.maxTimeoutSeconds, 60);
  assert.equal(terms.extra?.name, 'USD Coin');
  assert.equal(terms.extra?.version, '2');

  const targetTerms = targetResource.accepts?.[0] ?? {};
  assert.equal(actual.price, targetResource.price);
  assert.equal(String(terms.amount), String(targetTerms.amount));
  assert.equal(terms.network, targetTerms.network);
  assert.equal(
    String(terms.asset).toLowerCase(),
    String(targetTerms.asset).toLowerCase()
  );
  assert.equal(
    String(terms.payTo).toLowerCase(),
    String(targetTerms.payTo).toLowerCase()
  );

  const op = openapi.paths?.[path]?.get;
  assert(op, 'OpenAPI missing GET ' + path);
  assert.equal(op['x-payment-info']?.network, NETWORK);
  assert.equal(
    String(op['x-payment-info']?.payTo ?? '').toLowerCase(),
    PAY_TO
  );
  const openApiAmount = op['x-payment-info']?.price?.amount;
  assert.equal(openApiAmount, Number(price.slice(1)).toFixed(6));

  const token = path.split('/').pop();
  assert(llms.includes(token), 'llms.txt missing ' + token);
  assert(skill.includes(token), 'skill.txt missing ' + token);
}

assert.equal(Object.keys(openapi.paths ?? {}).length, 8);
assert.equal(portfolio.resources.length, 8);
assert.equal(portfolio.origin, ORIGIN);
assert.equal(portfolio.network, NETWORK);
assert.equal(String(portfolio.asset).toLowerCase(), USDC);
assert.equal(String(portfolio.payTo).toLowerCase(), PAY_TO);

for (const [name, text] of [
  ['manifest', manifestText],
  ['openapi', openapiText],
  ['llms', llms],
  ['skill', skill],
]) {
  assert.ok(
    !text.includes('api-v2.appdeploy.ai'),
    name + ' must not retain an AppDeploy runtime dependency'
  );
}

const endpointFiles = [
  'pa-entity-one_GET.ts',
  'pa-business_GET.ts',
  'vendor-intake-gate_GET.ts',
  'sec-filings_GET.ts',
  'us-address-geocode_GET.ts',
  'ofac-sdn-screen_GET.ts',
  'domain-rdap_GET.ts',
  'treasury-average-rates_GET.ts',
];

for (const file of endpointFiles) {
  const text = await readFile(
    new URL('../docs/pa-entity-floot-release/' + file, import.meta.url),
    'utf8'
  );
  assert.ok(!text.includes('api-v2.appdeploy.ai'), file + ' depends on AppDeploy');
  assert.match(text, /PAYMENT-REQUIRED/i);
  assert.match(text, /PAYMENT-RESPONSE/i);
  assert.match(text, /x402-settled/i);
}

console.log('PASS recovery discovery bundle: 8/8 resources + 8/8 OpenAPI paths');
console.log('PASS recovery endpoint sources: 8/8 free of AppDeploy runtime dependencies');
