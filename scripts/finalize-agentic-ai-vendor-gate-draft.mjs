#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const publicReportPath = process.argv[2] ?? '';
const agentReportPath = process.argv[3] ?? '';
const outputPath =
  process.argv[4] ??
  'verification/agentic-ai-vendor-gate-resubmission-ready.md';

if (!publicReportPath || !agentReportPath) {
  throw new Error(
    'Usage: node scripts/finalize-agentic-ai-vendor-gate-draft.mjs <x402-verification-report.json> <agent402-report.json> [output.md]'
  );
}

const [publicReport, agentReport, draft] = await Promise.all([
  readFile(publicReportPath, 'utf8').then(JSON.parse),
  readFile(agentReportPath, 'utf8').then(JSON.parse),
  readFile(
    new URL('../docs/agentic-ai-vendor-gate-resubmission-draft.md', import.meta.url),
    'utf8'
  ),
]);

assert.equal(publicReport.zeroSpend, true, 'public verifier must be zero-spend');
assert.equal(publicReport.paymentSent, false, 'public verifier must not send payment');
assert.equal(publicReport.summary?.services?.passed, 8, 'public verifier must pass 8 services');
assert.equal(publicReport.summary?.services?.total, 8, 'public verifier service total must be 8');
assert.equal(publicReport.summary?.fixtures?.passed, 3, 'public verifier must pass 3 fixtures');
assert.equal(publicReport.summary?.fixtures?.total, 3, 'public verifier fixture total must be 3');

const flootDiscovery = (publicReport.discovery ?? []).find(
  (entry) => entry.id === 'floot-manifest'
);
assert(flootDiscovery, 'public verifier missing Floot discovery result');
assert.equal(flootDiscovery.ok, true, 'Floot discovery must be green');
assert.equal(flootDiscovery.status, 200, 'Floot manifest must return 200');
assert.equal(flootDiscovery.resourceCount, 8, 'Floot manifest must advertise 8 resources');

assert.equal(agentReport.zeroSpend, true, 'Agent402 verifier must be zero-spend');
assert.equal(agentReport.paymentSent, false, 'Agent402 verifier must not send payment');
assert.equal(agentReport.ok, true, 'Agent402 acceptance report is not green');

const registration = agentReport.observations?.registration ?? {};
const readback = agentReport.observations?.readback ?? {};
assert.equal(readback.health, 1, 'Agent402 health must be 1');
assert.equal(readback.routable, true, 'Agent402 must be routable');
assert.ok(Number(readback.paidToolCount ?? 0) >= 8, 'Agent402 must expose at least 8 paid tools');
assert.ok(Number(readback.vendorGateMatches ?? 0) >= 1, 'Agent402 must expose vendor gate');

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
const agentPaths = new Set(readback.paths ?? []);
for (const path of requiredPaths) {
  assert(agentPaths.has(path), 'Agent402 missing ' + path);
}

const evidenceSection =
`## Floot recovery evidence — ${agentReport.checkedAt ?? new Date().toISOString()}

The AppDeploy hosting incident prompted a direct rehost onto the existing Floot seller. The rehost is now independently verified for this review copy:

- Floot origin: \`https://pa-entity-x402.floot.app\`
- public paid routes verified without sending payment: **8/8**
- fixed reviewer fixtures: **3/3**
- canonical x402 manifest resources: **8**
- Agent402 health: **${readback.health}**
- Agent402 routable: **${readback.routable}**
- Agent402 paid tools: **${readback.paidToolCount}**
- vendor-intake gate visible in Agent402: **true**
- AppDeploy runtime dependency in the Floot recovery release: **0**

The prior AppDeploy incident remains historical context only; the listing target below is the same-origin Floot endpoint.
`;

const incidentStart = draft.indexOf('## Current availability incident — 2026-10-02');
const proposedStart = draft.indexOf('## Proposed listing name');
assert(incidentStart >= 0 && proposedStart > incidentStart, 'draft incident/proposed sections not found');

let output =
  draft.slice(0, incidentStart) +
  evidenceSection +
  '\n' +
  draft.slice(proposedStart);

output = output.replace(
  '_Status: draft only — do not send until Floot bare-origin consolidation and Agent402 re-indexing are complete._',
  '_Status: evidence complete for human review — not yet sent._'
);

const listed =
  registration.listed === true
    ? 'true'
    : 'not separately reported by the current registration response; seller readback succeeded';
const reread = [
  'documentsReread=' + String(registration.documentsReread ?? 'not reported'),
  'routesRechecked=' + String(registration.routesRechecked ?? 'not reported'),
  'routesProbed=' + String(registration.routesProbed ?? 'not reported'),
].join('; ');

output = output
  .replace('- Agent402 listed: **[pending]**', '- Agent402 listed: **' + listed + '**')
  .replace('- Agent402 routable: **[pending]**', '- Agent402 routable: **true**')
  .replace('- Agent402 health: **[pending]**', '- Agent402 health: **1**')
  .replace(
    '- vendor-intake gate visible in Agent402: **[pending]**',
    '- vendor-intake gate visible in Agent402: **true**'
  )
  .replace(
    '- routes/documents rechecked: **[pending]**',
    '- routes/documents rechecked: **' + reread + '**'
  )
  .replace(
    'At draft time, and until the Floot rehost is publicly verified:',
    'At evidence-finalization time:'
  );

assert.equal(output.includes('[pending]'), false, 'ready copy still contains pending evidence');
assert.equal(
  output.includes('GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME'),
  false,
  'ready copy advertises dead AppDeploy gate'
);
assert.ok(
  output.includes('https://pa-entity-x402.floot.app/_api/vendor-intake-gate'),
  'ready copy missing Floot gate'
);
assert.ok(
  output.includes('not yet sent'),
  'ready copy must remain explicitly unsent'
);

await writeFile(outputPath, output, 'utf8');
console.log('READY_COPY=' + outputPath);
console.log('SEND_ACTION=none');
console.log('PAYMENT_SENT=false');
