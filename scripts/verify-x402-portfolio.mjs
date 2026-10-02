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

import { writeFile } from 'node:fs/promises';

const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'.toLowerCase();
const EXPECTED_FLOOT_RESOURCES = Number(process.env.EXPECTED_FLOOT_RESOURCES ?? '2');
if (!Number.isInteger(EXPECTED_FLOOT_RESOURCES) || EXPECTED_FLOOT_RESOURCES < 1) {
  throw new Error('EXPECTED_FLOOT_RESOURCES must be a positive integer');
}

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
    paymentRequiredPresent: false,
    appdeployAvailability: null,
    responseBodyCode: null,
    responseBodyMessage: null,
    diagnosticHeaders: {},
    bodyExcerpt: null,
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
    for (const key of [
      'content-type',
      'payment-required',
      'payment-response',
      'x402-price',
      'x402-network',
      'x402-asset',
      'x402-pay-to',
      'server',
      'via',
      'location',
    ]) {
      const value = response.headers.get(key);
      if (value != null) result.diagnosticHeaders[key] = value;
    }

    if (response.status !== 402) {
      result.failures.push(`HTTP ${response.status} (expected 402)`);
    }

    const paymentRequired = response.headers.get('payment-required');
    result.paymentRequiredPresent = Boolean(paymentRequired);
    result.appdeployAvailability =
      response.headers.get('x-appdeploy-app-availability');
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
      result.bodyExcerpt = JSON.stringify(body).slice(0, 2000);
    } catch {
      result.failures.push('402 response body is not valid JSON');
    }

    if (body && typeof body === 'object') {
      result.responseBodyCode =
        typeof body.code === 'string' ? body.code : null;
      result.responseBodyMessage =
        typeof body.message === 'string' ? body.message : null;
      if (body.code === 'APP_TEMPORARILY_UNAVAILABLE') {
        result.failures.push('AppDeploy serving layer reported APP_TEMPORARILY_UNAVAILABLE');
      }
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

async function verifyVendorGateFixtures() {
  const base =
    'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo';
  const fixtures = [
    {
      id: 'gate-proceed',
      url: base + '?case=proceed',
      decision: 'proceed',
      action: 'continue_vendor_intake',
      trigger: null,
      requireCompleteEvidence: true,
    },
    {
      id: 'gate-address-review',
      url: base + '?case=address_mismatch',
      decision: 'human_review',
      action: 'pause_and_request_human_review',
      trigger: 'registered_address_differs',
      requireCompleteEvidence: false,
    },
    {
      id: 'gate-domain-review',
      url: base + '?case=domain_mismatch',
      decision: 'human_review',
      action: 'pause_and_request_human_review',
      trigger: 'domain_name_not_aligned',
      requireCompleteEvidence: false,
    },
  ];

  const results = [];
  for (const fixture of fixtures) {
    const item = {
      id: fixture.id,
      url: fixture.url,
      ok: false,
      status: null,
      decision: null,
      agentAction: null,
      triggers: [],
      diagnosticHeaders: {},
      bodyExcerpt: null,
      failures: [],
    };

    try {
      const response = await fetch(fixture.url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'x402-zero-spend-buyer-verifier/1.0',
        },
        signal: AbortSignal.timeout(20000),
      });
      item.status = response.status;
      for (const key of [
        'content-type',
        'payment-required',
        'payment-response',
        'x402-price',
        'x402-network',
        'x402-asset',
        'x402-pay-to',
        'server',
        'via',
        'location',
      ]) {
        const value = response.headers.get(key);
        if (value != null) item.diagnosticHeaders[key] = value;
      }
      if (response.status !== 200) {
        item.failures.push(`HTTP ${response.status} (expected 200)`);
      }

      const body = await response.json();
      item.bodyExcerpt = JSON.stringify(body).slice(0, 2000);
      item.decision = body?.decision ?? null;
      item.agentAction = body?.agentAction ?? null;
      item.triggers = Array.isArray(body?.reviewTriggers)
        ? body.reviewTriggers.map((entry) => entry?.code).filter(Boolean)
        : [];

      if (item.decision !== fixture.decision) {
        item.failures.push(
          `decision=${String(item.decision)} (expected ${fixture.decision})`
        );
      }
      if (item.agentAction !== fixture.action) {
        item.failures.push(
          `agentAction=${String(item.agentAction)} (expected ${fixture.action})`
        );
      }
      if (fixture.trigger && !item.triggers.includes(fixture.trigger)) {
        item.failures.push(`missing expected review trigger ${fixture.trigger}`);
      }
      if (!fixture.trigger && item.triggers.length !== 0) {
        item.failures.push(
          `unexpected review triggers: ${item.triggers.join(', ')}`
        );
      }

      if (fixture.requireCompleteEvidence) {
        const registryComplete = body?.evidence?.registry?.complete === true;
        const providedCensusComplete =
          body?.evidence?.address?.providedEvidenceComplete === true;
        const registryCensusComplete =
          body?.evidence?.address?.registryEvidenceComplete === true;
        const ofacComplete = body?.evidence?.ofac?.complete === true;
        const rdapComplete = body?.evidence?.domain?.complete === true;

        if (!registryComplete) item.failures.push('registry evidence is not complete');
        if (!providedCensusComplete) {
          item.failures.push('provided-address Census evidence is not complete');
        }
        if (!registryCensusComplete) {
          item.failures.push('registry-address Census evidence is not complete');
        }
        if (!ofacComplete) item.failures.push('OFAC evidence is not complete');
        if (!rdapComplete) item.failures.push('RDAP evidence is not complete');
      }
    } catch (error) {
      item.failures.push(error instanceof Error ? error.message : String(error));
    }

    item.ok = item.failures.length === 0;
    results.push(item);
  }

  return results;
}

