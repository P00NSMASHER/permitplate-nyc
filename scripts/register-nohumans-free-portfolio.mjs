import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const DIRECTORY = 'https://api.nohumans.directory';
const FREE_LIMIT = 5;
const MAX_CREATES = 3;
const PRIVATE_TOKEN_PATH = path.resolve(
  '.private-state/nohumans-claim-tokens.json'
);
const reportPath = process.env.REPORT_PATH?.trim();
const confirmed = process.env.CONFIRM_FREE_SUBMISSIONS === 'yes';

const candidates = [
  {
    id: 'vendor-intake-gate',
    name: 'Pennsylvania Vendor Intake Decision Gate',
    description:
      'Fail-closed Pennsylvania vendor-intake decision using PA registry identity, Census address consistency, OFAC candidate-name screening, and authoritative RDAP evidence.',
    endpoint_url: ORIGIN + '/_api/vendor-intake-gate',
    category: 'data.procurement',
    price_amount: 0.02,
    sample_query: ORIGIN + '/_api/vendor-intake-demo?case=proceed',
  },
  {
    id: 'sec-recent-filings',
    name: 'SEC Recent Filings x402',
    description:
      'Resolve a ticker or CIK and return authoritative recent SEC EDGAR filing metadata, optionally filtered by exact form.',
    endpoint_url: ORIGIN + '/_api/sec-filings',
    category: 'data.company',
    price_amount: 0.005,
  },
  {
    id: 'ofac-sdn-screen',
    name: 'OFAC SDN Name Screen x402',
    description:
      'Candidate-name screening against current OFAC SDN primary names and aliases, with explicit limitations and no claim of sanctions clearance.',
    endpoint_url: ORIGIN + '/_api/ofac-sdn-screen',
    category: 'infra.compliance',
    price_amount: 0.005,
  },
];

function requestHeaders(contentType = false) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'permitplate-nyc-zero-spend-registration/1.0',
  };
  if (contentType) headers['content-type'] = 'application/json';
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  assert.equal(names.includes('payment-signature'), false);
  assert.equal(names.includes('x-payment'), false);
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

async function enumerateDirectory() {
  const results = [];
  let offset = 0;
  while (true) {
    const url =
      DIRECTORY + '/v1/listings?status=all&limit=200&offset=' + offset;
    const { response, body } = await fetchJson(url, {
      headers: requestHeaders(),
    });
    assert.equal(response.status, 200, 'directory enumeration failed');
    results.push(...(body.results ?? []));
    if (body.next_offset == null) break;
    offset = body.next_offset;
  }
  return results;
}

function sameOrigin(value) {
  try {
    return new URL(value).origin === ORIGIN;
  } catch {
    return false;
  }
}

async function checkPublicHealth() {
  const agentUrl =
    'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app';
  const { response, body } = await fetchJson(agentUrl, {
    headers: requestHeaders(),
  });
  assert.equal(response.status, 200, 'Agent402 lookup failed');
  assert.equal(body.toolCount, 8, 'Agent402 tool count is not 8');
  assert.equal(body.paidToolCount, 8, 'Agent402 paid tool count is not 8');
  assert.equal(body.health, 1, 'Agent402 health is not green');
  assert.equal(body.routable, true, 'Agent402 origin is not routable');

  const routes = [];
  for (const candidate of candidates) {
    const { response: live, body: liveBody } = await fetchJson(
      candidate.endpoint_url,
      { headers: requestHeaders() }
    );
    const logicalStatus = Number(live.headers.get('x-floot-status') ?? live.status);
    assert.equal(logicalStatus, 402, candidate.id + ' did not return a paywall');
    assert.ok(
      live.headers.has('payment-required') || liveBody?.error === 'payment_required',
      candidate.id + ' did not return x402 requirements'
    );
    routes.push({
      id: candidate.id,
      httpStatus: live.status,
      logicalStatus,
      paymentRequiredPresent: live.headers.has('payment-required'),
    });
  }

  return {
    agent402: {
      status: response.status,
      toolCount: body.toolCount,
      paidToolCount: body.paidToolCount,
      health: body.health,
      routable: body.routable,
      routerDispatchEligible: body.routerDispatchEligible,
      routerDispatchReason: body.routerDispatchReason,
    },
    routes,
  };
}

