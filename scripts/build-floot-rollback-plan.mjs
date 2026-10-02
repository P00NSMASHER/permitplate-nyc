#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const snapshotPath =
  process.argv[2] ?? process.env.FLOOT_SNAPSHOT_PATH ?? '';
if (!snapshotPath) {
  throw new Error(
    'Usage: node scripts/build-floot-rollback-plan.mjs <snapshot.json>'
  );
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const deployMap = JSON.parse(
  await readFile(
    new URL('../docs/pa-entity-floot-recovery/deploy-map.json', import.meta.url),
    'utf8'
  )
);

const byPath = new Map((snapshot.files ?? []).map((entry) => [entry.path, entry]));
const preexistingTargets = new Set(snapshot.preexistingRecoveryTargets ?? []);
const absentTargets = new Set(snapshot.absentRecoveryTargets ?? []);

const rollback = [];
for (const write of deployMap.writes) {
  const target = write.target;
  const snapshotEntry = byPath.get(target);

  if (snapshotEntry?.exists === true) {
    rollback.push({
      action: 'write_file',
      target,
      contentSource: 'snapshot',
      sha256: snapshotEntry.sha256,
      byteLength: snapshotEntry.byteLength,
    });
    continue;
  }

  if (absentTargets.has(target)) {
    rollback.push({
      action: 'delete_file',
      target,
      reason: 'target was absent before recovery',
    });
    continue;
  }

  if (preexistingTargets.has(target)) {
    throw new Error(
      'Preexisting target ' +
        target +
        ' has no captured content; snapshot is unsafe for rollback'
    );
  }

  throw new Error(
    'Target ' +
      target +
      ' is neither captured as existing nor declared absent; snapshot is incomplete'
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  projectId: snapshot.projectId,
  preWriteProjectVersion: snapshot.projectVersion,
  deploymentWriteCount: deployMap.writes.length,
  rollbackActions: rollback,
  summary: {
    restoreWrites: rollback.filter((item) => item.action === 'write_file').length,
    deletes: rollback.filter((item) => item.action === 'delete_file').length,
  },
};

console.log(JSON.stringify(report, null, 2));
