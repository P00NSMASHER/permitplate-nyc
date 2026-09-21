'use strict';

const assert=require('assert');
const d=require('./detection-ledger');

function candidate(id,overrides){
  return Object.assign({
    entityId:'CAMIS:'+id,
    canonicalName:'Venue '+id,
    lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-09-21T10:00:00Z',
    sourceLatestEffectiveAt:'2026-09-21T10:00:00Z',
    sourceSystems:['DOHMH'],
    projectSignalId:'PS:'+id,
    commercialEvidence:[]
  },overrides||{});
}
function graph(candidates,state='COMPLETE',digest='graph-1'){
  return {graphState:state,graphDigest:digest,candidates};
}

{
  const result=d.bootstrapLedger(graph([candidate('1'),candidate('2')]),'2026-09-21T16:00:00Z');
  assert.equal(result.committed,true);
  assert.equal(result.reason,'BOOTSTRAP_BASELINE');
  assert.equal(result.receipts.length,2);
  assert.equal(result.customerEligibleReceipts.length,0);
  assert(result.receipts.every(r=>r.detectionClass==='BASELINE_EXISTING'));
  assert(result.receipts.every(r=>r.customerEligible===false));
  assert.equal(Object.keys(result.ledger.entries).length,2);
  assert.equal(d.validateLedger(result.ledger).valid,true);
}

{
  const result=d.bootstrapLedger(graph([candidate('1')],'PARTIAL'),'2026-09-21T16:00:00Z');
  assert.equal(result.committed,false);
  assert.equal(result.reason,'GRAPH_NOT_COMPLETE');
  assert.equal(result.ledger,null);
}

{
  const boot=d.bootstrapLedger(graph([candidate('1')]),'2026-09-21T16:00:00Z');
  const next=d.advanceDetectionLedger(
    boot.ledger,
    graph([candidate('1'),candidate('2')],'COMPLETE','graph-2'),
    '2026-09-21T17:00:00Z'
  );
  assert.equal(next.committed,true);
  assert.equal(next.customerEligibleReceipts.length,1);
  const r=next.customerEligibleReceipts[0];
  assert.equal(r.entityId,'CAMIS:2');
  assert.equal(r.detectionClass,'NEW_ENTITY');
  assert.equal(r.customerEligible,true);
  assert.equal(r.firstDetectedAt,'2026-09-21T17:00:00.000Z');
  assert.equal(next.ledger.entries['CAMIS:1'].lastCustomerEventAt,null);
  assert.equal(next.ledger.entries['CAMIS:2'].lastCustomerEventClass,'NEW_ENTITY');
}

{
  const c1=candidate('1');
  const boot=d.bootstrapLedger(graph([c1]),'2026-09-21T16:00:00Z');
  const changed=candidate('1',{
    lifecycleStage:'HEALTH PRE-PERMIT',
    sourceLatestEffectiveAt:'2026-09-21T16:30:00Z',
    sourceSystems:['DOHMH'],
    commercialEvidence:[{tag:'PREPERMIT',sourceSystem:'DOHMH',sourceRecordId:'r2'}]
  });
  const next=d.advanceDetectionLedger(
    boot.ledger,
    graph([changed],'COMPLETE','graph-2'),
    '2026-09-21T17:00:00Z'
  );
  assert.equal(next.customerEligibleReceipts.length,1);
  const r=next.customerEligibleReceipts[0];
  assert.equal(r.detectionClass,'MATERIAL_CHANGE');
  assert.equal(r.customerEligible,true);
  assert.equal(r.materialChangeAt,'2026-09-21T17:00:00.000Z');
  assert(r.previousChangeFingerprint);
  assert.notEqual(r.previousChangeFingerprint,r.changeFingerprint);
}

{
  const boot=d.bootstrapLedger(graph([candidate('1'),candidate('2')]),'2026-09-21T16:00:00Z');
  const next=d.advanceDetectionLedger(
    boot.ledger,
    graph([candidate('1')],'COMPLETE','graph-2'),
    '2026-09-21T17:00:00Z'
  );
  assert.equal(next.customerEligibleReceipts.length,0);
  assert.equal(next.ledger.entries['CAMIS:2'].presenceState,'OUT_OF_CURRENT_WINDOW');
  assert.equal(next.ledger.entries['CAMIS:2'].lastCustomerEventClass,null);
}

{
  const boot=d.bootstrapLedger(graph([candidate('1'),candidate('2')]),'2026-09-21T16:00:00Z');
  const missing=d.advanceDetectionLedger(
    boot.ledger,
    graph([candidate('1')],'COMPLETE','graph-2'),
    '2026-09-21T17:00:00Z'
  );
  const back=d.advanceDetectionLedger(
    missing.ledger,
    graph([candidate('1'),candidate('2')],'COMPLETE','graph-3'),
    '2026-09-21T18:00:00Z'
  );
  const r=back.receipts.find(x=>x.entityId==='CAMIS:2');
  assert(r);
  assert.equal(r.detectionClass,'REAPPEARED_REVIEW');
  assert.equal(r.customerEligible,false);
  assert.equal(back.customerEligibleReceipts.length,0);
}

{
  const boot=d.bootstrapLedger(graph([candidate('1')]),'2026-09-21T16:00:00Z');
  const partial=d.advanceDetectionLedger(
    boot.ledger,
    graph([candidate('1',{lifecycleStage:'HEALTH PRE-PERMIT'})],'PARTIAL','graph-partial'),
    '2026-09-21T17:00:00Z'
  );
  assert.equal(partial.committed,false);
  assert.equal(partial.reason,'GRAPH_NOT_COMPLETE');
  assert.equal(partial.receipts.length,0);
  assert.equal(partial.ledger.ledgerFingerprint,boot.ledger.ledgerFingerprint);
}

{
  const boot=d.bootstrapLedger(graph([candidate('1')]),'2026-09-21T16:00:00Z');
  const tampered=JSON.parse(JSON.stringify(boot.ledger));
  tampered.entries['CAMIS:1'].currentChangeFingerprint='tampered';
  const next=d.advanceDetectionLedger(
    tampered,
    graph([candidate('1')]),
    '2026-09-21T17:00:00Z'
  );
  assert.equal(next.committed,false);
  assert.equal(next.reason,'LEDGER_INVALID');
  assert(next.errors.includes('LEDGER_FINGERPRINT_MISMATCH'));
}

{
  const g=graph([candidate('1'),candidate('2')]);
  const a=d.bootstrapLedger(g,'2026-09-21T16:00:00Z');
  const b=d.bootstrapLedger(JSON.parse(JSON.stringify(g)),'2026-09-21T16:00:00Z');
  assert.equal(a.ledger.ledgerFingerprint,b.ledger.ledgerFingerprint);
  assert.deepEqual(a.receipts,b.receipts);
}

console.log('PermitPlate detection ledger regression tests passed.');
