#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const receipt = JSON.parse(
  await readFile(
    new URL(
      '../verification/floot-static-rollback-public-latest.json',
      import.meta.url
    ),
    'utf8'
  )
);

const expectedTargets = [
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

assert.equal(receipt.projectId, 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4');
assert.equal(receipt.productionOrigin, 'https://pa-entity-x402.floot.app');
assert.equal(receipt.canonicalManifestResourceCount, 2);
assert.equal(receipt.files.length, expectedTargets.length);

const byTarget = new Map(receipt.files.map((entry) => [entry.target, entry]));
assert.equal(byTarget.size, expectedTargets.length);

for (const target of expectedTargets) {
  const entry = byTarget.get(target);
  assert(entry, 'missing rollback target ' + target);
  assert.equal(typeof entry.content, 'string');
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    Buffer.byteLength(entry.content, 'utf8'),
    entry.byteLengthUtf8,
    'byte length mismatch for ' + target
  );
  const hash = createHash('sha256')
    .update(entry.content, 'utf8')
    .digest('hex');
  assert.equal(hash, entry.sha256, 'SHA-256 mismatch for ' + target);
}

for (const target of [
  'static/openapi.json',
  'static/.well-known/x402',
  'static/.well-known/x402.json',
  'static/.well-known/x402-services.json',
  'static/.well-known/x402-service.json',
  'static/.well-known/x402-catalog.json',
]) {
  JSON.parse(byTarget.get(target).content);
}

const manifest = JSON.parse(
  byTarget.get('static/.well-known/x402').content
);
assert.equal(manifest.x402Version, 2);
assert.equal(manifest.resources.length, 2);

console.log(
  JSON.stringify(
    {
      ok: true,
      capturedAt: receipt.capturedAt,
      files: receipt.files.length,
      totalBytes: receipt.files.reduce(
        (sum, entry) => sum + entry.byteLengthUtf8,
        0
      ),
      canonicalManifestResourceCount: manifest.resources.length,
    },
    null,
    2
  )
);
