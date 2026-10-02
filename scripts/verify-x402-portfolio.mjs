#!/usr/bin/env node

/**
 * Zero-spend buyer-style x402 portfolio verifier.
 *
 * This script NEVER sends a payment signature and NEVER settles anything.
 * It verifies that each paid route presents the expected HTTP 402 challenge
 * and that the challenge advertises the expected Base USDC payment terms.
 *
 * Requires Node.js 18+ for global fetch.
 */

const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'.toLowerCase();

const services = [
  {
    id: 'pa-best-match',
    name: 'PA Entity Best Match',
    price: '$0.001',
    amount: '1000',
    url: 'https://pa-entity-x402.floot.app/_api/pa-entity-one?q=OpenAI',
  },
  {
    id: 'pa-enriched-search',
    name: 'PA Entity Enriched Search',
    price: '$0.005',
    amount: '5000',
    url: 'https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=3',
  },
  {
    id: 'vendor-intake-gate',
    name: 'Pennsylvania Vendor Intake Gate',
    price: '$0.020',
    amount: '20000',
    url:
      'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate' +
      '?name=OpenAI%20OpCo' +
      '&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101' +
      '&domain=openai.com',
  },
  {
    id: 'sec-recent-filings',
    name: 'SEC Recent Filings',
    price: '$0.005',
    amount: '5000',
    url:
      'https://api-v2.appdeploy.ai/app/sec-recent-filings-x402-f9qatj/api/sec-filings' +
      '?ticker=AAPL&form=10-K&limit=3',
  },
  {
    id: 'census-geocoder',
    name: 'US Census Address Geocoder',
    price: '$0.005',
    amount: '5000',
    url:
      'https://api-v2.appdeploy.ai/app/us-census-address-geocoder-x402-23mj4x/api/us-address-geocode' +
      '?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233',
  },
  {
    id: 'ofac-sdn-screen',
    name: 'OFAC SDN Name Screen',
    price: '$0.005',
    amount: '5000',
    url:
      'https://api-v2.appdeploy.ai/app/ofac-sdn-name-screen-x402-m9ko96/api/ofac-sdn-screen' +
      '?name=VLADIMIR%20PUTIN&limit=3&minScore=85',
  },
  {
    id: 'domain-rdap',
    name: 'Domain RDAP Lookup',
    price: '$0.005',
    amount: '5000',
    url:
      'https://api-v2.appdeploy.ai/app/domain-rdap-lookup-x402-spdfnq/api/domain-rdap' +
      '?domain=example.com',
  },
  {
    id: 'treasury-average-rates',
    name: 'Treasury Average Interest Rates',
    price: '$0.005',
    amount: '5000',
    url:
      'https://api-v2.appdeploy.ai/app/treasury-average-interest-rates-x402-xeqftl/api/treasury-average-rates',
  },
];

