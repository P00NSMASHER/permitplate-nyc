#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const NETWORK = 'eip155:8453';
const ASSET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const REGISTER = process.env.REGISTER_DIRECTORIES === '1';
const RECEIPT_PATH = process.env.POSTDEPLOY_RECEIPT_PATH?.trim() || '';

const target = JSON.parse(
  await readFile(
    new URL('../recovery/x402-portfolio-target.json', import.meta.url),
    'utf8'
  )
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeX402(value) {
  if (!value) throw new Error('missing PAYMENT-REQUIRED');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function request(url, init = {}, timeoutMs = 20000) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'x402-floot-postdeploy/1.0',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    text: text.slice(0, 6000),
  };
}

function paymentTermMatches(doc, service) {
  if (doc?.x402Version !== 2) return false;
  const terms = Array.isArray(doc?.accepts) ? doc.accepts : [];
  return terms.some(
    (term) =>
      String(term?.amount) === String(service.amount) &&
      term?.network === NETWORK &&
      String(term?.asset ?? '').toLowerCase() === ASSET &&
      String(term?.payTo ?? '').toLowerCase() === PAY_TO
  );
}

async function verifyPaidRoutes() {
  const results = [];
  for (const service of target.resources) {
    const url = ORIGIN + service.path + (service.sampleQuery ?? '');
    const item = {
      id: service.id,
      url,
      status: null,
      ok: false,
      failures: [],
    };
    try {
      const result = await request(url);
      item.status = result.status;
      if (result.status !== 402) {
        item.failures.push('HTTP ' + result.status + ' expected 402');
      }
      let doc = null;
      try {
        doc = decodeX402(result.headers['payment-required']);
      } catch (error) {
        item.failures.push(
          error instanceof Error ? error.message : String(error)
        );
      }
      if (doc) {
        if (!paymentTermMatches(doc, service)) {
          item.failures.push('payment terms mismatch');
        }
        if (doc?.resource?.url !== ORIGIN + service.path) {
          item.failures.push(
            'resource URL mismatch: ' + String(doc?.resource?.url)
          );
        }
      }
      if (!result.body || result.body.x402Version !== 2) {
        item.failures.push('402 body missing x402Version 2');
      }
    } catch (error) {
      item.failures.push(
        error instanceof Error ? error.message : String(error)
      );
    }
    item.ok = item.failures.length === 0;
    results.push(item);
    console.log(
      (item.ok ? 'PASS ' : 'FAIL ') +
        service.id +
        ' status=' +
        String(item.status)
    );
    for (const failure of item.failures) console.log('  - ' + failure);
  }
  return results;
}

async function verifyFixtures() {
  const results = [];
  for (const fixture of target.fixedFixtures) {
    const item = {
      id: fixture.id,
      url: ORIGIN + fixture.path,
      status: null,
      decision: null,
      triggers: [],
      ok: false,
      failures: [],
    };
    try {
      const result = await request(item.url, {}, 30000);
      item.status = result.status;
      item.decision = result.body?.decision ?? null;
      item.triggers = Array.isArray(result.body?.reviewTriggers)
        ? result.body.reviewTriggers.map((x) => x?.code).filter(Boolean)
        : [];
      if (result.status !== 200) {
        item.failures.push('HTTP ' + result.status + ' expected 200');
      }
      if (item.decision !== fixture.expectedDecision) {
        item.failures.push(
          'decision=' +
            String(item.decision) +
            ' expected=' +
            fixture.expectedDecision
        );
      }
      if (fixture.expectedTrigger) {
        if (!item.triggers.includes(fixture.expectedTrigger)) {
          item.failures.push('missing trigger ' + fixture.expectedTrigger);
        }
      } else if (item.triggers.length !== 0) {
        item.failures.push(
          'unexpected triggers ' + item.triggers.join(',')
        );
      }
    } catch (error) {
      item.failures.push(
        error instanceof Error ? error.message : String(error)
      );
    }
    item.ok = item.failures.length === 0;
    results.push(item);
    console.log(
      (item.ok ? 'PASS ' : 'FAIL ') +
        item.id +
        ' decision=' +
        String(item.decision)
    );
  }
  return results;
}

async function verifyDiscovery() {
  const manifest = await request(ORIGIN + '/.well-known/x402');
  const openapi = await request(ORIGIN + '/openapi.json');
  const resources = Array.isArray(manifest.body?.resources)
    ? manifest.body.resources
    : [];
  const paths =
    openapi.body?.paths && typeof openapi.body.paths === 'object'
      ? Object.keys(openapi.body.paths)
      : [];
  const manifestPaths = resources.map((r) => {
    try {
      return new URL(r.resource).pathname;
    } catch {
      return null;
    }
  });
  const expectedPaths = target.resources.map((r) => r.path);
  const sameOrigin = resources.every((r) => {
    try {
      return new URL(r.resource).origin === ORIGIN;
    } catch {
      return false;
    }
  });
  const result = {
    manifestStatus: manifest.status,
    openapiStatus: openapi.status,
    manifestResourceCount: resources.length,
    openapiPathCount: paths.length,
    sameOrigin,
    missingManifestPaths: expectedPaths.filter(
      (path) => !manifestPaths.includes(path)
    ),
    missingOpenApiPaths: expectedPaths.filter((path) => !paths.includes(path)),
  };
  result.ok =
    manifest.status === 200 &&
    manifest.body?.x402Version === 2 &&
    openapi.status === 200 &&
    resources.length === 8 &&
    paths.length === 8 &&
    sameOrigin &&
    result.missingManifestPaths.length === 0 &&
    result.missingOpenApiPaths.length === 0;
  console.log(
    (result.ok ? 'PASS' : 'FAIL') +
      ' discovery resources=' +
      resources.length +
      ' openapi=' +
      paths.length
  );
  return result;
}

