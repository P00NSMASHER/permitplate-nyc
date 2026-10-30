#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const ORIGIN = 'https://pa-entity-x402.floot.app';
const PROJECT_ID = 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4';

const files = [
  ['static/openapi.json', '/openapi.json'],
  ['static/llms.txt', '/llms.txt'],
  ['static/llms-full.txt', '/llms-full.txt'],
  ['static/skill.txt', '/skill.txt'],
  ['static/.well-known/x402', '/.well-known/x402'],
  ['static/.well-known/x402.json', '/.well-known/x402.json'],
  ['static/.well-known/x402-services.json', '/.well-known/x402-services.json'],
  ['static/.well-known/x402-service.json', '/.well-known/x402-service.json'],
  ['static/.well-known/x402-catalog.json', '/.well-known/x402-catalog.json'],
  ['static/.well-known/security.txt', '/.well-known/security.txt'],
  ['static/sitemap.xml', '/sitemap.xml'],
  ['static/robots.txt', '/robots.txt'],
];

const captured = [];

for (const [target, path] of files) {
  const response = await fetch(ORIGIN + path, {
    headers: {
      accept: '*/*',
      'user-agent': 'x402-floot-static-rollback-capture/1.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200) {
    throw new Error(path + ' returned HTTP ' + response.status);
  }
  const content = await response.text();
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  captured.push({
    target,
    publicPath: path,
    contentType: response.headers.get('content-type'),
    byteLengthUtf8: Buffer.byteLength(content, 'utf8'),
    sha256,
    content,
  });
}

const manifest = JSON.parse(
  captured.find((entry) => entry.target === 'static/.well-known/x402').content
);
if (manifest?.x402Version !== 2 || manifest?.resources?.length !== 2) {
  throw new Error('Refusing rollback capture: canonical manifest is not the known two-route state');
}

const receipt = {
  capturedAt: new Date().toISOString(),
  projectId: PROJECT_ID,
  productionOrigin: ORIGIN,
  state: 'pre-eight-route-rehost-public-static-baseline',
  canonicalManifestResourceCount: manifest.resources.length,
  files: captured,
  note:
    'These are public static response bodies captured before the Floot eight-route rehost. After the post-reset list_files/read_files check, compare these hashes to the current Floot static file contents before relying on them for rollback.',
};

const json = JSON.stringify(receipt, null, 2);
console.log(
  JSON.stringify(
    {
      capturedAt: receipt.capturedAt,
      files: receipt.files.length,
      bytes: receipt.files.reduce((sum, file) => sum + file.byteLengthUtf8, 0),
      canonicalManifestResourceCount: receipt.canonicalManifestResourceCount,
    },
    null,
    2
  )
);

const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) await writeFile(reportPath, json + '\n', 'utf8');
