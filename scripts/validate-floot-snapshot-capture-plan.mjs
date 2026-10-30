#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const plan = JSON.parse(
  await readFile(
    new URL('../recovery/floot-snapshot-capture-plan.json', import.meta.url),
    'utf8'
  )
);
const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);
const publicBaseline = JSON.parse(
  await readFile(
    new URL('../verification/floot-static-rollback-public-latest.json', import.meta.url),
    'utf8'
  )
);

assert.equal(plan.projectId, queue.projectId);
assert.equal(plan.productionOrigin, queue.productionOrigin);
assert.equal(plan.normalBatches.length, 5);

const paths = plan.normalBatches.flatMap((batch) => batch.paths);
assert.equal(paths.length, 16);
assert.equal(new Set(paths).size, 16);

const expectedBaseline = new Set([
  ...queue.preserveTargets,
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
]);

assert.equal(expectedBaseline.size, 16);
assert.deepEqual(new Set(paths), expectedBaseline);

for (const batch of plan.normalBatches) {
  assert.ok(batch.id);
  assert.ok(Array.isArray(batch.paths) && batch.paths.length >= 1);
  assert.ok(batch.paths.length <= 4, batch.id + ' batch unexpectedly large');
}

const recoveryEndpointTargets = queue.writes
  .map((entry) => entry.target)
  .filter((target) => target.startsWith('endpoints/'));

assert.equal(recoveryEndpointTargets.length, 14);
for (const target of recoveryEndpointTargets) {
  assert.equal(
    expectedBaseline.has(target),
    false,
    target + ' must be classified dynamically, not assumed in baseline'
  );
}

const plannedStatic = paths.filter((path) => path.startsWith('static/')).sort();
const baselineStatic = (publicBaseline.files ?? [])
  .map((entry) => entry.target)
  .sort();
assert.equal(publicBaseline.projectId, queue.projectId);
assert.equal(publicBaseline.productionOrigin, queue.productionOrigin);
assert.equal(
  publicBaseline.canonicalManifestResourceCount,
  2,
  'public rollback receipt must represent the two-resource pre-rehost state'
);
assert.equal(baselineStatic.length, 12);
assert.deepEqual(
  plannedStatic,
  baselineStatic,
  'snapshot static paths must exactly match the public rollback baseline'
);

assert.equal(plan.actionBudget.normalReadBatches, 5);
assert.equal(plan.actionBudget.conservativeMaximumAdditionalBatches, 14);
assert.equal(plan.actionBudget.absoluteMaximumReadBatches, 19);

console.log('PASS Floot snapshot capture plan: 5 bounded batches / 16 mandatory files');
console.log('PASS 12 static snapshot paths exactly match the public two-route rollback baseline');
console.log('PASS 14 recovery endpoint targets remain dynamically classified');
console.log('PASS absolute snapshot read bound = 19 actions');
