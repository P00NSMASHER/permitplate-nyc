#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const SELLER = 'pa-entity-x402.floot.app';
const REGISTER = 'https://agent402.tools/api/index/register';
const READBACK = 'https://agent402.tools/api/index?seller=' + SELLER;
const requiredPaths = [
  '/_api/pa-entity-one',
  '/_api/pa-business',
  '/_api/vendor-intake-gate',
  '/_api/sec-filings',
  '/_api/us-address-geocode',
  '/_api/ofac-sdn-screen',
  '/_api/domain-rdap',
  '/_api/treasury-average-rates',
];

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { response, body, text };
}

const failures = [];
const observations = {};

const manifestResult = await jsonFetch(ORIGIN + '/.well-known/x402');
observations.manifest = {
  status: manifestResult.response.status,
  x402Version: manifestResult.body?.x402Version ?? null,
  resourceCount: Array.isArray(manifestResult.body?.resources)
    ? manifestResult.body.resources.length
    : null,
};
if (manifestResult.response.status !== 200) {
  failures.push('Floot manifest HTTP ' + manifestResult.response.status);
}
if (manifestResult.body?.x402Version !== 2) {
  failures.push('Floot manifest x402Version is not 2');
}
if (observations.manifest.resourceCount !== 8) {
  failures.push(
    'Floot manifest resourceCount=' +
      String(observations.manifest.resourceCount) +
      ' expected=8'
  );
}

const manifestResources = Array.isArray(manifestResult.body?.resources)
  ? manifestResult.body.resources
  : [];
const manifestPaths = new Set();
for (const resource of manifestResources) {
  const raw = resource?.resource ?? resource?.url ?? null;
  if (typeof raw !== 'string') {
    failures.push('Floot manifest resource is missing a URL');
    continue;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.origin !== ORIGIN) {
      failures.push('Floot manifest contains non-Floot resource ' + raw);
    }
    manifestPaths.add(parsed.pathname);
  } catch {
    failures.push('Floot manifest contains invalid resource URL ' + raw);
  }
}
for (const path of requiredPaths) {
  if (!manifestPaths.has(path)) {
    failures.push('Floot manifest missing ' + path);
  }
}

if (failures.length) {
  throw new Error(
    'Refusing Agent402 registration: public Floot manifest precondition failed: ' +
      failures.join('; ')
  );
}

const registration = await jsonFetch(REGISTER, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ origin: ORIGIN }),
});
observations.registration = {
  status: registration.response.status,
  listed: registration.body?.listed ?? null,
  displayName: registration.body?.displayName ?? null,
  toolCount: registration.body?.toolCount ?? null,
  networks: registration.body?.networks ?? null,
  routable: registration.body?.routable ?? null,
  health: registration.body?.health ?? null,
  documentsReread:
    registration.body?.reverify?.documentsReread ??
    registration.body?.documentsReread ??
    null,
  routesRechecked:
    registration.body?.reverify?.routesRechecked ??
    registration.body?.routesRechecked ??
    null,
  routesProbed:
    registration.body?.reverify?.routesProbed ??
    registration.body?.routesProbed ??
    null,
};

if (!registration.response.ok) {
  failures.push('Agent402 registration HTTP ' + registration.response.status);
}

const readback = await jsonFetch(READBACK);
const tools = Array.isArray(readback.body?.tools) ? readback.body.tools : [];
const toolText = (tool) => JSON.stringify(tool).toLowerCase();
const vendorTools = tools.filter((tool) => {
  const text = toolText(tool);
  return (
    text.includes('vendor-intake-gate') ||
    text.includes('vendor intake') ||
    text.includes('vendor-intake')
  );
});
const paths = new Set(
  tools
    .map((tool) => {
      const raw =
        tool?.route ??
        tool?.resource ??
        tool?.url ??
        tool?.endpoint ??
        tool?.resourceUrl ??
        null;
      if (typeof raw !== 'string') return null;
      try {
        return new URL(raw).pathname;
      } catch {
        return raw;
      }
    })
    .filter(Boolean)
);

observations.readback = {
  status: readback.response.status,
  origin: readback.body?.origin ?? null,
  displayName: readback.body?.displayName ?? null,
  toolCount: readback.body?.toolCount ?? null,
  paidToolCount: readback.body?.paidToolCount ?? null,
  health: readback.body?.health ?? null,
  routable: readback.body?.routable ?? null,
  routerDispatchEligible: readback.body?.routerDispatchEligible ?? null,
  routerDispatchReason: readback.body?.routerDispatchReason ?? null,
  toolsReturned: tools.length,
  vendorGateMatches: vendorTools.length,
  paths: [...paths].sort(),
};

if (readback.response.status !== 200) {
  failures.push('Agent402 readback HTTP ' + readback.response.status);
}
if (readback.body?.health !== 1) {
  failures.push('Agent402 health=' + String(readback.body?.health) + ' expected=1');
}
if (readback.body?.routable !== true) {
  failures.push(
    'Agent402 routable=' + String(readback.body?.routable) + ' expected=true'
  );
}
if ((readback.body?.toolCount ?? tools.length) < 8) {
  failures.push(
    'Agent402 toolCount=' +
      String(readback.body?.toolCount ?? tools.length) +
      ' expected>=8'
  );
}
if (vendorTools.length < 1) {
  failures.push('Agent402 vendor-intake gate not visible');
}

for (const path of requiredPaths) {
  if (!paths.has(path)) {
    failures.push('Agent402 readback missing ' + path);
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  zeroSpend: true,
  paymentSent: false,
  origin: ORIGIN,
  ok: failures.length === 0,
  failures,
  observations,
  note:
    'routerDispatchEligible may remain false with settlement_required until genuine third-party settlement history exists; this check does not self-fund settlement.',
};

const reportJson = JSON.stringify(report, null, 2);
console.log(reportJson);

const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) {
  await writeFile(reportPath, reportJson + '\n', 'utf8');
}

if (!report.ok) process.exitCode = 1;
