#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';

const checks = [
  ['root', '/'],
  ['manifest', '/.well-known/x402'],
  ['manifest-json', '/.well-known/x402.json'],
  ['manifest-services', '/.well-known/x402-services.json'],
  ['manifest-service', '/.well-known/x402-service.json'],
  ['manifest-catalog', '/.well-known/x402-catalog.json'],
  ['security', '/.well-known/security.txt'],
  ['openapi', '/openapi.json'],
  ['llms', '/llms.txt'],
  ['llms-full', '/llms-full.txt'],
  ['skill', '/skill.txt'],
  ['sitemap', '/sitemap.xml'],
  ['robots', '/robots.txt'],
  ['pa-best-match', '/_api/pa-entity-one?q=OpenAI'],
  ['pa-search', '/_api/pa-business?q=OpenAI&limit=1'],
  ['vendor-gate', '/_api/vendor-intake-gate?name=OpenAI%20OpCo&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101&domain=openai.com'],
  ['vendor-demo', '/_api/vendor-intake-demo?case=proceed'],
  ['sec', '/_api/sec-filings?ticker=AAPL&limit=1'],
  ['census', '/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233'],
  ['ofac', '/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=1&minScore=90'],
  ['rdap', '/_api/domain-rdap?domain=example.com'],
  ['treasury', '/_api/treasury-average-rates'],
];

const results = [];

for (const [id, path] of checks) {
  const url = ORIGIN + path;
  try {
    const response = await fetch(url, {
      headers: {
        accept: '*/*',
        'user-agent': 'x402-floot-baseline-capture/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let jsonBody = null;
    try {
      jsonBody = JSON.parse(text);
    } catch {
      jsonBody = null;
    }
    results.push({
      id,
      path,
      status: response.status,
      contentType: response.headers.get('content-type'),
      flootStatus: response.headers.get('x-floot-status'),
      paymentRequired: Boolean(response.headers.get('payment-required')),
      bodyLength: text.length,
      bodyPrefix: text.slice(0, 180).replace(/\s+/g, ' '),
      resourceCount:
        id === 'manifest' && Array.isArray(jsonBody?.resources)
          ? jsonBody.resources.length
          : null,
    });
  } catch (error) {
    results.push({
      id,
      path,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const manifest = results.find((item) => item.id === 'manifest');
const paidHealthy = results.filter(
  (item) =>
    ['pa-best-match', 'pa-search'].includes(item.id) &&
    item.status === 402 &&
    item.paymentRequired
).length;
const futureRoutesCurrentlyLive = results.filter(
  (item) =>
    ['vendor-gate', 'vendor-demo', 'sec', 'census', 'ofac', 'rdap', 'treasury'].includes(
      item.id
    ) &&
    item.status != null &&
    item.status !== 404
);

const requireTwoRouteBaseline =
  process.env.REQUIRE_TWO_ROUTE_BASELINE === '1';

const report = {
  checkedAt: new Date().toISOString(),
  origin: ORIGIN,
  expectedCurrentState: 'two-route PA seller before eight-route recovery',
  strictTwoRouteBaselineRequired: requireTwoRouteBaseline,
  manifestResourceCount: manifest?.resourceCount ?? null,
  paidHealthy,
  futureRoutesCurrentlyLive: futureRoutesCurrentlyLive.map((item) => ({
    id: item.id,
    status: item.status,
  })),
  checks: results,
};

const json = JSON.stringify(report, null, 2);
console.log(json);
const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) await writeFile(reportPath, json + '\n', 'utf8');

if (paidHealthy !== 2) process.exitCode = 1;
if (manifest?.status !== 200) process.exitCode = 1;
if (requireTwoRouteBaseline) {
  if (manifest?.resourceCount !== 2) process.exitCode = 1;
  if (futureRoutesCurrentlyLive.length !== 0) process.exitCode = 1;
}
