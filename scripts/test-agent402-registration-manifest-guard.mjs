#!/usr/bin/env node
import assert from 'node:assert/strict';

const realFetch = globalThis.fetch;
let registerPosts = 0;
const observed = [];

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
    url === 'https://agent402.tools/api/index/register' &&
    method === 'POST'
  ) {
    registerPosts += 1;
    throw new Error('agent402_registration_should_not_happen');
  }

  if (url === 'https://pa-entity-x402.floot.app/.well-known/x402') {
    return new Response(
      JSON.stringify({
        x402Version: 2,
        resources: [
          {
            resource:
              'https://pa-entity-x402.floot.app/_api/pa-entity-one',
          },
          {
            resource:
              'https://pa-entity-x402.floot.app/_api/pa-business',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  throw new Error('unexpected_fetch:' + method + ':' + url);
});

let error = null;
try {
  await import(
    new URL(
      './verify-agent402-after-floot-rehost.mjs?guard-test=' + Date.now(),
      import.meta.url
    )
  );
} catch (caught) {
  error = caught;
} finally {
  globalThis.fetch = realFetch;
}

assert(error instanceof Error, 'Agent402 verifier should refuse incomplete manifest');
assert.match(
  error.message,
  /Refusing Agent402 registration: public Floot manifest precondition failed/,
  'Agent402 verifier refused for the wrong reason'
);
assert.equal(registerPosts, 0, 'Agent402 registration POST occurred before manifest acceptance');
assert.equal(
  observed.some(
    (entry) =>
      entry.url === 'https://agent402.tools/api/index/register' &&
      entry.method === 'POST'
  ),
  false,
  'Agent402 registration request was observed'
);

console.log(
  'PASS Agent402 verifier refuses incomplete Floot manifest with 0 registration POSTs'
);
