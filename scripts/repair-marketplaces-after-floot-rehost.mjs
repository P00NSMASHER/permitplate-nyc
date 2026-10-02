#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const target = JSON.parse(
  await readFile(
    new URL('../recovery/x402-portfolio-target.json', import.meta.url),
    'utf8'
  )
);

function base64Json(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'x402-floot-marketplace-repair/1.0',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

const receipt = {
  checkedAt: new Date().toISOString(),
  mode: 'zero_spend_post_floot_rehost_marketplace_repair',
  origin: ORIGIN,
  paymentSent: false,
  preflight: [],
  market402: [],
  index402: [],
  nohumans: {},
  failures: [],
};

const manifest = await jsonFetch(ORIGIN + '/.well-known/x402');
if (
  manifest.status !== 200 ||
  manifest.body?.x402Version !== 2 ||
  !Array.isArray(manifest.body?.resources) ||
  manifest.body.resources.length !== 8
) {
  throw new Error(
    'Refusing marketplace repair: Floot manifest is not the verified 8-resource state'
  );
}

for (const service of target.resources) {
  const url = ORIGIN + service.path + (service.sampleQuery ?? '');
  const probe = await jsonFetch(url);
  const paymentRequired =
    probe.headers['payment-required'] ??
    probe.headers['Payment-Required'] ??
    null;
  let doc = null;
  try {
    doc = paymentRequired ? base64Json(paymentRequired) : null;
  } catch {
    doc = null;
  }
  const term = Array.isArray(doc?.accepts)
    ? doc.accepts.find(
        (entry) =>
          String(entry?.amount) === String(service.amount) &&
          entry?.network === target.network &&
          String(entry?.asset ?? '').toLowerCase() ===
            String(target.asset).toLowerCase() &&
          String(entry?.payTo ?? '').toLowerCase() ===
            String(target.payTo).toLowerCase()
      )
    : null;

  const ok =
    probe.status === 402 &&
    doc?.x402Version === 2 &&
    Boolean(term);

  receipt.preflight.push({
    id: service.id,
    url,
    status: probe.status,
    paymentRequired: Boolean(paymentRequired),
    x402Version: doc?.x402Version ?? null,
    termsMatch: Boolean(term),
    ok,
  });

  if (!ok) {
    receipt.failures.push('preflight failed for ' + service.id);
  }
}

if (receipt.failures.length) {
  throw new Error(
    'Refusing marketplace repair: one or more Floot paid routes failed zero-spend preflight'
  );
}

const descriptions = {
  'pa-best-match':
    'Resolve one best Pennsylvania business-registry match by company name.',
  'pa-enriched-search':
    'Return ranked Pennsylvania business-registry candidates with filing and address facts.',
  'vendor-intake-gate':
    'Fail-closed Pennsylvania vendor-intake decision using PA registry, Census address, OFAC name-screening, and RDAP evidence; returns proceed or human_review.',
  'sec-recent-filings':
    'Return authoritative recent SEC EDGAR filing metadata by ticker or CIK.',
  'census-geocoder':
    'Geocode one U.S. address with official Census normalized address, coordinates, and geography identifiers.',
  'ofac-sdn-screen':
    'Screen one name against OFAC SDN primary names and aliases and return ranked review candidates.',
  'domain-rdap':
    'Return authoritative domain-registration metadata through IANA RDAP bootstrap and the TLD registry.',
  'treasury-average-rates':
    'Return latest monthly average interest rates on outstanding U.S. Treasury securities.',
};

const names = {
  'pa-best-match': 'Pennsylvania Business Registry Best Match',
  'pa-enriched-search': 'Pennsylvania Business Registry Enriched Search',
  'vendor-intake-gate': 'Pennsylvania Vendor Intake Decision Gate',
  'sec-recent-filings': 'SEC Recent Filings',
  'census-geocoder': 'US Census Address Geocoder',
  'ofac-sdn-screen': 'OFAC SDN Name Screen',
  'domain-rdap': 'Domain RDAP Lookup',
  'treasury-average-rates': 'Treasury Average Interest Rates',
};

const categories = {
  'pa-best-match': 'business/entity-resolution',
  'pa-enriched-search': 'business/company-data',
  'vendor-intake-gate': 'business/vendor-verification',
  'sec-recent-filings': 'finance/sec-filings',
  'census-geocoder': 'data/geocoding',
  'ofac-sdn-screen': 'business/name-screening',
  'domain-rdap': 'data/domain-registration',
  'treasury-average-rates': 'finance/interest-rates',
};

const changedServiceIds = new Set([
  'vendor-intake-gate',
  'sec-recent-filings',
  'census-geocoder',
  'ofac-sdn-screen',
  'domain-rdap',
  'treasury-average-rates',
]);

for (const service of target.resources.filter((item) =>
  changedServiceIds.has(item.id)
)) {
  const resourceUrl = ORIGIN + service.path + (service.sampleQuery ?? '');
  const declaredPrice = Number(service.price.replace('

  const marketSubmit = await jsonFetch('https://market402.com/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: resourceUrl,
      declared_price_usd: declaredPrice,
    }),
  });

  const marketSelftest = await jsonFetch('https://market402.com/selftest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: resourceUrl }),
  });

  receipt.market402.push({
    id: service.id,
    resource: resourceUrl,
    submitStatus: marketSubmit.status,
    submit: marketSubmit.body,
    selftestStatus: marketSelftest.status,
    selftest: marketSelftest.body,
  });

  const indexRegister = await jsonFetch('https://402index.io/api/v1/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: resourceUrl,
      name: names[service.id],
      protocol: 'x402',
      http_method: 'GET',
      description: descriptions[service.id],
      price_usd: declaredPrice,
      payment_asset: 'USDC',
      payment_network: 'Base',
      category: categories[service.id],
      provider: 'P00NSMASHER',
    }),
  });

  receipt.index402.push({
    id: service.id,
    resource: resourceUrl,
    registerStatus: indexRegister.status,
    register: indexRegister.body,
  });
}

