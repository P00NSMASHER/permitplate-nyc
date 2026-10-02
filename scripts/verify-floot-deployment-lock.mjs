#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const REPO = 'P00NSMASHER/permitplate-nyc';
const API = 'https://api.github.com/repos/' + REPO;
const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);

async function github(path) {
  const response = await fetch(API + path, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'x402-floot-deployment-lock-check/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error('GitHub ' + path + ' returned HTTP ' + response.status);
  }
  return response.json();
}

assert.equal(queue.projectId, 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4');
assert.equal(queue.productionOrigin, 'https://pa-entity-x402.floot.app');
assert.equal(queue.writes.length, 26);
assert.equal(queue.preserveTargets.length, 4);
assert.equal(queue.expectedPaidResourceCount, 8);
assert.match(queue.sourceBranch, /^floot-recovery-lock-/);
assert.match(queue.sourceCommit, /^[0-9a-f]{40}$/);
assert.ok(Array.isArray(queue.deploymentBundles));
assert.equal(queue.deploymentBundles.length, 2);

const bundledItems = [];
for (const bundle of queue.deploymentBundles) {
  assert.match(bundle.gitBlobSha, /^[0-9a-f]{40}$/);

  // Deployment bytes are fetched from GitHub, so the committed Git blob is
  // authoritative. A Windows checkout can rewrite LF to CRLF via core.autocrlf
  // and must not create a false release-drift failure.
  const blob = await github('/git/blobs/' + bundle.gitBlobSha);
  assert.equal(blob.sha, bundle.gitBlobSha, 'deployment bundle blob missing');
  assert.equal(blob.encoding, 'base64', 'unexpected deployment bundle encoding');
  const bytes = Buffer.from(blob.content.replace(/\\n/g, ''), 'base64');
  const header = Buffer.from('blob ' + bytes.length + '\0', 'utf8');
  const blobSha = crypto
    .createHash('sha1')
    .update(Buffer.concat([header, bytes]))
    .digest('hex');
  assert.equal(
    blobSha,
    bundle.gitBlobSha,
    'deployment bundle blob drift: ' + bundle.path
  );

  const parsed = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(parsed.range, bundle.range);
  assert.equal(parsed.items?.length, bundle.itemCount);
  bundledItems.push(...parsed.items);
}
assert.equal(bundledItems.length, queue.writes.length);
for (let i = 0; i < bundledItems.length; i += 1) {
  const item = bundledItems[i];
  const write = queue.writes[i];
  assert.equal(item.order, i + 1);
  assert.equal(item.source, write.source);
  assert.equal(item.target, write.target);
  assert.equal(item.gitBlobSha, write.gitBlobSha);
  assert.equal(item.size, write.size);
}

const branch = await github('/branches/' + encodeURIComponent(queue.sourceBranch));
assert.equal(
  branch.commit?.sha,
  queue.sourceCommit,
  'locked branch moved away from pinned source commit'
);

const treeResponse = await github(
  '/git/trees/' + queue.sourceCommit + '?recursive=1'
);
const tree = Array.isArray(treeResponse.tree) ? treeResponse.tree : [];
const byPath = new Map(tree.map((item) => [item.path, item]));

for (const write of queue.writes) {
  const expectedSourceUrl =
    'https://raw.githubusercontent.com/P00NSMASHER/permitplate-nyc/' +
    queue.sourceCommit +
    '/' +
    write.source;
  assert.equal(
    write.sourceUrl,
    expectedSourceUrl,
    'unpinned or incorrect sourceUrl: ' + write.source
  );

  const item = byPath.get(write.source);
  assert(item, 'locked source missing: ' + write.source);
  assert.equal(item.type, 'blob', 'locked source is not a blob: ' + write.source);
  assert.equal(
    item.sha,
    write.gitBlobSha,
    'Git blob SHA drift: ' + write.source
  );
  assert.equal(
    item.size,
    write.size,
    'byte-size drift: ' + write.source
  );
}

const main = await github('/branches/main');
const mainSha = main.commit?.sha;
assert.match(mainSha, /^[0-9a-f]{40}$/);

const comparison = await github(
  '/compare/' + queue.sourceCommit + '...' + mainSha
);
const changedFiles = Array.isArray(comparison.files)
  ? comparison.files.map((file) => file.filename)
  : [];
const lockedSources = new Set(queue.writes.map((write) => write.source));
const mutatedLockedSources = changedFiles.filter((path) => lockedSources.has(path));

assert.deepEqual(
  mutatedLockedSources,
  [],
  'current main changed one or more locked deployment source files'
);

const targets = queue.writes.map((write) => write.target);
assert.equal(new Set(targets).size, targets.length, 'duplicate Floot write target');
assert.equal(
  targets.filter((path) => path.startsWith('endpoints/')).length,
  14
);
assert.equal(
  targets.filter((path) => path.startsWith('static/')).length,
  12
);
assert.equal(
  targets.some((path) => /_OPTIONS\.ts$/.test(path)),
  false,
  'unsupported OPTIONS endpoint in deployment queue'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      sourceBranch: queue.sourceBranch,
      sourceCommit: queue.sourceCommit,
      currentMain: mainSha,
      mainCommitsAheadOfLock: comparison.ahead_by ?? null,
      lockedWrites: queue.writes.length,
      deploymentBundles: queue.deploymentBundles.length,
      bundledWrites: bundledItems.length,
      lockedSourcesChangedOnMain: mutatedLockedSources.length,
      endpointWrites: 14,
      staticWrites: 12,
      preservedFiles: queue.preserveTargets.length,
    },
    null,
    2
  )
);
