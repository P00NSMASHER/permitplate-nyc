#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const receiptPath =
  process.env.ROLLBACK_RECEIPT?.trim() ||
  process.argv[2];

if (!receiptPath) {
  throw new Error(
    'Provide rollback plan path as argv[2] or ROLLBACK_RECEIPT'
  );
}

const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);
const plan = JSON.parse(await readFile(receiptPath, 'utf8'));

assert.equal(plan.projectId, queue.projectId);
assert.equal(plan.productionOrigin, queue.productionOrigin);
assert.ok(
  Number.isInteger(plan.preWriteProjectVersion) &&
    plan.preWriteProjectVersion >= 0,
  'preWriteProjectVersion must be a non-negative integer'
);
assert.match(
  String(plan.generatedAt ?? ''),
  /^\d{4}-\d{2}-\d{2}T/,
  'generatedAt must be ISO-like'
);
assert.equal(
  plan.sourceBranch,
  queue.sourceBranch,
  'rollback plan sourceBranch must match immutable deployment lock'
);
assert.equal(
  plan.sourceCommit,
  queue.sourceCommit,
  'rollback plan sourceCommit must match immutable deployment lock'
);
assert.equal(
  plan.deploymentWriteCount,
  queue.writes.length,
  'rollback plan deploymentWriteCount mismatch'
);

assert.ok(Array.isArray(plan.rollbackActions), 'rollbackActions must be an array');
assert.equal(
  plan.rollbackActions.length,
  queue.writes.length,
  'rollbackActions must cover all deployment writes'
);

const expectedTargets = new Set(queue.writes.map((entry) => entry.target));
const seen = new Set();
let restoreWrites = 0;
let deletes = 0;

for (const entry of plan.rollbackActions) {
  assert.equal(typeof entry?.target, 'string', 'rollback target must be a string');
  assert.ok(expectedTargets.has(entry.target), 'unexpected rollback target ' + entry.target);
  assert.equal(seen.has(entry.target), false, 'duplicate rollback target ' + entry.target);
  seen.add(entry.target);

  if (entry.action === 'write_file') {
    restoreWrites += 1;
    assert.equal(
      entry.contentSource,
      'snapshot',
      entry.target + ': restore must use snapshot content'
    );
    assert.match(
      String(entry.sha256 ?? ''),
      /^[0-9a-f]{64}$/,
      entry.target + ': invalid restore SHA-256'
    );
    assert.ok(
      Number.isInteger(entry.byteLength) && entry.byteLength >= 0,
      entry.target + ': invalid restore byteLength'
    );
  } else if (entry.action === 'delete_file') {
    deletes += 1;
    assert.equal(
      typeof entry.reason,
      'string',
      entry.target + ': delete action requires a reason'
    );
  } else {
    assert.fail(entry.target + ': unsupported rollback action ' + String(entry.action));
  }
}

assert.equal(seen.size, expectedTargets.size);

assert.ok(
  Array.isArray(plan.preservedVerification),
  'preservedVerification must be an array'
);
assert.equal(
  plan.preservedVerification.length,
  queue.preserveTargets.length,
  'preservedVerification count mismatch'
);

const preservedTargets = new Set(queue.preserveTargets);
const preservedSeen = new Set();
for (const entry of plan.preservedVerification) {
  assert.ok(
    preservedTargets.has(entry.target),
    'unexpected preserved verification target ' + String(entry.target)
  );
  assert.equal(
    preservedSeen.has(entry.target),
    false,
    'duplicate preserved verification target ' + entry.target
  );
  preservedSeen.add(entry.target);
  assert.match(
    String(entry.sha256 ?? ''),
    /^[0-9a-f]{64}$/,
    entry.target + ': invalid preserved SHA-256'
  );
  assert.ok(
    Number.isInteger(entry.byteLength) && entry.byteLength >= 0,
    entry.target + ': invalid preserved byteLength'
  );
}

assert.equal(plan.summary?.restoreWrites, restoreWrites);
assert.equal(plan.summary?.deletes, deletes);
assert.equal(plan.summary?.preservedFiles, queue.preserveTargets.length);
assert.equal(
  plan.summary?.flootActionsBeforePublicVerification,
  restoreWrites + deletes + 4
);

console.log(
  JSON.stringify(
    {
      ok: true,
      projectId: plan.projectId,
      preWriteProjectVersion: plan.preWriteProjectVersion,
      deploymentTargets: expectedTargets.size,
      restoreWrites,
      deletes,
      preservedFiles: plan.preservedVerification.length,
      sourceBranch: plan.sourceBranch,
      sourceCommit: plan.sourceCommit,
    },
    null,
    2
  )
);
