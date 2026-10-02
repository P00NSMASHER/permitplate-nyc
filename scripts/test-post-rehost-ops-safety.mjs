#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) =>
  readFile(new URL('../' + path, import.meta.url), 'utf8');

const agent = await read('scripts/verify-agent402-after-floot-rehost.mjs');
const market = await read('scripts/repair-marketplaces-after-floot-rehost.mjs');
const agentWorkflow = await read(
  '.github/workflows/verify-agent402-after-floot-rehost.yml'
);
const marketWorkflow = await read(
  '.github/workflows/repair-marketplaces-after-floot-rehost.yml'
);
const distributionWorkflow = await read(
  '.github/workflows/post-floot-x402-distribution.yml'
);
const draft = await read('docs/agentic-ai-vendor-gate-resubmission-draft.md');

for (const [name, text] of [
  ['Agent402 workflow', agentWorkflow],
  ['marketplace workflow', marketWorkflow],
]) {
  assert.match(text, /workflow_dispatch:/, name + ' must be manual-only capable');
  assert.equal(/\bschedule\s*:/.test(text), false, name + ' must not be scheduled');
  assert.equal(
    /\bpush\s*:/.test(text),
    false,
    name + ' must not run automatically on push'
  );
}

assert.ok(
  agent.includes("const ORIGIN = 'https://pa-entity-x402.floot.app'"),
  'Agent402 verifier must target Floot'
);
assert.ok(
  agent.includes("resourceCount !== 8"),
  'Agent402 verifier must require 8-resource Floot manifest'
);
assert.ok(
  agent.includes("'/_api/vendor-intake-gate'"),
  'Agent402 verifier must require vendor gate'
);
assert.ok(
  agent.includes('paymentSent: false'),
  'Agent402 verifier must explicitly record zero payment'
);
assert.equal(
  /payment-signature|x-payment/i.test(agent),
  false,
  'Agent402 verifier must not send payment headers'
);

const changedIds = [
  'vendor-intake-gate',
  'sec-recent-filings',
  'census-geocoder',
  'ofac-sdn-screen',
  'domain-rdap',
  'treasury-average-rates',
];
for (const id of changedIds) {
  assert.ok(market.includes("'" + id + "'"), 'market repair missing ' + id);
}
for (const id of ['pa-best-match', 'pa-enriched-search']) {
  assert.ok(
    market.includes("'" + id + "'"),
    'market repair must explicitly preserve unchanged route ' + id
  );
}
assert.ok(
  market.includes('changedServiceIds'),
  'market repair must scope mutations to changed routes'
);
assert.ok(
  market.includes("resources.length !== 8"),
  'market repair must refuse non-8-route Floot state'
);
assert.ok(
  market.includes(
    "'https://agent402.tools/api/index?seller=pa-entity-x402.floot.app'"
  ),
  'market repair must independently read Agent402 acceptance state'
);
assert.ok(
  market.includes('paidToolCount ?? 0) >= 8'),
  'market repair must require at least 8 Agent402 paid tools'
);
assert.ok(
  market.includes("agentBlob.includes('vendor-intake-gate')"),
  'market repair must require Agent402 vendor-gate visibility'
);
assert.ok(
  market.includes('Refusing marketplace repair: Agent402 has not yet accepted'),
  'market repair must fail closed before directory mutation when Agent402 is not accepted'
);
assert.ok(
  market.includes("'https://market402.com/submit'"),
  'Market402 submit endpoint missing'
);
assert.ok(
  market.includes("'https://402index.io/api/v1/register'"),
  '402 Index registration endpoint missing'
);
assert.ok(
  market.includes("mode: 'read_only'"),
  'NoHumans must remain read-only'
);
assert.equal(
  /nohumans[^\n]{0,200}(method:\s*'POST'|method:\s*"POST")/i.test(market),
  false,
  'NoHumans POST mutation is forbidden under zero-spend rule'
);
assert.equal(
  /payment-signature|x-payment/i.test(market),
  false,
  'marketplace repair must not send payment headers'
);

const agentStep = distributionWorkflow.indexOf(
  '- name: Re-register and verify Agent402'
);
const marketStep = distributionWorkflow.indexOf(
  '- name: Repair zero-spend marketplace listings'
);
assert.ok(agentStep >= 0, 'combined distribution workflow missing Agent402 step');
assert.ok(marketStep >= 0, 'combined distribution workflow missing marketplace step');
assert.ok(
  agentStep < marketStep,
  'combined distribution workflow must verify Agent402 before marketplace repair'
);

assert.ok(
  draft.includes(
    '_Status: draft only — do not send until Floot bare-origin consolidation and Agent402 re-indexing are complete._'
  ),
  'Agentic.ai draft lost the do-not-send gate'
);
assert.ok(
  draft.includes(
    'https://pa-entity-x402.floot.app/_api/vendor-intake-gate'
  ),
  'Agentic.ai draft must target Floot gate'
);
assert.equal(
  draft.includes(
    'GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME'
  ),
  false,
  'Agentic.ai draft must not advertise dead AppDeploy gate as paid endpoint'
);

console.log('PASS post-rehost workflows are manual-only');
console.log('PASS Agent402 acceptance is zero-spend and requires 8-route Floot state');
console.log('PASS marketplace mutation is gated on Agent402 acceptance');
console.log('PASS combined distribution orders Agent402 before marketplace repair');
console.log('PASS marketplace mutation scope is six changed routes');
console.log('PASS NoHumans remains read-only');
console.log('PASS Agentic.ai draft remains gated and targets Floot');