function decodeBase64UrlJson(value) {
  if (!value) throw new Error('missing PAYMENT-REQUIRED header');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function lower(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function acceptedTerms(doc) {
  if (!doc || typeof doc !== 'object') return [];
  return Array.isArray(doc.accepts) ? doc.accepts : [];
}

function validateTerms(service, doc) {
  const failures = [];
  if (doc?.x402Version !== 2) {
    failures.push(`x402Version=${String(doc?.x402Version)} (expected 2)`);
  }

  const terms = acceptedTerms(doc);
  if (terms.length === 0) {
    failures.push('no accepts[] payment terms');
    return failures;
  }

  const matching = terms.find(
    (term) =>
      String(term?.amount) === service.amount &&
      term?.network === NETWORK &&
      lower(term?.asset) === USDC &&
      lower(term?.payTo) === PAY_TO
  );

  if (!matching) {
    failures.push(
      `no accepts[] entry matched amount=${service.amount}, network=${NETWORK}, Base USDC, payout wallet`
    );
  }

  return failures;
}

async function verifyService(service) {
  const started = Date.now();
  const result = {
    id: service.id,
    name: service.name,
    url: service.url,
    expectedPrice: service.price,
    expectedAmount: service.amount,
    ok: false,
    status: null,
    latencyMs: null,
    failures: [],
  };

  try {
    const response = await fetch(service.url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'x402-zero-spend-buyer-verifier/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });

    result.status = response.status;
    result.latencyMs = Date.now() - started;

    if (response.status !== 402) {
      result.failures.push(`HTTP ${response.status} (expected 402)`);
    }

    const paymentRequired = response.headers.get('payment-required');
    let headerDoc = null;
    try {
      headerDoc = decodeBase64UrlJson(paymentRequired);
    } catch (error) {
      result.failures.push(
        `PAYMENT-REQUIRED decode failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (headerDoc) {
      result.failures.push(...validateTerms(service, headerDoc));
    }

    const advertisedPrice = response.headers.get('x402-price');
    if (advertisedPrice && advertisedPrice !== service.price) {
      result.failures.push(
        `x402-price=${advertisedPrice} (expected ${service.price})`
      );
    }

    const advertisedNetwork = response.headers.get('x402-network');
    if (advertisedNetwork && advertisedNetwork !== NETWORK) {
      result.failures.push(
        `x402-network=${advertisedNetwork} (expected ${NETWORK})`
      );
    }

    const advertisedPayTo = response.headers.get('x402-pay-to');
    if (advertisedPayTo && lower(advertisedPayTo) !== PAY_TO) {
      result.failures.push('x402-pay-to does not match portfolio payout wallet');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      result.failures.push(`content-type=${contentType || '(missing)'} (expected JSON)`);
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      result.failures.push('402 response body is not valid JSON');
    }

    if (body && headerDoc) {
      if (body.x402Version !== 2) {
        result.failures.push(
          `body x402Version=${String(body.x402Version)} (expected 2)`
        );
      }
      const bodyFailures = validateTerms(service, body);
      result.failures.push(...bodyFailures.map((x) => `body: ${x}`));
    }

    result.ok = result.failures.length === 0;
  } catch (error) {
    result.latencyMs = Date.now() - started;
    result.failures.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

async function verifyDiscovery() {
  const checks = [
    {
      id: 'floot-manifest',
      url: 'https://pa-entity-x402.floot.app/.well-known/x402',
      expectedResources: 2,
    },
    {
      id: 'appdeploy-pa-manifest',
      url:
        'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402',
      expectedResources: 3,
    },
  ];

  const results = [];
  for (const check of checks) {
    const item = {
      id: check.id,
      url: check.url,
      ok: false,
      status: null,
      resourceCount: null,
      failures: [],
    };
    try {
      const response = await fetch(check.url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'x402-zero-spend-buyer-verifier/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });
      item.status = response.status;
      if (response.status !== 200) {
        item.failures.push(`HTTP ${response.status} (expected 200)`);
      }
      const doc = await response.json();
      if (doc?.x402Version !== 2) {
        item.failures.push(`x402Version=${String(doc?.x402Version)} (expected 2)`);
      }
      item.resourceCount = Array.isArray(doc?.resources) ? doc.resources.length : null;
      if (item.resourceCount !== check.expectedResources) {
        item.failures.push(
          `resourceCount=${String(item.resourceCount)} (expected ${check.expectedResources})`
        );
      }
    } catch (error) {
      item.failures.push(error instanceof Error ? error.message : String(error));
    }
    item.ok = item.failures.length === 0;
    results.push(item);
  }
  return results;
}

async function main() {
  console.log('x402 zero-spend buyer verification');
  console.log(`checkedAt=${new Date().toISOString()}`);
  console.log('No payment signatures will be sent.\n');

  const serviceResults = [];
  for (const service of services) {
    const result = await verifyService(service);
    serviceResults.push(result);
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.name} | status=${result.status} | latency=${result.latencyMs}ms`
    );
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  console.log('\nDiscovery:');
  const discoveryResults = await verifyDiscovery();
  for (const result of discoveryResults) {
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.id} | status=${result.status} | resources=${result.resourceCount}`
    );
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }

  const passedServices = serviceResults.filter((x) => x.ok).length;
  const passedDiscovery = discoveryResults.filter((x) => x.ok).length;

  const report = {
    checkedAt: new Date().toISOString(),
    zeroSpend: true,
    paymentSent: false,
    summary: {
      services: {
        passed: passedServices,
        total: serviceResults.length,
      },
      discovery: {
        passed: passedDiscovery,
        total: discoveryResults.length,
      },
    },
    services: serviceResults,
    discovery: discoveryResults,
  };

  console.log('\nREPORT_JSON');
  console.log(JSON.stringify(report, null, 2));

  if (
    passedServices !== serviceResults.length ||
    passedDiscovery !== discoveryResults.length
  ) {
    process.exitCode = 1;
  }
}

await main();