const query = encodeURIComponent('Pennsylvania Vendor Intake');
receipt.nohumans = {
  mode: 'read_only',
  note:
    'No listing mutation is attempted because the free listing allowance may already be exhausted and additional listings can require USDC.',
  vendorSearch: await jsonFetch(
    'https://nohumans.directory/v1/discover?q=' + query
  ),
};

const marketFailures = receipt.market402.filter((entry) => {
  const self = entry.selftest;
  const summary = self?.summary ?? self?.instant_check?.summary ?? null;
  return (
    entry.submitStatus >= 400 ||
    entry.selftestStatus >= 400 ||
    (summary && summary.verdict && summary.verdict !== 'spec_compliant')
  );
});
const indexFailures = receipt.index402.filter(
  (entry) => entry.registerStatus >= 400 && entry.registerStatus !== 409
);

for (const entry of marketFailures) {
  receipt.failures.push('Market402 repair issue for ' + entry.id);
}
for (const entry of indexFailures) {
  receipt.failures.push('402 Index repair issue for ' + entry.id);
}

receipt.ok = receipt.failures.length === 0;
receipt.mutationScope = {
  changedRoutesSubmitted: [...changedServiceIds],
  unchangedPaRoutesPreserved: ['pa-best-match', 'pa-enriched-search'],
  rationale:
    'The two PA Floot routes are already live/listed; only the six rehosted URLs need marketplace mutation, conserving 402 Index registration quota.',
};
receipt.accountingNote =
  'Marketplace submissions, self-tests, registrations, unpaid probes, and directory visibility are not buyer revenue.';

const json = JSON.stringify(receipt, null, 2);
console.log(json);
const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) await writeFile(reportPath, json + '\n', 'utf8');

if (!receipt.ok) process.exitCode = 1;
, ''));

  const marketSubmit = await jsonFetch('https://market402.com/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: resourceUrl,
      declared_price_usd: declaredPrice,
    }),
  });

  const marketSelftest = await jsonFetch('https://market402.com/selftest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: resourceUrl }),
  });

  receipt.market402.push({
    id: service.id,
    resource: resourceUrl,
    submitStatus: marketSubmit.status,
    submit: marketSubmit.body,
    selftestStatus: marketSelftest.status,
    selftest: marketSelftest.body,
  });

  const indexRegister = await jsonFetch('https://402index.io/api/v1/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: resourceUrl,
      name: names[service.id],
      protocol: 'x402',
      http_method: 'GET',
      description: descriptions[service.id],
      price_usd: declaredPrice,
      payment_asset: 'USDC',
      payment_network: 'Base',
      category: categories[service.id],
      provider: 'P00NSMASHER',
    }),
  });

  receipt.index402.push({
    id: service.id,
    resource: resourceUrl,
    registerStatus: indexRegister.status,
    register: indexRegister.body,
  });
}

const query = encodeURIComponent('Pennsylvania Vendor Intake');
receipt.nohumans = {
  mode: 'read_only',
  note:
    'No listing mutation is attempted because the free listing allowance may already be exhausted and additional listings can require USDC.',
  vendorSearch: await jsonFetch(
    'https://nohumans.directory/v1/discover?q=' + query
  ),
};

const marketFailures = receipt.market402.filter((entry) => {
  const self = entry.selftest;
  const summary = self?.summary ?? self?.instant_check?.summary ?? null;
  return (
    entry.submitStatus >= 400 ||
    entry.selftestStatus >= 400 ||
    (summary && summary.verdict && summary.verdict !== 'spec_compliant')
  );
});
const indexFailures = receipt.index402.filter(
  (entry) => entry.registerStatus >= 400 && entry.registerStatus !== 409
);

for (const entry of marketFailures) {
  receipt.failures.push('Market402 repair issue for ' + entry.id);
}
for (const entry of indexFailures) {
  receipt.failures.push('402 Index repair issue for ' + entry.id);
}

receipt.ok = receipt.failures.length === 0;
receipt.accountingNote =
  'Marketplace submissions, self-tests, registrations, unpaid probes, and directory visibility are not buyer revenue.';

const json = JSON.stringify(receipt, null, 2);
console.log(json);
const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) await writeFile(reportPath, json + '\n', 'utf8');

if (!receipt.ok) process.exitCode = 1;
