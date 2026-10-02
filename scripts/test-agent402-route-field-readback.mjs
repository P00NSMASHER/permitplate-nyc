#!/usr/bin/env node
import assert from 'node:assert/strict';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const requiredPaths = [
  '/_api/pa-entity-one',
  '/_api/pa-business',
  '/_api/vendor-intake-gate',
  '/_api/sec-filings',
  '/_api/us-address-geocode',
  '/_api/ofac-sdn-screen',
  '/_api/domain-rdap',
  '/_api/treasury-average-rates',
];

const originalFetch = globalThis.fetch;
const originalExitCode = process.exitCode;
let registrationPosts = 0;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);

  if (url === ORIGIN + '/.well-known/x402') {
    return json({
      x402Version: 2,
      resources: requiredPaths.map((path) => ({
        resource: ORIGIN + path,
        x402Version: 2,
        accepts: [],
      })),
    });
  }

  if (url === 'https://agent402.tools/api/index/register') {
    assert.equal(init.method, 'POST');
    registrationPosts += 1;
    return json({
      listed: true,
      displayName: 'Agent Data Tools x402',
      toolCount: 8,
      networks: ['eip155:8453'],
      routable: true,
      health: 1,
      reverify: {
        documentsReread: true,
        routesRechecked: true,
        routesProbed: 8,
      },
    });
  }

  if (
    url ===
    'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app'
  ) {
    return json({
      origin: ORIGIN,
      displayName: 'Agent Data Tools x402',
      toolCount: 8,
      paidToolCount: 8,
      health: 1,
      routable: true,
      routerDispatchEligible: false,
      routerDispatchReason: 'settlement_required',
      tools: requiredPaths.map((route, index) => ({
        declared: true,
        method: 'GET',
        name:
          route === '/_api/vendor-intake-gate'
            ? 'Pennsylvania Vendor Intake Decision Gate'
            : 'Tool ' + (index + 1),
        paid: true,
        price: route === '/_api/vendor-intake-gate' ? 0.02 : 0.005,
        route,
      })),
    });
  }

  throw new Error('unexpected fetch: ' + url);
};

try {
  process.exitCode = 0;
  await import(
    './verify-agent402-after-floot-rehost.mjs?route-field-test=' +
      Date.now()
  );

  assert.equal(registrationPosts, 1);
  assert.equal(
    process.exitCode ?? 0,
    0,
    'route-field Agent402 readback must be accepted'
  );

  console.log(
    'PASS Agent402 post-rehost verifier accepts the observed tool.route schema'
  );
} finally {
  globalThis.fetch = originalFetch;
  process.exitCode = originalExitCode;
}
