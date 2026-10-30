'use strict';
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const premise=require('./source-premise-factors');

// Exact identifying fields rechecked against NYC official DOHMH 43nn-pn8j
// and DOB NOW w9ak-ipjd on October 19, 2026. This is property reconciliation
// only; it is NOT restaurant operator proof or an identity merge approval.
const now='2026-10-19T18:00:00.000Z';
function sources(camis,dohmhBin,dohmhBbl,job,dobBin,block,lot,addr){
  const [building,...streetParts]=addr.split(' ');
  const street=streetParts.join(' ');
  const h=adapters.normalizeDohmhRow({
    camis,dba:'UNVERIFIED RESTAURANT OPERATOR',boro:'Brooklyn',
    building,street,bin:dohmhBin,bbl:dohmhBbl,
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-10-19T12:00:00.000Z'
  },{observedAt:now});
  h.sourceObservationId='OBS:DOHMH_FIXTURE';
  const d=adapters.normalizeDobNowRow({
    job_filing_number:job,borough:'Brooklyn',house_no:building,
    street_name:street,bin:dobBin,block,lot,
    job_description:'RESTAURANT INTERIOR CONSTRUCTION',
    filing_date:'2026-10-19T09:00:00.000Z'
  },{observedAt:now});
  d.sourceObservationId='OBS:DOB_NOW_FIXTURE';
  return premise.verifyPair(h,d);
}
const s1=sources('50189702','3000000','3072737501',
  'B01415135-S1','3426198','7273','7501','532 NEPTUNE AVENUE');
const s2=sources('50189702','3000000','3072737501',
  'B01415135-S2','3426198','7273','7501','532 NEPTUNE AVENUE');
for(const x of [s1,s2]){
  assert.equal(x.binComparison,'NOT_COMPARABLE');
  assert.equal(x.bblComparison,'MATCH');
  assert.equal(x.manualConflictHold,false);
  assert.equal(x.dohmhMillionBinPlaceholder,true);
  assert.equal(x.assessment,'MATCHED_PREMISE_IDENTIFIER_REVIEW');
  assert.equal(x.noAutomaticIdentityLink,true);
  assert.equal(x.independentlyVerifiedOperator,false);
  assert.equal(x.customerDeliveryAllowed,false);
}
const realConflict=sources('50190119','3000289','3001450022',
  'B01464280-I1','3000289','145','7502','383 BRIDGE STREET');
assert.equal(realConflict.binComparison,'MATCH');
assert.equal(realConflict.bblComparison,'CONFLICT');
assert.equal(realConflict.assessment,'OFFICIAL_PROPERTY_IDENTIFIER_CONFLICT');
assert.equal(realConflict.manualConflictHold,true);
assert.equal(realConflict.noAutomaticIdentityLink,true);
assert.equal(realConflict.independentlyVerifiedOperator,false);
console.log('Real official NYC million-BIN sentinel cases no longer create false conflicts; genuine property disagreement is held.');
