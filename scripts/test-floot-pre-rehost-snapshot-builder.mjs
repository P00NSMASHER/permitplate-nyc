#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'floot-snapshot-test-'));
const input = join(root, 'raw.json');
const output = join(root, 'snapshot.json');

const queue = JSON.parse(
  await readFile(
    new URL('../verification/floot-deployment-queue-latest.json', import.meta.url),
    'utf8'
  )
);

const mandatory = [
  'endpoints/pa-business_GET.ts',
  'endpoints/pa-business_GET.schema.ts',
  'endpoints/pa-entity-one_GET.ts',
  'endpoints/pa-entity-one_GET.schema.ts',
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

const existingTargets = new Set([
  ...mandatory,
  queue.writes[0].target,
]);

const raw = {
  projectId: queue.projectId,
  projectVersion: 123,
  productionOrigin: queue.productionOrigin,
  capturedAt: '2026-10-02T12:00:00.000Z',
  projectPaths: [...existingTargets],
  files: [...existingTargets].map((path) => ({
    path,
    exists: true,
    content: 'fixture:' + path + '\n',
  })),
};

await writeFile(input, JSON.stringify(raw), 'utf8');

const build = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./build-floot-pre-rehost-snapshot.mjs', import.meta.url)),
    input,
    output,
  ],
  { encoding: 'utf8' }
);
assert.equal(build.status, 0, build.stderr || build.stdout);

const validate = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./validate-floot-pre-rehost-snapshot.mjs', import.meta.url)),
    output,
  ],
  { encoding: 'utf8' }
);
assert.equal(validate.status, 0, validate.stderr || validate.stdout);

const snapshot = JSON.parse(await readFile(output, 'utf8'));
assert.equal(snapshot.projectVersion, 123);
assert.equal(snapshot.preexistingRecoveryTargets.length, 13);
assert.equal(snapshot.absentRecoveryTargets.length, 13);
assert.ok(
  snapshot.files.some(
    (entry) =>
      entry.path === queue.writes[0].target &&
      entry.exists === true &&
      /^[0-9a-f]{64}$/.test(entry.sha256)
  )
);


// Missing mandatory baseline must fail before any recovery write.
const missingRaw = structuredClone(raw);
missingRaw.projectPaths = missingRaw.projectPaths.filter(
  (path) => path !== 'static/robots.txt'
);
missingRaw.files = missingRaw.files.filter(
  (entry) => entry.path !== 'static/robots.txt'
);
await writeFile(input, JSON.stringify(missingRaw), 'utf8');
const missingBuild = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./build-floot-pre-rehost-snapshot.mjs', import.meta.url)),
    input,
    output,
  ],
  { encoding: 'utf8' }
);
assert.notEqual(missingBuild.status, 0, 'missing mandatory baseline must fail');
assert.match(
  missingBuild.stderr + missingBuild.stdout,
  /mandatory_baseline_missing:static\/robots\.txt/
);

// Snapshot must remain bound to the immutable deployment source lock.
await writeFile(input, JSON.stringify(raw), 'utf8');
const rebuild = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./build-floot-pre-rehost-snapshot.mjs', import.meta.url)),
    input,
    output,
  ],
  { encoding: 'utf8' }
);
assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);
const unlocked = JSON.parse(await readFile(output, 'utf8'));
unlocked.sourceCommit = '0000000000000000000000000000000000000000';
await writeFile(output, JSON.stringify(unlocked), 'utf8');
const lockValidation = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('./validate-floot-pre-rehost-snapshot.mjs', import.meta.url)),
    output,
  ],
  { encoding: 'utf8' }
);
assert.notEqual(lockValidation.status, 0, 'wrong source lock must fail');
assert.match(
  lockValidation.stderr + lockValidation.stdout,
  /snapshot sourceCommit must match immutable deployment lock/
);

console.log('PASS pre-rehost snapshot builder + validator synthetic round trip');
console.log('PASS missing mandatory baseline and source-lock mismatch fail closed');
