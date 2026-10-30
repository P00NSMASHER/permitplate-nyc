#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const progress = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-progress-latest.json', import.meta.url),
    'utf8'
  )
);
const deployMap = JSON.parse(
  await readFile(
    new URL('../docs/pa-entity-floot-recovery/deploy-map.json', import.meta.url),
    'utf8'
  )
);

assert.equal(progress.projectId, deployMap.projectId);
assert.equal(progress.productionOrigin, deployMap.productionOrigin);
assert.equal(progress.writes.length, deployMap.writes.length);
assert.equal(progress.writes.length, 26);

let lastVersion = progress.preWriteSnapshot?.projectVersion ?? null;
let sawPending = false;
let completed = 0;

for (let i = 0; i < deployMap.writes.length; i += 1) {
  const expected = deployMap.writes[i];
  const actual = progress.writes[i];

  assert.equal(actual.order, i + 1);
  assert.equal(actual.source, expected.source);
  assert.equal(actual.target, expected.target);
  assert.equal(actual.expectedBlobSha, expected.gitBlobSha);
  assert.equal(actual.expectedSize, expected.size);

  if (actual.status === 'completed') {
    assert.equal(
      sawPending,
      false,
      'completed write appears after a pending write at order ' + actual.order
    );
    assert.ok(
      Number.isFinite(actual.flootVersionAfter),
      'completed write missing Floot version at order ' + actual.order
    );
    if (lastVersion != null) {
      assert.ok(
        actual.flootVersionAfter > lastVersion,
        'Floot versions must strictly increase at order ' + actual.order
      );
    }
    lastVersion = actual.flootVersionAfter;
    completed += 1;
  } else {
    sawPending = true;
    assert.equal(actual.status, 'pending');
    assert.equal(actual.flootVersionAfter, null);
  }
}

assert.equal(progress.lastCompletedWriteOrder, completed);
assert.equal(progress.currentFlootVersion, lastVersion);
assert.equal(progress.writes[completed]?.order ?? 27, completed + 1);

if (progress.status === 'paused_quota_exhausted') {
  assert.ok(progress.quotaPause);
  assert.equal(progress.quotaPause.used, progress.quotaPause.dailyLimit);
  assert.ok(Date.parse(progress.quotaPause.resetAt) > Date.parse(progress.quotaPause.observedAt));
}

assert.equal(progress.preWriteSnapshot?.status, 'passed');
assert.equal(progress.rollbackPlan?.status, 'passed');
assert.equal(progress.validation?.rollbackSnapshot, 'passed');
assert.equal(progress.validation?.deploymentLock, 'passed');

if (completed < 26) {
  assert.equal(progress.validation?.publish, 'pending');
  assert.equal(progress.validation?.typecheck, 'pending');
  assert.equal(progress.validation?.tests, 'pending');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      status: progress.status,
      completedWrites: completed,
      pendingWrites: 26 - completed,
      lastCompletedWriteOrder: progress.lastCompletedWriteOrder,
      currentFlootVersion: progress.currentFlootVersion,
      nextWriteOrder: completed < 26 ? completed + 1 : null,
      snapshotProjectVersion: progress.preWriteSnapshot.projectVersion,
      rollbackSnapshot: progress.validation.rollbackSnapshot,
      rollbackPlan: progress.rollbackPlan.status,
    },
    null,
    2
  )
);
