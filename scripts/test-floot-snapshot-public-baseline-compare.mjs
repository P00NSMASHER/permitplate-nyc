#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = JSON.parse(
  await readFile(
    new URL('../verification/floot-static-rollback-public-latest.json', import.meta.url),
    'utf8'
  )
);
const root = await mkdtemp(join(tmpdir(), 'floot-public-compare-test-'));
const snapshotPath = join(root, 'snapshot.json');
const comparator = fileURLToPath(
  new URL('./compare-floot-snapshot-to-public-baseline.mjs', import.meta.url)
);

function snapshotFromBaseline() {
  return {
    projectId: baseline.projectId,
    productionOrigin: baseline.productionOrigin,
    files: baseline.files.map((entry) => ({
      path: entry.target,
      exists: true,
      content: entry.content,
      byteLength: Buffer.byteLength(entry.content, 'utf8'),
      sha256: createHash('sha256').update(entry.content, 'utf8').digest('hex'),
    })),
  };
}

function run(snapshot) {
  return writeFile(snapshotPath, JSON.stringify(snapshot), 'utf8').then(() =>
    spawnSync(process.execPath, [comparator, snapshotPath], {
      encoding: 'utf8',
    })
  );
}

const exact = await run(snapshotFromBaseline());
assert.equal(exact.status, 0, exact.stderr || exact.stdout);
const exactReport = JSON.parse(exact.stdout);
assert.equal(exactReport.matches.length, 12);
assert.equal(exactReport.mismatches.length, 0);
assert.equal(exactReport.missingPublic.length, 0);
assert.equal(exactReport.missingSnapshot.length, 0);

const mismatchSnapshot = snapshotFromBaseline();
const mismatchEntry = mismatchSnapshot.files.find(
  (entry) => entry.path === 'static/robots.txt'
);
mismatchEntry.content += '\n';
mismatchEntry.byteLength = Buffer.byteLength(mismatchEntry.content, 'utf8');
mismatchEntry.sha256 = createHash('sha256')
  .update(mismatchEntry.content, 'utf8')
  .digest('hex');
const mismatch = await run(mismatchSnapshot);
assert.equal(mismatch.status, 0, mismatch.stderr || mismatch.stdout);
const mismatchReport = JSON.parse(mismatch.stdout);
assert.equal(mismatchReport.mismatches.length, 1);
assert.equal(mismatchReport.mismatches[0].path, 'static/robots.txt');
assert.equal(
  mismatchReport.authoritativeRollbackSource,
  'fresh Floot read_files snapshot'
);

const missingSnapshot = snapshotFromBaseline();
missingSnapshot.files = missingSnapshot.files.filter(
  (entry) => entry.path !== 'static/robots.txt'
);
const missing = await run(missingSnapshot);
assert.notEqual(missing.status, 0, 'missing snapshot path must fail');
const missingReport = JSON.parse(missing.stdout);
assert.ok(missingReport.missingSnapshot.includes('static/robots.txt'));

console.log('PASS Floot snapshot/public baseline compare: 12/12 exact match');
console.log('PASS source/public mismatch is reported while fresh Floot source remains authority');
console.log('PASS missing snapshot file fails closed');
