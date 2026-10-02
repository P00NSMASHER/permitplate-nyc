#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const target = JSON.parse(
  await readFile(
    new URL('../recovery/x402-portfolio-target.json', import.meta.url),
    'utf8'
  )
);

const realFetch = globalThis.fetch;
const mutationCalls = [];
const observed = [];

function x402Doc(service) {
  return {
    x402Version: 2,
    resource: {
      url: target.origin + service.path,
      description: service.name,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: target.network,
        amount: service.amount,
        asset: target.asset,
        payTo: target.payTo,
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  };
}

function base64(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

globalThis.fetch = (async (input, init = {}) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = String(init.method ?? 'GET').toUpperCase();
  observed.push({ url, method });

  if (
    method === 'POST' &&
    (url.startsWith('https://market402.com/') ||
      url.startsWith('https://402index.io/'))
  ) {
    mutationCalls.push({ url, method });
    throw new Error('marketplace_mutation_should_not_happen');
  }

  if (url === target.origin + '/.well-known/x402') {
    return new Response(
      JSON.stringify({
        x402Version: 2,
        resources: target.resources.map((service) => ({
          resource: target.origin + service.path,
          accepts: x402Doc(service).accepts,
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  const service = target.resources.find(
    (entry) =>
      url === target.origin + entry.path + (entry.sampleQuery ?? '')
  );
  if (service) {
    const doc = x402Doc(service);
    return new Response(JSON.stringify(doc), {
      status: 402,
      headers: {
        'content-type': 'application/json',
        'payment-required': base64(doc),
      },
    });
  }

  if (
    url ===
    'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app'
  ) {
    return new Response(
      JSON.stringify({
        health: 1,
        routable: true,
        toolCount: 2,
        paidToolCount: 2,
        tools: [
          { name: 'PA best match', resource: target.origin + '/_api/pa-entity-one' },
          { name: 'PA search', resource: target.origin + '/_api/pa-business' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  throw new Error('unexpected_fetch:' + method + ':' + url);
}) ;

let error = null;
try {
  await import(
    new URL(
      './repair-marketplaces-after-floot-rehost.mjs?guard-test=' + Date.now(),
      import.meta.url
    )
  );
} catch (caught) {
  error = caught;
} finally {
  globalThis.fetch = realFetch;
}

assert(error instanceof Error, 'repair script should refuse stale Agent402 state');
assert.match(
  error.message,
  /Agent402 has not yet accepted the expanded 8-tool Floot portfolio/,
  'repair script refused for the wrong reason'
);
assert.equal(
  mutationCalls.length,
  0,
  'marketplace mutation happened before Agent402 acceptance'
);
assert.ok(
  observed.some(
    (entry) =>
      entry.url ===
      'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app'
  ),
  'Agent402 readback was not checked'
);

console.log(
  'PASS marketplace repair fails closed on stale Agent402 state with 0 directory mutations'
);
