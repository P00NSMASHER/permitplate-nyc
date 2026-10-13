import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyFrozenRollbackReceipt,FROZEN_PATH,STATIC_PATHS} from './verify-floot-static-rollback-snapshot.mjs';

const original=JSON.parse(readFileSync(FROZEN_PATH,'utf8'));
const fresh=()=>structuredClone(original);
assert.equal(verifyFrozenRollbackReceipt(fresh()).canonicalRoutes,2);

for (const corruption of [
  item=>{item.files[0].content+='altered';},
  item=>{item.files[1].byteLengthUtf8+=1;},
  item=>{item.files.push({...item.files[0]});},
  item=>{item.state='eight-route-post-rehost';},
  item=>{item.capturedAt='2026-10-13T00:00:00Z';},
]) {
  const mutated=fresh();corruption(mutated);
  assert.throws(()=>verifyFrozenRollbackReceipt(mutated));
}

// Even a self-consistently rehashed eight-route version must never overwrite
// the historical two-route pre-rehost witness.
const forged=fresh();
const canonical=forged.files.find(x=>x.publicPath==='/.well-known/x402');
const doc=JSON.parse(canonical.content);
for (let i=0;i<6;i++)doc.resources.push({...doc.resources[0],resource:'forged-'+i});
canonical.content=JSON.stringify(doc);
canonical.byteLengthUtf8=Buffer.byteLength(canonical.content,'utf8');
canonical.sha256=createHash('sha256').update(canonical.content).digest('hex');
forged.canonicalManifestResourceCount=8;
assert.throws(()=>verifyFrozenRollbackReceipt(forged));
assert.equal(STATIC_PATHS.length,12);
console.log('PASS immutable two-route rollback receipt: integrity, identity, chronology and no live eight-route laundering');