async function loadPrivateTokens() {
  try {
    return JSON.parse(await readFile(PRIVATE_TOKEN_PATH, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function savePrivateTokens(tokens) {
  await mkdir(path.dirname(PRIVATE_TOKEN_PATH), { recursive: true });
  await writeFile(PRIVATE_TOKEN_PATH, JSON.stringify(tokens, null, 2) + '\n', {
    mode: 0o600,
  });
}

function publicResponse(body) {
  const copy = structuredClone(body);
  const redact = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['claim_token', 'edit_token', 'token'].includes(key)) {
        value[key] = '[stored-locally-not-committed]';
      } else {
        redact(child);
      }
    }
  };
  redact(copy);
  return copy;
}

function claimTokenFrom(body) {
  if (!body || typeof body !== 'object') return null;
  for (const [key, value] of Object.entries(body)) {
    if (['claim_token', 'edit_token'].includes(key) && typeof value === 'string') {
      return value;
    }
    const nested = claimTokenFrom(value);
    if (nested) return nested;
  }
  return null;
}

const startedAt = new Date().toISOString();
const receipt = {
  schemaVersion: 1,
  startedAt,
  origin: ORIGIN,
  policy: {
    freeListingsPerRegisteredDomain: FREE_LIMIT,
    maxCreatesThisRun: MAX_CREATES,
    confirmationRequired: true,
    noPaidRetry: true,
  },
  publicHealth: null,
  directoryBefore: null,
  submissions: [],
  directoryAfter: null,
  security: {
    paymentHeadersSent: false,
    paymentSignatureSent: false,
    paidRetryAttempted: false,
    spendUsd: 0,
  },
  ok: false,
};

receipt.publicHealth = await checkPublicHealth();
const allBefore = await enumerateDirectory();
const existingBefore = allBefore.filter((entry) => sameOrigin(entry.endpoint_url));
const remainingFreeSlots = Math.max(0, FREE_LIMIT - existingBefore.length);
receipt.directoryBefore = {
  totalListings: allBefore.length,
  originListings: existingBefore.map((entry) => ({
    id: entry.id,
    name: entry.name,
    endpoint_url: entry.endpoint_url,
    status: entry.status,
  })),
  remainingFreeSlots,
};

assert.ok(
  existingBefore.length <= FREE_LIMIT,
  'registered domain is already over its free allowance'
);
assert.ok(remainingFreeSlots > 0, 'no free listing slots remain');
assert.equal(
  candidates.some((candidate) =>
    existingBefore.some((entry) => entry.endpoint_url === candidate.endpoint_url)
  ),
  false,
  'a candidate endpoint is already listed'
);
assert.equal(
  confirmed,
  true,
  'set CONFIRM_FREE_SUBMISSIONS=yes after reviewing the preflight'
);

const selected = candidates.slice(0, Math.min(MAX_CREATES, remainingFreeSlots));
const privateTokens = await loadPrivateTokens();

for (const candidate of selected) {
  const payload = {
    name: candidate.name,
    description: candidate.description,
    endpoint_url: candidate.endpoint_url,
    category: candidate.category,
    price_amount: candidate.price_amount,
    price_currency: 'USDC',
    chains: ['base'],
    ...(candidate.sample_query ? { sample_query: candidate.sample_query } : {}),
  };
  const { response, body } = await fetchJson(DIRECTORY + '/v1/listings', {
    method: 'POST',
    headers: requestHeaders(true),
    body: JSON.stringify(payload),
  });

  receipt.submissions.push({
    id: candidate.id,
    endpoint_url: candidate.endpoint_url,
    status: response.status,
    response: publicResponse(body),
  });

  if (response.status === 402) {
    throw new Error(
      'directory requested payment; stopped without a signature or paid retry'
    );
  }
  assert.equal(response.status, 201, candidate.id + ' was not created');

  const claimToken = claimTokenFrom(body);
  if (claimToken) {
    privateTokens[candidate.endpoint_url] = {
      listingId: body.id ?? body.listing?.id ?? null,
      claimToken,
      savedAt: new Date().toISOString(),
    };
    await savePrivateTokens(privateTokens);
  }
}

const allAfter = await enumerateDirectory();
const existingAfter = allAfter.filter((entry) => sameOrigin(entry.endpoint_url));
receipt.directoryAfter = {
  totalListings: allAfter.length,
  originListings: existingAfter.map((entry) => ({
    id: entry.id,
    name: entry.name,
    endpoint_url: entry.endpoint_url,
    category: entry.category,
    status: entry.status,
    price_amount: entry.price_amount,
  })),
  remainingFreeSlots: Math.max(0, FREE_LIMIT - existingAfter.length),
};
receipt.completedAt = new Date().toISOString();
receipt.ok =
  receipt.submissions.length === selected.length &&
  receipt.submissions.every((entry) => entry.status === 201) &&
  existingAfter.length === existingBefore.length + selected.length;

const json = JSON.stringify(receipt, null, 2) + '\n';
console.log(json);
if (reportPath) {
  await mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await writeFile(reportPath, json, 'utf8');
}
if (!receipt.ok) process.exitCode = 1;
