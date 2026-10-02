#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const receiptPath =
  process.env.ROLLBACK_RECEIPT?.trim() ||
  process.argv[2];

if (!receiptPath) {
  throw new Error(
    'Provide rollback receipt path as argv[2] or ROLLBACK_RECEIPT'
  );
}

const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));

assert.equal(receipt.projectId, queue.projectId);
assert.equal(receipt.productionOrigin, queue.productionOrigin);
assert.ok(
  Number.isInteger(receipt.preWriteProjectVersion) && receipt.preWriteProjectVersion >= 0,
  'preWriteProjectVersion must be a non-negative integer'
);
assert.match(
  String(receipt.capturedAt ?? ''),
  /^\d{4}-\d{2}-\d{2}T/,
  'capturedAt must be ISO-like'
);

const expectedTargets = new Set(queue.writes.map((entry) => entry.target));
const existing = Array.isArray(receipt.existingTargets)
  ? receipt.existingTargets
  : [];
const absent = Array.isArray(receipt.absentTargets)
  ? receipt.absentTargets
  : [];

const seen = new Set();

for (const entry of existing) {
  assert.equal(typeof entry.path, 'string');
  assert(expectedTargets.has(entry.path), 'unexpected existing target ' + entry.path);
  assert.equal(seen.has(entry.path), false, 'duplicate target ' + entry.path);
  seen.add(entry.path);

  assert.equal(typeof entry.content, 'string', 'content must be UTF-8 text');
  assert.match(
    String(entry.sha256 ?? ''),
    /^[0-9a-f]{64}$/,
    'invalid SHA-256 for ' + entry.path
  );
  const actual = createHash('sha256').update(entry.content, 'utf8').digest('hex');
  assert.equal(actual, entry.sha256, 'content SHA-256 mismatch for ' + entry.path);
}

for (const path of absent) {
  assert.equal(typeof path, 'string');
  assert(expectedTargets.has(path), 'unexpected absent target ' + path);
  assert.equal(seen.has(path), false, 'target classified twice ' + path);
  seen.add(path);
}

assert.equal(
  seen.size,
  expectedTargets.size,
  'rollback receipt must classify every deployment target'
);

const missing = [...expectedTargets].filter((path) => !seen.has(path));
assert.deepEqual(missing, []);

console.log(
  JSON.stringify(
    {
      ok: true,
      projectId: receipt.projectId,
      preWriteProjectVersion: receipt.preWriteProjectVersion,
      deploymentTargets: expectedTargets.size,
      capturedExistingTargets: existing.length,
      absentTargets: absent.length,
    },
    null,
    2
  )
);
