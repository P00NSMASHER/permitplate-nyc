#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const NETWORK = 'eip155:8453';
const ASSET = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const REPORT_PATH = process.env.REPORT_PATH?.trim() || '';

const receipt = JSON.parse(
  await readFile(
    new URL(
      '../verification/floot-static-rollback-public-latest.json',
      import.meta.url
    ),
    'utf8'
  )
);

function decodeHeader(value) {
  if (!value) throw new Error('missing PAYMENT-REQUIRED');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: '*/*',
      'user-agent': 'x402-floot-preflight/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  return { response, text };
}

const staticResults = [];
for (const baseline of receipt.files) {
  const item = {
    target: baseline.target,
    publicPath: baseline.publicPath,
    status: null,
    sha256: null,
    expectedSha256: baseline.sha256,
    ok: false,
    failures: [],
  };

  try {
    const { response, text } = await fetchText(
      receipt.productionOrigin + baseline.publicPath
    );
    item.status = response.status;
    if (response.status !== 200) {
      item.failures.push('HTTP ' + response.status + ' expected 200');
    }
    item.sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    if (item.sha256 !== baseline.sha256) {
      item.failures.push('public body SHA-256 drift');
    }
  } catch (error) {
    item.failures.push(
      error instanceof Error ? error.message : String(error)
    );
  }

  item.ok = item.failures.length === 0;
  staticResults.push(item);
  console.log(
    (item.ok ? 'PASS ' : 'FAIL ') +
      item.publicPath +
      ' status=' +
      String(item.status)
  );
  for (const failure of item.failures) console.log('  - ' + failure);
}

const routes = [
  {
    id: 'pa-best-match',
    url: ORIGIN + '/_api/pa-entity-one?q=OpenAI',
    amount: '1000',
  },
  {
    id: 'pa-enriched-search',
    url: ORIGIN + '/_api/pa-business?q=OpenAI&limit=3',
    amount: '5000',
  },
];

const paidResults = [];
for (const route of routes) {
  const item = {
    id: route.id,
    status: null,
    paymentRequired: false,
    ok: false,
    failures: [],
  };

  try {
    const response = await fetch(route.url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'x402-floot-preflight/1.0',
      },
      signal: AbortSignal.timeout(20000),
    });
    item.status = response.status;
    const header = response.headers.get('payment-required');
    item.paymentRequired = Boolean(header);

    if (response.status !== 402) {
      item.failures.push('HTTP ' + response.status + ' expected 402');
    }

    let doc = null;
    try {
      doc = decodeHeader(header);
    } catch (error) {
      item.failures.push(
        error instanceof Error ? error.message : String(error)
      );
    }

    if (doc) {
      if (doc.x402Version !== 2) item.failures.push('x402Version mismatch');
      const terms = Array.isArray(doc.accepts) ? doc.accepts : [];
      const match = terms.find(
        (term) =>
          String(term?.amount) === route.amount &&
          term?.network === NETWORK &&
          String(term?.asset ?? '').toLowerCase() === ASSET &&
          String(term?.payTo ?? '').toLowerCase() === PAY_TO
      );
      if (!match) item.failures.push('payment terms mismatch');
    }
  } catch (error) {
    item.failures.push(
      error instanceof Error ? error.message : String(error)
    );
  }

  item.ok = item.failures.length === 0;
  paidResults.push(item);
  console.log(
    (item.ok ? 'PASS ' : 'FAIL ') +
      item.id +
      ' status=' +
      String(item.status)
  );
}

let manifest = null;
try {
  const { response, text } = await fetchText(ORIGIN + '/.well-known/x402');
  if (response.status !== 200) {
    throw new Error('manifest HTTP ' + response.status);
  }
  manifest = JSON.parse(text);
} catch (error) {
  console.error(
    'FAIL canonical manifest: ' +
      (error instanceof Error ? error.message : String(error))
  );
}

const manifestOk =
  manifest?.x402Version === 2 &&
  Array.isArray(manifest?.resources) &&
  manifest.resources.length === 2;

const report = {
  checkedAt: new Date().toISOString(),
  origin: ORIGIN,
  zeroSpend: true,
  paymentSent: false,
  baselineCapturedAt: receipt.capturedAt,
  staticFiles: {
    passed: staticResults.filter((item) => item.ok).length,
    total: staticResults.length,
  },
  paidRoutes: {
    passed: paidResults.filter((item) => item.ok).length,
    total: paidResults.length,
  },
  canonicalManifestResourceCount: Array.isArray(manifest?.resources)
    ? manifest.resources.length
    : null,
  manifestOk,
  staticResults,
  paidResults,
  green:
    staticResults.every((item) => item.ok) &&
    paidResults.every((item) => item.ok) &&
    manifestOk,
};

const json = JSON.stringify(report, null, 2);
console.log('\n' + json);

if (REPORT_PATH) {
  await writeFile(REPORT_PATH, json + '\n', 'utf8');
}

if (!report.green) process.exitCode = 1;
