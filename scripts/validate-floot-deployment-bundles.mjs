#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));

const map = await readJson('docs/pa-entity-floot-recovery/deploy-map.json');
const a = await readJson('recovery/floot-deployment-bundle-01.json');
const b = await readJson('recovery/floot-deployment-bundle-02.json');
const queue = await readJson('verification/floot-deployment-queue-latest.json');

assert.equal(a.formatVersion, 1);
assert.equal(b.formatVersion, 1);
assert.equal(a.projectId, map.projectId);
assert.equal(queue.projectId, map.projectId);
assert.match(String(queue.sourceMapBlobSha ?? ''), /^[0-9a-f]{40}$/);
assert.equal(a.deployMapBlobSha, queue.sourceMapBlobSha);
assert.equal(b.deployMapBlobSha, queue.sourceMapBlobSha);
assert.equal(b.projectId, map.projectId);
assert.equal(a.productionOrigin, map.productionOrigin);
assert.equal(b.productionOrigin, map.productionOrigin);
assert.deepEqual(a.range, { from: 1, to: 13 });
assert.deepEqual(b.range, { from: 14, to: 26 });

const items = [...a.items, ...b.items];
assert.equal(items.length, 26);

const targets = new Set();
for (let i = 0; i < items.length; i += 1) {
  const item = items[i];
  const expected = map.writes[i];

  assert.equal(item.order, i + 1, 'order mismatch at index ' + i);
  assert.equal(item.source, expected.source, 'source mismatch at order ' + item.order);
  assert.equal(item.target, expected.target, 'target mismatch at order ' + item.order);
  assert.equal(
    item.gitBlobSha,
    expected.gitBlobSha,
    'declared blob mismatch at order ' + item.order
  );
  assert.equal(item.size, expected.size, 'declared size mismatch at order ' + item.order);

  const bytes = Buffer.from(item.content, 'utf8');
  assert.equal(bytes.length, expected.size, 'embedded byte size drift: ' + item.source);

  const header = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  const sha = crypto
    .createHash('sha1')
    .update(Buffer.concat([header, bytes]))
    .digest('hex');
  assert.equal(sha, expected.gitBlobSha, 'embedded blob SHA drift: ' + item.source);

  assert(!targets.has(item.target), 'duplicate target: ' + item.target);
  targets.add(item.target);

  assert(
    item.target.startsWith('endpoints/') || item.target.startsWith('static/'),
    'unsupported Floot target: ' + item.target
  );
  assert(!item.target.includes('_OPTIONS'), 'unsupported OPTIONS target: ' + item.target);
}

assert.equal(targets.size, 26);

console.log('PASS Floot deployment bundles: 26/26 ordered writes');
console.log('PASS deployment bundles pinned to immutable locked deploy-map blob');
console.log('PASS embedded contents: 26/26 byte sizes and Git blob SHAs');
console.log('PASS target uniqueness/path rules: 26/26');
