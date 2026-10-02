#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'floot-rollback-plan-test-'));
const snapshotPath = join(root, 'snapshot.json');
const planPath = join(root, 'plan.json');

const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);

const preexistingTargets = new Set([
  ...queue.preserveTargets,
  ...queue.writes.slice(14).map((entry) => entry.target),
]);
const absentRecoveryTargets = queue.writes
  .map((entry) => entry.target)
  .filter((target) => !preexistingTargets.has(target));

const files = [...preexistingTargets].map((path) => {
  const content = 'baseline:' + path + '\n';
  const bytes = Buffer.from(content, 'utf8');
  return {
    path,
    exists: true,
    content,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

const snapshot = {
  projectId: queue.projectId,
  projectVersion: 456,
  productionOrigin: queue.productionOrigin,
  capturedAt: '2026-10-02T12:00:00.000Z',
  files,
  preexistingRecoveryTargets: [...preexistingTargets].filter((path) =>
    queue.writes.some((entry) => entry.target === path)
  ),
  absentRecoveryTargets,
};

await writeFile(snapshotPath, JSON.stringify(snapshot), 'utf8');

const result = spawnSync(
  process.execPath,
  [
    new URL('./build-floot-rollback-plan.mjs', import.meta.url).pathname,
    snapshotPath,
    planPath,
  ],
  { encoding: 'utf8' }
);
assert.equal(result.status, 0, result.stderr || result.stdout);

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const expectedRestoreCount = snapshot.preexistingRecoveryTargets.length;
const expectedDeleteCount = snapshot.absentRecoveryTargets.length;

assert.equal(plan.projectId, queue.projectId);
assert.equal(plan.productionOrigin, queue.productionOrigin);
assert.equal(plan.preWriteProjectVersion, 456);
assert.equal(plan.sourceBranch, queue.sourceBranch);
assert.equal(plan.sourceCommit, queue.sourceCommit);
assert.equal(plan.rollbackActions.length, queue.writes.length);
assert.equal(plan.summary.restoreWrites, expectedRestoreCount);
assert.equal(plan.summary.deletes, expectedDeleteCount);
assert.equal(plan.preservedVerification.length, queue.preserveTargets.length);

for (const preserved of queue.preserveTargets) {
  assert.equal(
    plan.rollbackActions.some((entry) => entry.target === preserved),
    false,
    'preserved PA file must not appear in rollback mutations'
  );
  assert.ok(
    plan.preservedVerification.some((entry) => entry.target === preserved),
    'preserved PA file must remain in verification set'
  );
}

assert.equal(
  plan.summary.flootActionsBeforePublicVerification,
  expectedRestoreCount + expectedDeleteCount + 4
);

console.log('PASS rollback plan generator: restore/delete/preserve classification');