async function verifyDiscovery() {
  const checks = [
    {
      id: 'floot-manifest',
      url: 'https://pa-entity-x402.floot.app/.well-known/x402',
      expectedResources: EXPECTED_FLOOT_RESOURCES,
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
      diagnosticHeaders: {},
      bodyExcerpt: null,
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
      for (const key of [
        'content-type',
        'payment-required',
        'payment-response',
        'x402-price',
        'x402-network',
        'x402-asset',
        'x402-pay-to',
        'server',
        'via',
        'location',
      ]) {
        const value = response.headers.get(key);
        if (value != null) item.diagnosticHeaders[key] = value;
      }
      if (response.status !== 200) {
        item.failures.push(`HTTP ${response.status} (expected 200)`);
      }
      const doc = await response.json();
      item.bodyExcerpt = JSON.stringify(doc).slice(0, 2000);
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

async function observePublicDirectories() {
  const gateUrl =
    'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate';
  const checks = [
    {
      id: 'agent402',
      url: 'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app',
    },
    {
      id: '402index',
      url:
        'https://402index.io/api/v1/services' +
        '?q=Pennsylvania%20Vendor%20Intake%20Decision%20Gate&protocol=x402',
    },
    {
      id: 'market402',
      url:
        'https://market402.com/search.json' +
        '?q=Pennsylvania%20Vendor%20Intake%20Decision%20Gate',
    },
    {
      id: 'nohumans',
      url:
        'https://nohumans.directory/v1/discover' +
        '?q=Pennsylvania%20Vendor%20Intake%20Decision%20Gate',
    },
  ];

  const results = [];
  for (const check of checks) {
    const item = {
      id: check.id,
      url: check.url,
      reachable: false,
      status: null,
      json: false,
      containsVendorGate: false,
      topLevelKeys: [],
      summary: {},
      error: null,
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
      item.reachable = response.ok;

      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
        item.json = true;
      } catch {
        body = null;
      }

      if (body && typeof body === 'object') {
        item.topLevelKeys = Object.keys(body).slice(0, 30);

        let candidates = [];
        if (check.id === 'agent402') {
          candidates = Array.isArray(body?.tools) ? body.tools : [];
        } else if (check.id === '402index') {
          candidates = Array.isArray(body?.services) ? body.services : [];
        } else {
          candidates = Array.isArray(body?.results) ? body.results : [];
        }

        const isVendorGateRecord = (record) => {
          const serialized = JSON.stringify(record).toLowerCase();
          return (
            serialized.includes('pennsylvania vendor intake') ||
            serialized.includes('vendor-intake-gate') ||
            serialized.includes(gateUrl.toLowerCase())
          );
        };

        const matches = candidates.filter(isVendorGateRecord);
        item.containsVendorGate = matches.length > 0;

        if (check.id === 'agent402') {
          item.summary = {
            listed: body?.listed ?? null,
            routable: body?.routable ?? null,
            health: body?.health ?? null,
            toolCount: body?.toolCount ?? null,
            paidToolCount: body?.paidToolCount ?? null,
            matchingTools: matches.map((tool) => ({
              name: tool?.name ?? null,
              resource: tool?.resource ?? tool?.url ?? null,
              price: tool?.price ?? null,
            })),
          };
        } else if (check.id === '402index') {
          item.summary = {
            total: body?.total ?? candidates.length,
            returned: candidates.length,
            matchingServices: matches.slice(0, 10).map((service) => ({
              id: service?.id ?? null,
              name: service?.name ?? null,
              url: service?.url ?? service?.endpoint_url ?? null,
              status: service?.status ?? null,
              health: service?.health_status ?? null,
              paymentValid: service?.x402_payment_valid ?? null,
              priceUsd: service?.price_usd ?? null,
            })),
          };
        } else {
          item.summary = {
            total: body?.total ?? body?.count ?? candidates.length,
            returned: candidates.length,
            matchingResults: matches.slice(0, 10).map((record) => ({
              id: record?.id ?? null,
              name: record?.name ?? record?.title ?? null,
              url:
                record?.url ??
                record?.endpoint_url ??
                record?.resource ??
                record?.resource_url ??
                null,
              status: record?.status ?? null,
              price:
                record?.price ??
                record?.price_amount ??
                record?.price_usd ??
                null,
              paidVerified: record?.paid_verified ?? null,
            })),
          };
        }
      }

      if (!response.ok) {
        item.error = `HTTP ${response.status}`;
      } else if (!item.json) {
        item.error = 'response was not JSON';
      }
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
    }

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

  console.log('\nVendor gate fixtures:');
  const fixtureResults = await verifyVendorGateFixtures();
  for (const result of fixtureResults) {
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'} ${result.id} | status=${result.status} | decision=${result.decision} | triggers=${result.triggers.join(',') || 'none'}`
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

  console.log('\nPublic directory observations (advisory, not release-gating):');
  const directoryResults = await observePublicDirectories();
  for (const result of directoryResults) {
    console.log(
      `${result.reachable && result.json ? 'OBSERVED' : 'UNAVAILABLE'} ${result.id} | status=${result.status} | containsVendorGate=${result.containsVendorGate}`
    );
    if (result.error) console.log(`  - ${result.error}`);
  }

  const passedServices = serviceResults.filter((x) => x.ok).length;
  const passedFixtures = fixtureResults.filter((x) => x.ok).length;
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
      fixtures: {
        passed: passedFixtures,
        total: fixtureResults.length,
      },
      discovery: {
        passed: passedDiscovery,
        total: discoveryResults.length,
      },
    },
    services: serviceResults,
    fixtures: fixtureResults,
    discovery: discoveryResults,
    directories: directoryResults,
  };

  const reportJson = JSON.stringify(report, null, 2);
  console.log('\nREPORT_JSON');
  console.log(reportJson);

  const reportPath = process.env.REPORT_PATH?.trim();
  if (reportPath) {
    await writeFile(reportPath, reportJson + '\n', 'utf8');
    console.log(`\nreportPath=${reportPath}`);
  }

  if (
    passedServices !== serviceResults.length ||
    passedFixtures !== fixtureResults.length ||
    passedDiscovery !== discoveryResults.length
  ) {
    process.exitCode = 1;
  }
}

await main();
