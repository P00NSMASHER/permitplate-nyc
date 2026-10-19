'use strict';
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const scope=require('./construction-scope-evidence');
const premise=require('./source-premise-factors');
const history=require('./independent-source-history');

const O='2026-10-19T17:00:00.000Z';
function dob(job,description,fields={}){
  return {
    ...adapters.normalizeDobNowRow({
      job_filing_number:job,filing_date:'2026-10-16T00:00:00.000',
      borough:'Brooklyn',house_no:'532',street_name:'NEPTUNE AVENUE',
      filing_status:'Approved',building_type:'Other',
      bin:'3062826',block:'2395',lot:'14',
      job_description:description,
      ...fields
    },{observedAt:O}),
    sourceObservationId:'OBS:dob-source-signed'
  };
}
function dohmh(fields={}){
  return {
    ...adapters.normalizeDohmhRow({
      camis:'50110000',dba:'RESTAURANT TEST',boro:'Brooklyn',
      building:'532',street:'NEPTUNE AVENUE',
      inspection_date:'1900-01-01T00:00:00.000',
      record_date:'2026-10-16T00:00:00.000',
      bin:'3062826',bbl:'3023950014',
      ...fields
    },{observedAt:O}),
    sourceObservationId:'OBS:dohmh-source-signed'
  };
}
// This type of official DOB filing actually loses the equipment scope after
// the old 180-char preview. The NEW evidence must preserve the entire field.
const long='INTERIOR RENOVATION OF EXISTING RESTAURANT. REMOVE EXISTING MILLWORK AND FINISHES. ALTERATION OF PARTIAL WALLS, SEATING, AND FIXTURES. EXISTING CEILINGS, INTERIOR FINISHES, FLOORING AND NONLOAD BEARING PARTITIONS WILL BE MODIFIED AS PER PLANS. REPLACE PARTIAL COOKING EQUIPMENT AND UPDATE FIRE SUPPRESSION SYSTEM. NO CHANGE IN EGRESS.';
assert(long.indexOf('COOKING EQUIPMENT')>180);
const row=dob('B01467007-I1',long),rec=scope.capture(row);
assert.equal(rec.sourceRecordId,row.sourceRecordId);
assert.equal(rec.fullText,long);
assert.equal(rec.sourceTextLength,long.length);
assert.equal(rec.sourceTextSha256,scope.sha(long));
assert.equal(rec.sourceFactFingerprint,row.rawFactFingerprint);
assert(rec.specificTags.includes('COOKING_EQUIPMENT'));
assert(rec.specificTags.includes('FIRE_SUPPRESSION'));
assert.equal(rec.scopeClass,'SPECIFIC_COMPONENT_AND_ACTION');
assert.equal(rec.existingOrRepairContext,true);
assert.equal(rec.customerDeliveryAllowed,false);
assert.equal(rec.noBuyerIntentEstablished,true);
assert(scope.validate(rec,row).valid);
assert(scope.validate(JSON.parse(JSON.stringify(rec)),row).valid);
const mutated=structuredClone(rec);
mutated.fullText+=' UNSUPPORTED';
assert.equal(scope.validate(mutated,row).valid,false);
const resealed=structuredClone(rec);
resealed.fullText='ALTERED CLAIM';
resealed.sourceTextSha256=scope.sha(resealed.fullText);
resealed.sourceTextLength=resealed.fullText.length;
const {scopeFingerprint:_old,...core}=resealed;
resealed.scopeFingerprint=scope.sha(adapters.stableStringify(core));
assert.equal(scope.validate(resealed,row).valid,false);
assert.throws(()=>scope.capture(dob('B01467007-I1',' ')),/DOB_SCOPE_EMPTY_OR_OVER_BOUND/);
assert.throws(()=>scope.capture(dob('B01467007-I1','a'.repeat(scope.MAX_DESCRIPTION_CHARS+1))),/DOB_SCOPE_EMPTY_OR_OVER_BOUND/);
const html=scope.capture(dob('B01467007-I1','RESTAURANT <script>alert(1)</script> new kitchen exhaust'));
assert(html.fullText.includes('<script>'));
assert.equal(html.customerDeliveryAllowed,false);

const provenance=premise.verifyPair(dohmh(),row);
assert.equal(provenance.binComparison,'MATCH');
assert.equal(provenance.bblComparison,'MATCH');
assert.equal(provenance.assessment,'MATCHED_PREMISE_IDENTIFIER_REVIEW');
assert.equal(provenance.independentlyVerifiedOperator,false);
assert.equal(provenance.noAutomaticIdentityLink,true);
assert(premise.verify(provenance,dohmh(),row).valid);
const tamperedPremise=structuredClone(provenance);
tamperedPremise.dohmhBin='0000000';
assert.equal(premise.verify(tamperedPremise,dohmh(),row).valid,false);

