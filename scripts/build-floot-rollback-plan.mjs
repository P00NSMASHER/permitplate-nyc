#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const snapshotPath =
  process.argv[2] ?? process.env.FLOOT_SNAPSHOT_PATH ?? '';
const outputPath =
  process.argv[3] ?? process.env.FLOOT_ROLLBACK_PLAN_PATH ?? '';

if (!snapshotPath) {
  throw new Error(
    'Usage: node scripts/build-floot-rollback-plan.mjs <snapshot.json> [output.json]'
  );
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);

if (snapshot.projectId !== queue.projectId) {
  throw new Error('snapshot project id does not match deployment queue');
}
if (snapshot.productionOrigin !== queue.productionOrigin) {
  throw new Error('snapshot production origin does not match deployment queue');
}
if (!Number.isInteger(snapshot.projectVersion) || snapshot.projectVersion < 0) {
  throw new Error('snapshot projectVersion is invalid');
}

const byPath = new Map(
  (snapshot.files ?? []).map((entry) => [entry.path, entry])
);
const preexistingTargets = new Set(
  snapshot.preexistingRecoveryTargets ?? []
);
const absentTargets = new Set(snapshot.absentRecoveryTargets ?? []);
const preserveTargets = new Set(queue.preserveTargets ?? []);

const rollbackActions = [];

for (const write of queue.writes) {
  const target = write.target;
  const preexisting = preexistingTargets.has(target);
  const absent = absentTargets.has(target);

  if (Number(preexisting) + Number(absent) !== 1) {
    throw new Error(
      target + ': must be classified exactly once as preexisting or absent'
    );
  }

  const snapshotEntry = byPath.get(target);

  if (preexisting) {
    if (
      !snapshotEntry ||
      snapshotEntry.exists !== true ||
      typeof snapshotEntry.content !== 'string' ||
      !/^[0-9a-f]{64}$/.test(String(snapshotEntry.sha256 ?? ''))
    ) {
      throw new Error(
        'Preexisting target ' +
          target +
          ' has no complete captured content; snapshot is unsafe for rollback'
      );
    }

    rollbackActions.push({
      action: 'write_file',
      target,
      contentSource: 'snapshot',
      sha256: snapshotEntry.sha256,
      byteLength: snapshotEntry.byteLength,
    });
    continue;
  }

  rollbackActions.push({
    action: 'delete_file',
    target,
    reason: 'target was absent before recovery',
  });
}

const preservedVerification = [...preserveTargets].map((target) => {
  const entry = byPath.get(target);
  if (
    !entry ||
    entry.exists !== true ||
    typeof entry.content !== 'string' ||
    !/^[0-9a-f]{64}$/.test(String(entry.sha256 ?? ''))
  ) {
    throw new Error(
      'Preserved PA target is missing from snapshot: ' + target
    );
  }
  return {
    target,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
  };
});

const restoreWrites = rollbackActions.filter(
  (item) => item.action === 'write_file'
).length;
const deletes = rollbackActions.filter(
  (item) => item.action === 'delete_file'
).length;

const report = {
  generatedAt: new Date().toISOString(),
  projectId: snapshot.projectId,
  productionOrigin: snapshot.productionOrigin,
  preWriteProjectVersion: snapshot.projectVersion,
  sourceBranch: queue.sourceBranch ?? null,
  sourceCommit: queue.sourceCommit ?? null,
  deploymentWriteCount: queue.writes.length,
  rollbackActions,
  preservedVerification,
  summary: {
    restoreWrites,
    deletes,
    preservedFiles: preservedVerification.length,
    flootActionsBeforePublicVerification:
      restoreWrites + deletes + 4,
  },
  rules: [
    'Serialize every Floot delete/write and carry current expected_version forward.',
    'Do not rewrite the four preserved PA files unless an independent verification proves they were unexpectedly mutated.',
    'Run typecheck and tests before publishing the rollback.',
    'After rollback publish, require the two-route public baseline preflight to pass before resuming recovery.',
  ],
};

const json = JSON.stringify(report, null, 2) + '\n';

if (outputPath) {
  await writeFile(outputPath, json, 'utf8');
  console.log('rollbackPlan=' + outputPath);
} else {
  process.stdout.write(json);
}
