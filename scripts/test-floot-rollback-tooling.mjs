#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const deployMap = JSON.parse(
  await readFile(
    new URL('../docs/pa-entity-floot-recovery/deploy-map.json', import.meta.url),
    'utf8'
  )
);

const mandatory = [
  'endpoints/pa-business_GET.ts',
  'endpoints/pa-business_GET.schema.ts',
  'endpoints/pa-entity-one_GET.ts',
  'endpoints/pa-entity-one_GET.schema.ts',
  'static/openapi.json',
  'static/llms.txt',
  'static/llms-full.txt',
  'static/skill.txt',
  'static/.well-known/x402',
  'static/.well-known/x402.json',
  'static/.well-known/x402-services.json',
  'static/.well-known/x402-service.json',
  'static/.well-known/x402-catalog.json',
  'static/.well-known/security.txt',
  'static/sitemap.xml',
  'static/robots.txt',
];

const staticTargets = deployMap.writes
  .map((entry) => entry.target)
  .filter((target) => target.startsWith('static/'));
const endpointTargets = deployMap.writes
  .map((entry) => entry.target)
  .filter((target) => target.startsWith('endpoints/'));

assert.equal(staticTargets.length, 12);
assert.equal(endpointTargets.length, 14);

const files = mandatory.map((filePath) => {
  const content = 'fixture:' + filePath + '\n';
  const bytes = Buffer.from(content, 'utf8');
  return {
    path: filePath,
    exists: true,
    content,
    byteLength: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
});

const snapshot = {
  projectId: deployMap.projectId,
  productionOrigin: deployMap.productionOrigin,
  projectVersion: 12345,
  capturedAt: '2026-10-02T15:00:00.000Z',
  preexistingRecoveryTargets: staticTargets,
  absentRecoveryTargets: endpointTargets,
  files,
};

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'floot-rollback-test-'));
const snapshotPath = path.join(tempDir, 'snapshot.json');
await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

const validatorPath = new URL(
  './validate-floot-pre-rehost-snapshot.mjs',
  import.meta.url
);
const builderPath = new URL('./build-floot-rollback-plan.mjs', import.meta.url);

const validationOutput = execFileSync(
  process.execPath,
  [validatorPath.pathname, snapshotPath],
  { encoding: 'utf8' }
);
assert.match(validationOutput, /PASS Floot pre-rehost snapshot/);

const planOutput = execFileSync(
  process.execPath,
  [builderPath.pathname, snapshotPath],
  { encoding: 'utf8' }
);
const plan = JSON.parse(planOutput);

assert.equal(plan.deploymentWriteCount, 26);
assert.equal(plan.summary.restoreWrites, 12);
assert.equal(plan.summary.deletes, 14);
assert.equal(plan.rollbackActions.length, 26);

const actions = new Map(
  plan.rollbackActions.map((entry) => [entry.target, entry.action])
);
for (const target of staticTargets) {
  assert.equal(actions.get(target), 'write_file', target + ' must restore');
}
for (const target of endpointTargets) {
  assert.equal(actions.get(target), 'delete_file', target + ' must delete');
}

console.log('PASS Floot rollback tooling: 12 restores + 14 deletes from expected baseline');
