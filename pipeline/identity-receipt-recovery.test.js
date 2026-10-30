'use strict';
const assert=require('node:assert/strict');
const identity=require('./identity-bridge-review');
const recovery=require('./identity-receipt-recovery');
const {hash}=require('./independent-source-history');
const runner=require('./run-curated-research');

const T0='2026-10-19T06:46:11.507Z',T1='2026-10-19T12:35:00.000Z';
function proposed(extra={}){
  return identity.createProposal({
    kind:'CAMIS_TO_EARLY_SOURCE',
    sourceRecordId:'DOB_NOW:B01415135-S1',
    sourceRecordIds:['DOB_NOW:B01415135-S1'],
    candidateEntityId:'CAMIS:50189702',
    sourceSystem:'DOB_NOW',
    premiseKey:'BROOKLYN|532 NEPTUNE AVENUE',
    nameAgreement:'NOT_ESTABLISHED',
    reviewClass:'PREMISE_ONLY',
    competingCamisCount:1,
    officialSourceUrls:[
      'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B01415135-S1',
      'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=50189702'
    ],
    sourceObservationId:'OBS:initial',
    sourceRowFingerprint:undefined,
    dohmhRecordId:'DOHMH:50189702:1900-01-01T00:00:00.000:abc123',
    dohmhObservationId:'OBS:dohmh-initial',
    dohmhRowFingerprint:undefined,
    candidateName:'SKS 1818 LLC',
    sourceTradeName:null,sourceOwnerName:'SORA BY MASUTA',
    sourceGraphFingerprint:'1'.repeat(64),...extra
  });
}
function receipt(proposal,at=T0){
  const body={
    version:identity.VERSION,status:'REVIEW_ONLY',observedAt:at,
    sourceGraphDigest:'a'.repeat(64),
    sourceArtifactFingerprint:'b'.repeat(64),
    sourceReviewFingerprint:'c'.repeat(64),
    totalProposals:1,storedCount:1,omittedByLimit:0,
    reviewQueueComplete:true,skippedWithoutDohmhProvenance:0,
    proposals:[proposal],customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false,
    automaticMerges:0,externalSendCalls:0,
    notices:['Review required']
  };
  return {...body,artifactFingerprint:hash(body)};
}
const current=proposed();
assert(!Object.prototype.hasOwnProperty.call(current,'sourceRowFingerprint'));
assert(!Object.prototype.hasOwnProperty.call(current,'dohmhRowFingerprint'));
assert(identity.validate(receipt(current)).valid);
assert(identity.validate(JSON.parse(JSON.stringify(receipt(current)))).valid);
const already=recovery.normalizeReceipt(receipt(current));
assert.equal(already.ready,true);
assert.equal(already.legacy,false);

// Simulate exact historical in-memory object shape and prove it passed before
// JSON serialization, then reproduce the disk-readback defect.
const historical={...current,sourceRowFingerprint:undefined,dohmhRowFingerprint:undefined};
const {evidenceFingerprint:_old,...original}=historical;
historical.evidenceFingerprint=hash(original);
const oldInMemory=receipt(historical);
assert(identity.validate(oldInMemory).valid);
const persisted=JSON.parse(JSON.stringify(oldInMemory));
assert.equal(identity.validate(persisted).valid,false);
assert.equal(persisted.observedAt,T0);
const restored=recovery.normalizeReceipt(persisted);
assert.equal(restored.ready,true);
assert.equal(restored.legacy,true);
assert.equal(restored.recoveredProposalCount,1);
assert(identity.validate(restored.receipt).valid);
assert.equal(restored.receipt.observedAt,T0);
assert.equal(restored.receipt.proposals[0].proposalId,current.proposalId);
assert.equal(restored.receipt.proposals[0].candidateName,current.candidateName);
assert.notEqual(restored.receipt.artifactFingerprint,persisted.artifactFingerprint);
assert(identity.validate(JSON.parse(JSON.stringify(restored.receipt))).valid);

const fresh=receipt(proposed({
  sourceObservationId:'OBS:new',
  dohmhObservationId:'OBS:dohmh-new',
  sourceGraphFingerprint:'d'.repeat(64)
}),T1);
const migrated=runner.prepareIdentityHistory(null,persisted,fresh);
assert.equal(migrated.ready,true);
assert.equal(migrated.migrated,true);
assert.equal(migrated.normalizedLegacyReceipt,true);
assert.equal(migrated.updated.newProposalIds.length,0);
assert.equal(migrated.updated.contextRecheckIds.length,0);
assert.equal(migrated.annotated.proposals[0].firstObservedByPermitPlateAt,T0);
assert.equal(migrated.annotated.proposals[0].monitoringStatus,'ALREADY_TRACKED');
assert.equal(migrated.annotated.customerDeliveryAllowed,false);
assert.equal(migrated.annotated.automaticMerges,0);

const tampered=structuredClone(persisted);
tampered.proposals[0].candidateName='MODIFIED ENTITY';
assert.equal(recovery.normalizeReceipt(tampered).ready,false);
const invented=structuredClone(persisted);
invented.proposals[0].sourceRowFingerprint='fabricated';
assert.equal(recovery.normalizeReceipt(invented).ready,false);
const changedReceipt=structuredClone(persisted);
changedReceipt.observedAt='2026-10-19T05:00:00Z';
assert.equal(recovery.normalizeReceipt(changedReceipt).ready,false);
const partial=structuredClone(persisted);
partial.proposals[0].sourceRecordIds[0]='DOB_NOW:MISMATCH';
assert.equal(recovery.normalizeReceipt(partial).ready,false);
const annotated=structuredClone(persisted);
annotated.identityHistoryVersion='PermitPlate-identity-triage-history-v1.0.0';
assert.equal(recovery.normalizeReceipt(annotated).ready,false);
assert.equal(runner.prepareIdentityHistory(null,annotated,fresh).ready,false);
console.log('Historical proof normalization, strict checksum recovery and private first-observation preservation passed.');
