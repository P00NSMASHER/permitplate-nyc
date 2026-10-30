import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const ENDPOINT = ORIGIN + '/_api/vendor-intake-gate';
const DEMO = ORIGIN + '/_api/vendor-intake-demo?case=proceed';
const LISTING_ID = '6843d5a6-9ff';
const LISTING_URL =
  'https://api.nohumans.directory/v1/listings/' + LISTING_ID;
const PRIVATE_TOKEN_PATH = '.private-state/nohumans-claim-tokens.json';
const reportPath = process.env.REPORT_PATH?.trim();
const confirmed = process.env.CONFIRM_FREE_EDIT === 'yes';

function requestHeaders(contentType = false, claimToken = null) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'permitplate-nyc-zero-spend-directory-edit/1.0',
  };
  if (contentType) headers['content-type'] = 'application/json';
  if (claimToken) headers['x-claim-token'] = claimToken;
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  assert.equal(names.includes('payment-signature'), false);
  assert.equal(names.includes('x-payment'), false);
  assert.equal(names.includes('authorization'), false);
  return headers;
}

async function fetchJson(url, init = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 2_000) };
  }
  return { response, body, latencyMs: Date.now() - startedAt };
}

const privateTokens = JSON.parse(await readFile(PRIVATE_TOKEN_PATH, 'utf8'));
const tokenRecord = privateTokens[ENDPOINT];
assert.equal(tokenRecord?.listingId, LISTING_ID, 'local edit token mismatch');
assert.ok(tokenRecord.claimToken, 'local edit token missing');
assert.equal(
  confirmed,
  true,
  'set CONFIRM_FREE_EDIT=yes after reviewing the health preflight'
);

const { response: agentResponse, body: agent } = await fetchJson(
  'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app',
  { headers: requestHeaders() }
);
assert.equal(agentResponse.status, 200, 'Agent402 lookup failed');
assert.equal(agent.toolCount, 8, 'Agent402 tool count is not 8');
assert.equal(agent.paidToolCount, 8, 'Agent402 paid tool count is not 8');
assert.equal(agent.health, 1, 'Agent402 health is not green');
assert.equal(agent.routable, true, 'Agent402 origin is not routable');

const { response: beforeResponse, body: before } = await fetchJson(
  LISTING_URL,
  { headers: requestHeaders() }
);
assert.equal(beforeResponse.status, 200, 'vendor listing lookup failed');
assert.equal(before.endpoint_url, ENDPOINT, 'vendor listing endpoint drift');
assert.equal(before.sample_query, DEMO, 'vendor listing preview drift');
assert.equal(before.has_sample, true, 'vendor listing no longer has a preview');
assert.ok(before.probes_failed >= 3, 'insufficient evidence of probe failures');

const paidEndpointChecks = [];
for (let attempt = 0; attempt < 3; attempt += 1) {
  const { response, body, latencyMs } = await fetchJson(ENDPOINT, {
    headers: requestHeaders(),
  });
  const cleanChallenge =
    response.status === 402 &&
    response.headers.has('payment-required') &&
    body?.error === 'payment_required';
  assert.equal(cleanChallenge, true, 'vendor paid endpoint is not healthy');
  paidEndpointChecks.push({
    status: response.status,
    paymentRequiredPresent: response.headers.has('payment-required'),
    error: body?.error ?? null,
    latencyMs,
  });
}

const demoChecks = [];
for (let attempt = 0; attempt < 3; attempt += 1) {
  const { response, body, latencyMs } = await fetchJson(DEMO, {
    headers: requestHeaders(),
  });
  demoChecks.push({
    status: response.status,
    validJson: body?.raw == null,
    decision: body?.decision ?? null,
    latencyMs,
  });
}

const { response: patchResponse, body: patchBody } = await fetchJson(
  LISTING_URL,
  {
    method: 'PATCH',
    headers: requestHeaders(true, tokenRecord.claimToken),
    body: JSON.stringify({ sample_query: null }),
  }
);
assert.equal(patchResponse.status, 200, 'free preview removal failed');

const { response: afterResponse, body: after } = await fetchJson(LISTING_URL, {
  headers: requestHeaders(),
});
assert.equal(afterResponse.status, 200, 'vendor listing readback failed');
assert.equal(after.endpoint_url, ENDPOINT, 'vendor endpoint changed');
assert.equal(after.sample_query, null, 'vendor preview was not removed');
assert.equal(after.has_sample, false, 'vendor listing still advertises a preview');
assert.ok(
  after.probe_count >= before.probe_count,
  'vendor verification history was reset'
);

const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  origin: ORIGIN,
  purpose:
    'Remove the optional vendor demo preview after repeated directory probe failures while the paid endpoint remains publicly healthy.',
  rationale: {
    directoryRule:
      'Every probe cycle fails when a declared sample_query does not return HTTP 2xx JSON; listings without a preview are verified directly from their 402 handshake.',
    documentation: 'https://nohumans.directory/llms.txt',
  },
  publicHealth: {
    agent402: {
      status: agentResponse.status,
      toolCount: agent.toolCount,
      paidToolCount: agent.paidToolCount,
      health: agent.health,
      routable: agent.routable,
    },
    paidEndpointChecks,
    demoChecks,
  },
  before: {
    status: before.status,
    score: before.score,
    probeCount: before.probe_count,
    probesPassed: before.probes_passed,
    probesFailed: before.probes_failed,
    consecutiveFailures: before.consecutive_failures,
    sampleQuery: before.sample_query,
    hasSample: before.has_sample,
  },
  update: {
    status: patchResponse.status,
    responseNote: patchBody?.note ?? null,
    field: 'sample_query',
    value: null,
  },
  after: {
    status: after.status,
    score: after.score,
    probeCount: after.probe_count,
    probesPassed: after.probes_passed,
    probesFailed: after.probes_failed,
    consecutiveFailures: after.consecutive_failures,
    sampleQuery: after.sample_query,
    hasSample: after.has_sample,
  },
  security: {
    credentialType: 'directory edit token only',
    paymentHeadersSent: false,
    paymentSignatureSent: false,
    paidRetryAttempted: false,
    spendUsd: 0,
  },
  completedAt: new Date().toISOString(),
  ok: true,
};

const json = JSON.stringify(receipt, null, 2) + '\n';
console.log(json);
if (reportPath) {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, json, 'utf8');
}
