#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const publicReport = {
  zeroSpend: true,
  paymentSent: false,
  summary: {
    services: { passed: 8, total: 8 },
    fixtures: { passed: 3, total: 3 },
  },
  discovery: [
    {
      id: 'floot-manifest',
      ok: true,
      status: 200,
      resourceCount: 8,
    },
  ],
};

const agentReport = {
  checkedAt: '2026-10-02T18:30:00.000Z',
  zeroSpend: true,
  paymentSent: false,
  ok: true,
  observations: {
    registration: {
      listed: true,
      documentsReread: true,
      routesRechecked: true,
      routesProbed: 8,
    },
    readback: {
      health: 1,
      routable: true,
      toolCount: 8,
      paidToolCount: 8,
      vendorGateMatches: 1,
      paths: requiredPaths,
    },
  },
};

const dir = await mkdtemp(path.join(os.tmpdir(), 'agentic-finalizer-test-'));
const publicPath = path.join(dir, 'public.json');
const agentPath = path.join(dir, 'agent.json');
const outputPath = path.join(dir, 'ready.md');

await writeFile(publicPath, JSON.stringify(publicReport), 'utf8');
await writeFile(agentPath, JSON.stringify(agentReport), 'utf8');

const scriptPath = fileURLToPath(
  new URL('./finalize-agentic-ai-vendor-gate-draft.mjs', import.meta.url)
);

const stdout = execFileSync(
  process.execPath,
  [scriptPath, publicPath, agentPath, outputPath],
  { encoding: 'utf8' }
);
const output = await readFile(outputPath, 'utf8');

assert.match(stdout, /SEND_ACTION=none/);
assert.match(stdout, /PAYMENT_SENT=false/);
assert.equal(output.includes('[pending]'), false);
assert.match(output, /evidence complete for human review — not yet sent/);
assert.match(output, /public paid routes verified without sending payment: \*\*8\/8\*\*/);
assert.match(output, /Agent402 health: \*\*1\*\*/);
assert.match(output, /Agent402 routable: \*\*true\*\*/);
assert.match(output, /Agent402 paid tools: \*\*8\*\*/);
assert.match(
  output,
  /https:\/\/pa-entity-x402\.floot\.app\/_api\/vendor-intake-gate/
);
assert.equal(
  output.includes(
    'GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME'
  ),
  false
);
assert.match(output, /not yet sent/);

console.log(
  'PASS Agentic.ai finalizer requires green public + Agent402 evidence and produces unsent Floot review copy'
);
