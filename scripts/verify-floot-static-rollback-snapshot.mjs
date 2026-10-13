import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const FROZEN_PATH = new URL('../verification/floot-static-rollback-public-latest.json',import.meta.url);
export const FROZEN_SHA = 'af59379dd3bacc5966107b5ffdde6bce16a26936';
export const FROZEN_ROUTES = 2;
export const STATIC_PATHS = Object.freeze([
  '/openapi.json','/llms.txt','/llms-full.txt','/skill.txt',
  '/.well-known/x402','/.well-known/x402.json',
  '/.well-known/x402-services.json','/.well-known/x402-service.json',
  '/.well-known/x402-catalog.json','/.well-known/security.txt',
  '/sitemap.xml','/robots.txt',
]);

/** Historical SHA-pinned evidence; never recapture or relabel eight-route live state. */
export function verifyFrozenRollbackReceipt(receipt) {
  assert.equal(receipt?.projectId,'b69a3ee6-eb01-430d-aa51-da2fc7beeac4');
  assert.equal(receipt?.productionOrigin,'https://pa-entity-x402.floot.app');
  assert.equal(receipt?.state,'pre-eight-route-rehost-public-static-baseline');
  assert.equal(receipt?.capturedAt,'2026-10-02T15:05:07.950Z');
  assert.equal(receipt?.canonicalManifestResourceCount,FROZEN_ROUTES);
  assert.ok(Array.isArray(receipt.files));
  assert.deepEqual(receipt.files.map(item=>item.publicPath),STATIC_PATHS);
  const seen=new Set();
  for (const item of receipt.files) {
    assert.ok(!seen.has(item.publicPath),'Duplicate static path');
    seen.add(item.publicPath);
    assert.equal(item.target,'static'+item.publicPath);
    assert.equal(typeof item.content,'string');
    assert.equal(typeof item.sha256,'string');
    assert.match(item.sha256,/^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(item.content,'utf8').digest('hex'),item.sha256,'Content digest drift');
    assert.equal(Buffer.byteLength(item.content,'utf8'),item.byteLengthUtf8,'Content length drift');
  }
  const canonical=receipt.files.find(x=>x.publicPath==='/.well-known/x402');
  const manifest=JSON.parse(canonical.content);
  assert.equal(manifest?.x402Version,2);
  assert.ok(Array.isArray(manifest?.resources));
  assert.equal(manifest.resources.length,FROZEN_ROUTES,'Historical two-route contract has changed');
  return {capturedAt:receipt.capturedAt,staticFiles:seen.size,canonicalRoutes:manifest.resources.length,evidence:'FROZEN_HISTORIC_ONLY_NOT_LIVE_PRODUCTION'};
}

if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const report=verifyFrozenRollbackReceipt(JSON.parse(readFileSync(FROZEN_PATH,'utf8')));
  console.log(JSON.stringify(report,null,2));
}
