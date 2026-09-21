'use strict';

const assert=require('assert');
const o=require('./opportunity-ledger');

function packageReceipt(id,overrides){
  const base={
    packageVersion:'PermitPlate-candidate-package-v1.0.0',
    status:'READY_FOR_PROFILE_MATCHING',
    entityId:'CAMIS:'+id,
    graphDigest:'graph-1',
    changeFingerprint:'change-'+id,
    detectionReceiptId:'DET:'+id,
    detectionReceipt:{
      receiptId:'DET:'+id,
      detectionClass:'NEW_ENTITY',
      customerEligible:true,
      entityId:'CAMIS:'+id,
      changeFingerprint:'change-'+id,
      firstDetectedAt:'2026-09-21T17:00:00Z'
    },
    scoreReceiptId:'SCORE:'+id,
    scoreReceipt:{
      scoreReceiptId:'SCORE:'+id,
      productionAuthorized:true,
      scores:{POS:80},
      scorerVersion:'test'
    },
    detectionClass:'NEW_ENTITY',
    detectedAt:'2026-09-21T17:00:00Z',
    commercialFit:'HIGH',
    scores:{POS:80},
    bestVendorFit:'POS',
    bestScore:80,
    productionAuthorized:true,
    failures:[]
  };
  const p=Object.assign(base,overrides||{});
  p.packageFingerprint=o.sha256(o.stableStringify({
    entityId:p.entityId,
    changeFingerprint:p.changeFingerprint,
    scoreReceiptId:p.scoreReceiptId,
    detectionReceiptId:p.detectionReceiptId,
    status:p.status
  }));
  p.packageId='PKG:'+p.packageFingerprint.slice(0,24);
  return p;
}

{
  const empty=o.emptyLedger('2026-09-21T17:00:00Z');
  assert.equal(o.validateLedger(empty).valid,true);
  assert.equal(Object.keys(empty.entries).length,0);
}

{
  const first=packageReceipt('1');
  const result=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[first]},
    '2026-09-21T17:05:00Z'
  );
  assert.equal(result.committed,true);
  assert.equal(result.reason,'PACKAGES_APPENDED');
  assert.equal(result.added.length,1);
  assert.equal(result.totalEntries,1);
  const entry=result.ledger.entries[o.eventKey(first)];
  assert.equal(entry.packageId,first.packageId);
  assert.equal(entry.packageFingerprint,first.packageFingerprint);
  assert.equal(entry.package.productionAuthorized,true);
}

{
  const p=packageReceipt('1');
  const first=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[p]},
    '2026-09-21T17:05:00Z'
  );
  const replay=o.appendOpportunityPackages(
    first.ledger,
    {passed:true,packages:[JSON.parse(JSON.stringify(p))]},
    '2026-09-21T17:10:00Z'
  );
  assert.equal(replay.committed,true);
  assert.equal(replay.reason,'IDEMPOTENT_NOOP');
  assert.equal(replay.added.length,0);
  assert.equal(replay.totalEntries,1);
  assert.equal(replay.ledger.ledgerFingerprint,first.ledger.ledgerFingerprint);
}

{
  const p=packageReceipt('1');
  const first=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[p]},
    '2026-09-21T17:05:00Z'
  );
  const conflict=packageReceipt('1',{bestScore:99});
  conflict.packageFingerprint='different-package-fingerprint';
  conflict.packageId='PKG:different';
  const replay=o.appendOpportunityPackages(
    first.ledger,
    {passed:true,packages:[conflict]},
    '2026-09-21T17:10:00Z'
  );
  assert.equal(replay.committed,false);
  assert.equal(replay.reason,'EVENT_KEY_PACKAGE_CONFLICT');
  assert.equal(replay.ledger.ledgerFingerprint,first.ledger.ledgerFingerprint);
}

{
  const review=packageReceipt('2',{status:'REVIEW',productionAuthorized:false});
  const result=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[review]},
    '2026-09-21T17:05:00Z'
  );
  assert.equal(result.committed,false);
  assert.equal(result.reason,'PACKAGE_NOT_LEDGER_ELIGIBLE');
}

{
  const result=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:false,packages:[]},
    '2026-09-21T17:05:00Z'
  );
  assert.equal(result.committed,false);
  assert.equal(result.reason,'PACKAGE_RESULT_NOT_PASSED');
}

{
  const ledger=o.emptyLedger('2026-09-21T17:00:00Z');
  const tampered=JSON.parse(JSON.stringify(ledger));
  tampered.entries.bad={entityId:'bad'};
  const result=o.appendOpportunityPackages(
    tampered,
    {passed:true,packages:[]},
    '2026-09-21T17:05:00Z'
  );
  assert.equal(result.committed,false);
  assert.equal(result.reason,'LEDGER_INVALID');
  assert(result.errors.includes('LEDGER_FINGERPRINT_MISMATCH'));
}

{
  const p1=packageReceipt('1');
  const p2=packageReceipt('2');
  const a=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[p1,p2]},
    '2026-09-21T17:05:00Z'
  );
  const b=o.appendOpportunityPackages(
    o.emptyLedger('2026-09-21T17:00:00Z'),
    {passed:true,packages:[p1,p2]},
    '2026-09-21T17:05:00Z'
  );
  assert.equal(a.ledger.ledgerFingerprint,b.ledger.ledgerFingerprint);
}

console.log('PermitPlate opportunity ledger regression tests passed.');
