#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const snapshotPath =
  process.argv[2] ?? process.env.FLOOT_SNAPSHOT_PATH ?? '';
if (!snapshotPath) {
  throw new Error(
    'Usage: node scripts/validate-floot-pre-rehost-snapshot.mjs <snapshot.json>'
  );
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));

const PROJECT_ID = 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4';
const ORIGIN = 'https://pa-entity-x402.floot.app';
const expectedPaths = [
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

assert.equal(snapshot.projectId, PROJECT_ID, 'wrong Floot project id');
assert.equal(snapshot.productionOrigin, ORIGIN, 'wrong production origin');
assert.ok(
  Number.isInteger(snapshot.projectVersion) && snapshot.projectVersion >= 0,
  'projectVersion must be a non-negative integer'
);
assert.match(
  String(snapshot.capturedAt ?? ''),
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  'capturedAt must be ISO-like'
);
assert.ok(Array.isArray(snapshot.files), 'files must be an array');
assert.equal(snapshot.files.length, expectedPaths.length, 'snapshot must contain 16 files');

const byPath = new Map(snapshot.files.map((entry) => [entry.path, entry]));
assert.equal(byPath.size, expectedPaths.length, 'snapshot paths must be unique');

for (const path of expectedPaths) {
  const entry = byPath.get(path);
  assert(entry, 'missing snapshot path ' + path);
  assert.equal(typeof entry.exists, 'boolean', path + ': exists must be boolean');

  if (entry.exists) {
    assert.equal(typeof entry.content, 'string', path + ': content must be a string');
    const bytes = Buffer.from(entry.content, 'utf8');
    assert.equal(entry.byteLength, bytes.length, path + ': byteLength mismatch');
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(entry.sha256, digest, path + ': SHA-256 mismatch');
  } else {
    assert.equal(entry.content, null, path + ': missing file content must be null');
    assert.equal(entry.byteLength, 0, path + ': missing file length must be zero');
    assert.equal(entry.sha256, null, path + ': missing file hash must be null');
  }
}

const extras = [...byPath.keys()].filter((path) => !expectedPaths.includes(path));
assert.deepEqual(extras, [], 'snapshot contains unexpected paths');

console.log(
  'PASS Floot pre-rehost snapshot: 16/16 expected paths, content lengths and SHA-256 digests verified'
);