async function registerAgent402() {
  const register = await request(
    'https://agent402.tools/api/index/register',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: ORIGIN }),
    },
    30000
  );

  let seller = null;
  for (const delay of [0, 2000, 5000]) {
    if (delay) await sleep(delay);
    seller = await request(
      'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app'
    );
    const tools = Array.isArray(seller.body?.tools) ? seller.body.tools : [];
    const blob = JSON.stringify(tools).toLowerCase();
    if (
      Number(seller.body?.paidToolCount ?? 0) >= 8 &&
      blob.includes('vendor-intake-gate')
    ) {
      break;
    }
  }

  const tools = Array.isArray(seller?.body?.tools) ? seller.body.tools : [];
  const blob = JSON.stringify(tools).toLowerCase();
  return {
    registerStatus: register.status,
    registerBody: register.body,
    sellerStatus: seller?.status ?? null,
    toolCount: seller?.body?.toolCount ?? null,
    paidToolCount: seller?.body?.paidToolCount ?? null,
    health: seller?.body?.health ?? null,
    routable: seller?.body?.routable ?? null,
    routerDispatchEligible: seller?.body?.routerDispatchEligible ?? null,
    routerDispatchReason: seller?.body?.routerDispatchReason ?? null,
    vendorGateVisible:
      blob.includes('vendor-intake-gate') ||
      blob.includes('vendor intake decision gate'),
    tools,
  };
}

async function refreshMarketplaces() {
  const rehosted = target.resources.filter(
    (service) =>
      !['pa-best-match', 'pa-enriched-search'].includes(service.id)
  );
  const market402 = [];
  const index402 = [];

  for (const service of rehosted) {
    const resource = ORIGIN + service.path + (service.sampleQuery ?? '');
    const price = Number(service.price.replace('$', ''));

    const marketSubmit = await request(
      'https://market402.com/submit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resource,
          declared_price_usd: price,
        }),
      },
      30000
    );
    market402.push({
      id: service.id,
      status: marketSubmit.status,
      body: marketSubmit.body,
    });

    const indexRegister = await request(
      'https://402index.io/api/v1/register',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: resource,
          name: service.name,
          protocol: 'x402',
          http_method: 'GET',
          description:
            service.name +
            ' — same-origin x402 service at ' +
            ORIGIN +
            service.path,
          price_usd: price,
          payment_asset: 'USDC',
          payment_network: 'Base',
          category: service.tags?.[0] ?? 'data',
          provider: 'P00NSMASHER',
        }),
      },
      30000
    );
    index402.push({
      id: service.id,
      status: indexRegister.status,
      body: indexRegister.body,
    });
  }

  const vendorQuery = encodeURIComponent(
    'Pennsylvania Vendor Intake Decision Gate'
  );
  const readback = {
    market402: await request(
      'https://market402.com/search.json?q=' + vendorQuery
    ),
    index402: await request(
      'https://402index.io/api/v1/services?q=' +
        vendorQuery +
        '&protocol=x402&limit=50'
    ),
    nohumans: await request(
      'https://nohumans.directory/v1/discover?q=' + vendorQuery
    ),
  };

  return { market402, index402, readback };
}

const startedAt = new Date().toISOString();
console.log('Floot x402 post-deploy verification');
console.log('origin=' + ORIGIN);
console.log('paymentSent=false');
console.log('directoryRegistration=' + REGISTER);

const paidRoutes = await verifyPaidRoutes();
const fixtures = await verifyFixtures();
const discovery = await verifyDiscovery();
const publicGreen =
  paidRoutes.every((x) => x.ok) &&
  fixtures.every((x) => x.ok) &&
  discovery.ok;

let agent402 = null;
let marketplaces = null;

if (publicGreen && REGISTER) {
  console.log('\nRegistering public directories after green release...');
  agent402 = await registerAgent402();
  marketplaces = await refreshMarketplaces();
} else if (!publicGreen) {
  console.log(
    '\nSKIP directory registration: public release verification is not green.'
  );
} else {
  console.log(
    '\nSKIP directory registration: set REGISTER_DIRECTORIES=1 after reviewing the green public release.'
  );
}

const receipt = {
  startedAt,
  checkedAt: new Date().toISOString(),
  origin: ORIGIN,
  zeroSpend: true,
  paymentSent: false,
  publicGreen,
  directoryRegistrationRequested: REGISTER,
  paidRoutes,
  fixtures,
  discovery,
  agent402,
  marketplaces,
  accountingNote:
    'Verification, directory registration, self-tests, probes, and seller-funded activity are not third-party revenue.',
};

if (RECEIPT_PATH) {
  await writeFile(
    RECEIPT_PATH,
    JSON.stringify(receipt, null, 2) + '\n',
    'utf8'
  );
  console.log('receipt=' + RECEIPT_PATH);
}

if (!publicGreen) {
  process.exitCode = 1;
} else if (REGISTER) {
  const agentOk =
    agent402?.health === 1 &&
    agent402?.routable === true &&
    Number(agent402?.paidToolCount ?? 0) >= 8 &&
    agent402?.vendorGateVisible === true;
  if (!agentOk) {
    console.error('Agent402 did not yet recognize the full expanded portfolio.');
    process.exitCode = 2;
  }
}