const conflict=premise.verifyPair(dohmh({bin:'3000001'}),row);
assert.equal(conflict.binComparison,'CONFLICT');
assert.equal(conflict.bblComparison,'MATCH');
assert.equal(conflict.assessment,'OFFICIAL_PROPERTY_IDENTIFIER_CONFLICT');
assert.equal(conflict.manualConflictHold,true);
assert.equal(conflict.customerDeliveryAllowed,false);
const bblConflict=premise.verifyPair(dohmh({bbl:'3023940014'}),row);
assert.equal(bblConflict.bblComparison,'CONFLICT');
assert.equal(bblConflict.manualConflictHold,true);
const unavailable=premise.verifyPair(dohmh({bin:'',bbl:''}),dob('B01467007-I2',long,{bin:'',block:'',lot:''}));
assert.equal(unavailable.assessment,'ADDRESS_ONLY_IDENTITY_UNRESOLVED');
assert.equal(unavailable.binComparison,'NOT_COMPARABLE');
assert.equal(unavailable.manualConflictHold,false);
assert.equal(premise.dobBbl(row),'3023950014');
assert.equal(premise.bin('0'),null);
assert.equal(premise.bbl('987'),null);
assert.throws(()=>premise.verifyPair(row,dohmh()),/PREMISE_SOURCE_PROVENANCE_REQUIRED/);

// Migration must NOT treat the newly captured full scope as a changed filing.
// But a later material change *after* 180 characters must be detected.
function item(record,includeScope){
  return {
    sourceSystem:'DOB_NOW',sourceRecordId:record.sourceRecordId,
    sourceEffectiveAt:'2026-10-16T00:00:00.000Z',
    sourceExcerpt:record.facts.job_description.slice(0,180),
    matchedResearchTerms:['RESTAURANT'],
    sourceStatus:record.facts.filing_status,
    reviewStatus:'REVIEW_ONLY_UNLINKED',customerDeliveryAllowed:false,
    ...(includeScope?{constructionScope:scope.capture(record)}:{})
  };
}
function review(at,record,withScope){
  const core={
    version:history.SOURCE_VERSION,status:'REVIEW_ONLY',
    observedAt:at,storedCount:1,totalResearchMatches:1,
    omittedByLimit:0,items:[item(record,withScope)],
    customerDeliveryAllowed:false,externalSendCalls:0
  };
  return {...core,artifactFingerprint:history.hash(core)};
}
const beforeDate='2026-10-19T16:00:00.000Z',
  migrateAt='2026-10-19T17:00:00.000Z',
  laterAt='2026-10-19T18:00:00.000Z';
const old=history.bootstrap(review(beforeDate,row,false));
assert.equal(old.status,'BASELINED');
const migrated=history.advance(old.ledger,review(migrateAt,row,true));
assert.equal(migrated.newObservationIds.length,0);
assert.equal(migrated.contextChangeIds.length,0);
assert.equal(migrated.scopeBaselineMigratedCount,1);
assert.equal(migrated.ledger.entries[row.sourceRecordId].firstObservedAt,beforeDate);
assert.equal(migrated.ledger.entries[row.sourceRecordId].scopeBaselineMigratedAt,migrateAt);
const replay=history.advance(migrated.ledger,review(laterAt,row,true));
assert.equal(replay.scopeBaselineMigratedCount,0);
assert.equal(replay.scopeChangeCount,0);
assert.deepEqual(replay.contextChangeIds,[]);
const newSource=dob('B01467007-I1',long+' AN ADDITIONAL COMMERCIAL REFRIGERATION UNIT IS NOW FILED.');
assert.equal(item(row,true).sourceExcerpt,item(newSource,true).sourceExcerpt);
const changed=history.advance(migrated.ledger,review(laterAt,newSource,true));
assert.equal(changed.scopeChangeCount,1);
assert.deepEqual(changed.contextChangeIds,[row.sourceRecordId]);
assert.equal(changed.ledger.entries[row.sourceRecordId].firstObservedAt,beforeDate);
assert(history.validate(changed.ledger).valid);
assert(history.annotate(review(laterAt,newSource,true),changed.ledger,
  [],changed.contextChangeIds).items[0].monitoringStatus==='SOURCE_CONTEXT_CHANGED_FOR_REVIEW');
const dropped=history.advance(migrated.ledger,review(laterAt,newSource,false));
assert.equal(dropped.status,'REVIEW');
assert(dropped.failures.includes('INDEPENDENT_FULL_SCOPE_EVIDENCE_MISSING'));

console.log('Full DOB source scope, fingerprint/disk roundtrip, BIN/BBL conflict and review-only identity tests passed.');
