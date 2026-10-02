#!/usr/bin/env node

const BASE =
  process.env.FLOOT_SANDBOX_API_BASE?.trim().replace(/\/$/, '') ||
  'https://b69a3ee6-eb01-430d-aa51-da2fc7beeac4.sandbox.floot.app';

const NETWORK = 'eip155:8453';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';

const paid = [
  ['pa-best-match', '/_api/pa-entity-one?q=OpenAI', '1000'],
  ['pa-enriched-search', '/_api/pa-business?q=OpenAI&limit=3', '5000'],
  [
    'vendor-intake-gate',
    '/_api/vendor-intake-gate?name=OpenAI%20OpCo&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101&domain=openai.com',
    '20000',
  ],
  ['sec-filings', '/_api/sec-filings?ticker=AAPL&form=10-K&limit=1', '5000'],
  [
    'census-geocoder',
    '/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233',
    '5000',
  ],
  ['ofac-sdn-screen', '/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=1&minScore=90', '5000'],
  ['domain-rdap', '/_api/domain-rdap?domain=example.com', '5000'],
  ['treasury-average-rates', '/_api/treasury-average-rates?security=Total%20Marketable', '5000'],
];

const fixtures = [
  ['proceed', 'proceed', null],
  ['address_mismatch', 'human_review', 'registered_address_differs'],
  ['domain_mismatch', 'human_review', 'domain_name_not_aligned'],
];

function decodeHeader(value) {
  if (!value) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

const report = {
  checkedAt: new Date().toISOString(),
  base: BASE,
  zeroSpend: true,
  paymentSent: false,
  paid: [],
  fixtures: [],
};

let failures = 0;

for (const [id, path, expectedAmount] of paid) {
  const item = { id, path, expectedAmount, ok: false, failures: [] };
  try {
    const response = await fetch(BASE + path, {
      headers: {
        accept: 'application/json',
        'user-agent': 'floot-staged-sandbox-verifier/1.0',
      },
      signal: AbortSignal.timeout(20000),
    });

    item.httpStatus = response.status;
    item.flootStatus = response.headers.get('x-floot-status');
    item.paymentRequired = Boolean(response.headers.get('payment-required'));

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    let headerDoc = null;
    try {
      headerDoc = decodeHeader(response.headers.get('payment-required'));
    } catch {
      item.failures.push('PAYMENT-REQUIRED was not decodable JSON');
    }

    const doc = headerDoc ?? body;
    const term = Array.isArray(doc?.accepts) ? doc.accepts[0] : null;

    const sellerChallenge =
      response.status === 402 ||
      (response.status === 200 && response.headers.get('x-floot-status') === '402');

    if (!sellerChallenge) {
      item.failures.push(
        'seller challenge status missing; http=' +
          response.status +
          ' x-floot-status=' +
          String(item.flootStatus)
      );
    }
    if (!item.paymentRequired) item.failures.push('PAYMENT-REQUIRED missing');
    if (doc?.x402Version !== 2) item.failures.push('x402Version != 2');
    if (String(term?.amount) !== expectedAmount) {
      item.failures.push(
        'amount=' + String(term?.amount) + ' expected=' + expectedAmount
      );
    }
    if (term?.network !== NETWORK) item.failures.push('network mismatch');
    if (String(term?.asset ?? '').toLowerCase() !== USDC) {
      item.failures.push('USDC asset mismatch');
    }
    if (String(term?.payTo ?? '').toLowerCase() !== PAY_TO) {
      item.failures.push('payTo mismatch');
    }
  } catch (error) {
    item.failures.push(error instanceof Error ? error.message : String(error));
  }

  item.ok = item.failures.length === 0;
  if (!item.ok) failures += 1;
  report.paid.push(item);
  console.log(
    (item.ok ? 'PASS ' : 'FAIL ') +
      id +
      ' http=' +
      String(item.httpStatus ?? 'ERR') +
      ' amount=' +
      String(item.expectedAmount)
  );
  for (const failure of item.failures) console.log('  - ' + failure);
}

for (const [sampleCase, expectedDecision, expectedTrigger] of fixtures) {
  const item = {
    sampleCase,
    expectedDecision,
    expectedTrigger,
    ok: false,
    failures: [],
  };

  try {
    const response = await fetch(
      BASE + '/_api/vendor-intake-demo?case=' + sampleCase,
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'floot-staged-sandbox-verifier/1.0',
        },
        signal: AbortSignal.timeout(30000),
      }
    );
    item.httpStatus = response.status;
    const body = await response.json();
    item.decision = body?.decision ?? null;
    item.agentAction = body?.agentAction ?? null;
    item.triggers = Array.isArray(body?.reviewTriggers)
      ? body.reviewTriggers.map((entry) => entry?.code).filter(Boolean)
      : [];

    if (response.status !== 200) {
      item.failures.push('HTTP ' + response.status + ' expected 200');
    }
    if (item.decision !== expectedDecision) {
      item.failures.push(
        'decision=' + String(item.decision) + ' expected=' + expectedDecision
      );
    }
    if (expectedTrigger) {
      if (!item.triggers.includes(expectedTrigger)) {
        item.failures.push('missing trigger ' + expectedTrigger);
      }
    } else if (item.triggers.length !== 0) {
      item.failures.push('unexpected triggers ' + item.triggers.join(','));
    }

    if (sampleCase === 'proceed') {
      if (body?.evidence?.registry?.complete !== true) {
        item.failures.push('registry evidence incomplete');
      }
      if (body?.evidence?.address?.providedEvidenceComplete !== true) {
        item.failures.push('provided Census evidence incomplete');
      }
      if (body?.evidence?.ofac?.complete !== true) {
        item.failures.push('OFAC evidence incomplete');
      }
      if (body?.evidence?.domain?.complete !== true) {
        item.failures.push('RDAP evidence incomplete');
      }
    }
  } catch (error) {
    item.failures.push(error instanceof Error ? error.message : String(error));
  }

  item.ok = item.failures.length === 0;
  if (!item.ok) failures += 1;
  report.fixtures.push(item);
  console.log(
    (item.ok ? 'PASS ' : 'FAIL ') +
      'fixture ' +
      sampleCase +
      ' decision=' +
      String(item.decision ?? 'ERR')
  );
  for (const failure of item.failures) console.log('  - ' + failure);
}

report.summary = {
  paidPassed: report.paid.filter((item) => item.ok).length,
  paidTotal: report.paid.length,
  fixturesPassed: report.fixtures.filter((item) => item.ok).length,
  fixturesTotal: report.fixtures.length,
  failures,
};

console.log('\nREPORT_JSON');
console.log(JSON.stringify(report, null, 2));

if (failures > 0) process.exitCode = 1;
