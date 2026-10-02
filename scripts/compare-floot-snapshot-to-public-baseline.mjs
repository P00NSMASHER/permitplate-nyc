#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const snapshotPath =
  process.argv[2] ?? process.env.FLOOT_SNAPSHOT_PATH ?? '';
if (!snapshotPath) {
  throw new Error(
    'Usage: node scripts/compare-floot-snapshot-to-public-baseline.mjs <snapshot.json>'
  );
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const publicBaseline = JSON.parse(
  await readFile(
    new URL(
      '../verification/floot-static-rollback-public-latest.json',
      import.meta.url
    ),
    'utf8'
  )
);

assert.equal(
  snapshot.projectId,
  publicBaseline.projectId,
  'snapshot/public baseline project id mismatch'
);
assert.equal(
  snapshot.productionOrigin,
  publicBaseline.productionOrigin,
  'snapshot/public baseline origin mismatch'
);
assert.equal(
  publicBaseline.canonicalManifestResourceCount,
  2,
  'public baseline must represent the two-resource pre-rehost state'
);

const publicByTarget = new Map(
  (publicBaseline.files ?? []).map((entry) => [entry.target, entry])
);
const snapshotByPath = new Map(
  (snapshot.files ?? []).map((entry) => [entry.path, entry])
);

const staticPaths = [
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

const matches = [];
const mismatches = [];
const missingPublic = [];
const missingSnapshot = [];

for (const path of staticPaths) {
  const live = snapshotByPath.get(path);
  const pub = publicByTarget.get(path);

  if (!live?.exists) {
    missingSnapshot.push(path);
    continue;
  }
  if (!pub) {
    missingPublic.push(path);
    continue;
  }

  const liveDigest = crypto
    .createHash('sha256')
    .update(Buffer.from(live.content, 'utf8'))
    .digest('hex');
  assert.equal(liveDigest, live.sha256, path + ': snapshot hash is internally invalid');

  if (liveDigest === pub.sha256) {
    matches.push(path);
  } else {
    mismatches.push({
      path,
      flootSourceSha256: liveDigest,
      publicResponseSha256: pub.sha256,
      note:
        'Use freshly captured Floot source as rollback authority; public bytes are only a cross-check.',
    });
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  snapshotPath,
  publicBaselineCapturedAt: publicBaseline.capturedAt ?? null,
  matches,
  mismatches,
  missingPublic,
  missingSnapshot,
  authoritativeRollbackSource: 'fresh Floot read_files snapshot',
};

console.log(JSON.stringify(report, null, 2));

if (missingSnapshot.length > 0 || missingPublic.length > 0) {
  process.exitCode = 1;
}
