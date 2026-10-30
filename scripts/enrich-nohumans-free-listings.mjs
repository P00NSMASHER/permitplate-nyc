import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const DIRECTORY = 'https://api.nohumans.directory';
const PRIVATE_TOKEN_PATH = '.private-state/nohumans-claim-tokens.json';
const reportPath = process.env.REPORT_PATH?.trim();
const confirmed = process.env.CONFIRM_FREE_EDITS === 'yes';

const targets = [
  {
    id: 'sec-recent-filings',
    listingId: 'ad7cbe88-c81',
    endpoint: ORIGIN + '/_api/sec-filings',
  },
  {
    id: 'ofac-sdn-screen',
    listingId: 'e74bb774-9e2',
    endpoint: ORIGIN + '/_api/ofac-sdn-screen',
  },
];

function publicHeaders(contentType = false, claimToken = null) {
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
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 2_000) };
  }
  return { response, body };
}

function requestSchemaFor(resources, endpoint) {
  const resource = resources.find((entry) => entry.resource === endpoint);
  assert.ok(resource?.inputSchema, 'immutable input schema missing for ' + endpoint);
  const schema = structuredClone(resource.inputSchema);
  schema.additionalProperties = false;
  if (endpoint.endsWith('/sec-filings')) {
    schema.anyOf = [{ required: ['ticker'] }, { required: ['cik'] }];
  }
  return schema;
}

const [privateTokens, discovery] = await Promise.all([
  readFile(PRIVATE_TOKEN_PATH, 'utf8').then(JSON.parse),
  readFile('docs/pa-entity-floot-recovery/x402-services.json', 'utf8').then(
    JSON.parse
  ),
]);

assert.equal(
  confirmed,
  true,
  'set CONFIRM_FREE_EDITS=yes after reviewing the verified listings'
);

const { response: agentResponse, body: agent } = await fetchJson(
  'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app',
  { headers: publicHeaders() }
);
assert.equal(agentResponse.status, 200, 'Agent402 lookup failed');
assert.equal(agent.toolCount, 8, 'Agent402 tool count is not 8');
assert.equal(agent.paidToolCount, 8, 'Agent402 paid tool count is not 8');
assert.equal(agent.health, 1, 'Agent402 health is not green');
assert.equal(agent.routable, true, 'Agent402 origin is not routable');

const receipt = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  origin: ORIGIN,
  purpose:
    'Add exact request JSON Schemas to verified NoHumans listings without changing endpoints or verification history.',
  source: 'docs/pa-entity-floot-recovery/x402-services.json',
  publicHealth: {
    agent402: {
      status: agentResponse.status,
      toolCount: agent.toolCount,
      paidToolCount: agent.paidToolCount,
      health: agent.health,
      routable: agent.routable,
    },
  },
  updates: [],
  security: {
    credentialType: 'directory edit token only',
    paymentHeadersSent: false,
    paymentSignatureSent: false,
    paidRetryAttempted: false,
    spendUsd: 0,
  },
  ok: false,
};

for (const target of targets) {
  const tokenRecord = privateTokens[target.endpoint];
  assert.equal(
    tokenRecord?.listingId,
    target.listingId,
    target.id + ' local edit credential does not match listing'
  );
  assert.ok(tokenRecord.claimToken, target.id + ' local edit credential missing');

  const listingUrl = DIRECTORY + '/v1/listings/' + target.listingId;
  const { response: beforeResponse, body: before } = await fetchJson(
    listingUrl,
    { headers: publicHeaders() }
  );
  assert.equal(beforeResponse.status, 200, target.id + ' lookup failed');
  assert.equal(before.endpoint_url, target.endpoint, target.id + ' endpoint drift');
  assert.equal(
    before.status,
    'verified',
    target.id + ' is not publicly verified; refusing edit'
  );

  const requestSchema = requestSchemaFor(discovery.resources, target.endpoint);
  const { response: patchResponse, body: patchBody } = await fetchJson(
    listingUrl,
    {
      method: 'PATCH',
      headers: publicHeaders(true, tokenRecord.claimToken),
      body: JSON.stringify({ request_schema: requestSchema }),
    }
  );
  assert.equal(patchResponse.status, 200, target.id + ' schema edit failed');

  const { response: afterResponse, body: after } = await fetchJson(listingUrl, {
    headers: publicHeaders(),
  });
  assert.equal(afterResponse.status, 200, target.id + ' readback failed');
  assert.equal(after.status, 'verified', target.id + ' lost verified status');
  assert.deepEqual(
    after.request_schema,
    requestSchema,
    target.id + ' request schema readback mismatch'
  );

  receipt.updates.push({
    id: target.id,
    listingId: target.listingId,
    endpoint: target.endpoint,
    before: {
      status: before.status,
      hasRequestSchema: Boolean(before.request_schema),
      probeCount: before.probe_count,
      probesPassed: before.probes_passed,
    },
    patchStatus: patchResponse.status,
    responseNote: patchBody?.note ?? null,
    after: {
      status: after.status,
      hasRequestSchema: Boolean(after.request_schema),
      probeCount: after.probe_count,
      probesPassed: after.probes_passed,
      requestSchema,
    },
  });
}

receipt.completedAt = new Date().toISOString();
receipt.ok =
  receipt.updates.length === targets.length &&
  receipt.updates.every(
    (entry) =>
      entry.patchStatus === 200 &&
      entry.after.status === 'verified' &&
      entry.after.hasRequestSchema
  );

const json = JSON.stringify(receipt, null, 2) + '\n';
console.log(json);
if (reportPath) {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, json, 'utf8');
}
if (!receipt.ok) process.exitCode = 1;
