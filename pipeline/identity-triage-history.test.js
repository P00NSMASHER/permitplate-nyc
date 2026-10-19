'use strict';
const assert=require('node:assert/strict');
const identity=require('./identity-bridge-review');
const h=require('./identity-triage-history');
const runner=require('./run-curated-research');
const {hash}=require('./independent-source-history');

const T0='2026-10-19T06:46:11.507Z';
const T1='2026-10-19T10:00:00.000Z';
const T2='2026-10-19T11:00:00.000Z';
const T3='2026-10-19T12:00:00.000Z';
function proposal(id,fields={}){
  const p=identity.createProposal({
    kind:'CAMIS_TO_EARLY_SOURCE',
    sourceRecordIds:['DOB_NOW:'+id],
    sourceRecordId:'DOB_NOW:'+id,
    candidateEntityId:'CAMIS:50110001',
    premiseKey:'MANHATTAN|100 MAIN ST',
    sourceSystem:'DOB_NOW',
    nameAgreement:'NOT_ESTABLISHED',
    reviewClass:'PREMISE_ONLY',
    competingCamisCount:1,
    officialSourceUrls:[
      'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number='+id,
      'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=50110001'
    ],
    sourceObservationId:'OBS:DOB_NOW',
    sourceRowFingerprint:'a'.repeat(64),
    dohmhRecordId:'DOHMH:50110001:initial',
    dohmhObservationId:'OBS:DOHMH',
    dohmhRowFingerprint:'b'.repeat(64),
    candidateName:'ONE RESTAURANT',
    sourceTradeName:null,sourceOwnerName:'OWNER LLC',
    sourceGraphFingerprint:'c'.repeat(64),
    ...fields
  });
  return p;
}
function receipt(t,proposals,omitted=0,extra={}){
  const body={
    version:identity.VERSION,status:'REVIEW_ONLY',
    observedAt:t,sourceGraphDigest:'d'.repeat(64),
    sourceArtifactFingerprint:'e'.repeat(64),
    sourceReviewFingerprint:'f'.repeat(64),
    totalProposals:proposals.length+omitted,
    storedCount:proposals.length,omittedByLimit:omitted,
    reviewQueueComplete:omitted===0,skippedWithoutDohmhProvenance:0,
    proposals,
    customerDeliveryAllowed:false,
    automaticIdentityLinkAllowed:false,
    automaticMerges:0,externalSendCalls:0,
    notices:['unverified identity research only'],...extra
  };
  return {...body,artifactFingerprint:hash(body)};
}
const a=proposal('M001-I1'),b=proposal('M002-I1');
const first=receipt(T0,[a,b]);
assert(identity.validate(first).valid);
const baseline=h.bootstrap(first);
assert.equal(baseline.status,'BASELINED');
assert.deepEqual(baseline.newProposalIds,[]);
assert.equal(h.validate(baseline.ledger).valid,true);
assert.equal(Object.keys(baseline.ledger.entries).length,2);
const annotatedBaseline=h.annotate(first,baseline.ledger,[],[],true);
assert.equal(annotatedBaseline.status,'REVIEW_ONLY');
assert.equal(annotatedBaseline.proposals[0].monitoringStatus,'BASELINE_EXISTING');
assert.equal(annotatedBaseline.proposals[0].firstObservedByPermitPlateAt,T0);
assert(identity.validate(annotatedBaseline).valid);
assert.equal(annotatedBaseline.customerDeliveryAllowed,false);

// Source observation IDs, graph fingerprints and timestamps are volatile
// receipts, NOT new business relationship context.
const recurred=receipt(T1,[
  proposal('M001-I1',{sourceObservationId:'OBS:DOB_NOW:REFRESH',
    sourceGraphFingerprint:'1'.repeat(64)}),
  proposal('M002-I1',{sourceObservationId:'OBS:DOB_NOW:REFRESH',
    sourceGraphFingerprint:'1'.repeat(64)})
],0,{sourceArtifactFingerprint:'2'.repeat(64)});
// One-time migration: use the old private workbench receipt as genesis,
 // then replay the new receipt without inventing 'new' relationships.
const migrated=runner.prepareIdentityHistory(null,first,recurred);
assert.equal(migrated.ready,true);
assert.equal(migrated.migrated,true);
assert.equal(migrated.updated.newProposalIds.length,0);
assert.equal(migrated.updated.contextRecheckIds.length,0);
assert.equal(migrated.annotated.proposals[0].firstObservedByPermitPlateAt,T0);
assert.equal(migrated.annotated.proposals[0].monitoringStatus,'ALREADY_TRACKED');
const destroyed=runner.prepareIdentityHistory(null,migrated.annotated,
  receipt(T2,[a,b]));
assert.equal(destroyed.ready,false);
assert(destroyed.failures.includes('IDENTITY_TRIAGE_HISTORY_MISSING'));
const firstEver=runner.prepareIdentityHistory(null,null,first);
assert.equal(firstEver.ready,true);
assert.equal(firstEver.bootstrapped,true);
assert.equal(firstEver.annotated.proposals[0].monitoringStatus,'BASELINE_EXISTING');
assert.equal(firstEver.updated.newProposalIds.length,0);
const repeated=h.advance(baseline.ledger,recurred);
assert.equal(repeated.status,'NO_NEW_HYPOTHESES');
assert.deepEqual(repeated.newProposalIds,[]);
assert.deepEqual(repeated.contextRecheckIds,[]);
assert.equal(repeated.ledger.entries[a.proposalId].firstObservedAt,T0);
assert.equal(repeated.ledger.entries[a.proposalId].lastObservedAt,T1);
const repeatReceipt=h.annotate(recurred,repeated.ledger);
assert.equal(repeatReceipt.proposals[0].monitoringStatus,'ALREADY_TRACKED');
assert.equal(repeatReceipt.proposals[0].firstObservedByPermitPlateAt,T0);

// New source relationship is a NEW HYPOTHESIS, never a verified new business.
const c=proposal('M003-I1');
const addition=receipt(T2,[a,b,c]);
const newer=h.advance(repeated.ledger,addition);
assert.equal(newer.status,'ADVANCED');
assert.deepEqual(newer.newProposalIds,[c.proposalId]);
assert.deepEqual(newer.contextRecheckIds,[]);
const annotatedNew=h.annotate(addition,newer.ledger,newer.newProposalIds,[]);
assert.equal(annotatedNew.proposals[2].monitoringStatus,'NEW_IDENTITY_HYPOTHESIS');
assert.equal(annotatedNew.proposals[2].firstObservedByPermitPlateAt,T2);
assert(annotatedNew.proposals.every(p=>p.automaticIdentityLinkAllowed===false));

// Actual source-row fingerprint or printed name changes warrant rechecking;
// never claim to have independently confirmed the business relationship.
const altered=proposal('M001-I1',{sourceOwnerName:'NEW OWNER LLC',
  sourceRowFingerprint:'3'.repeat(64)});
const changed=receipt(T3,[altered,b,c]);
const delta=h.advance(newer.ledger,changed);
assert.deepEqual(delta.newProposalIds,[]);
assert.deepEqual(delta.contextRecheckIds,[a.proposalId]);
assert.equal(delta.ledger.entries[a.proposalId].contextRecheckCount,1);
const current=h.annotate(changed,delta.ledger,[],delta.contextRecheckIds);
assert.equal(current.proposals[0].monitoringStatus,'SOURCE_CONTEXT_RECHECK');
assert.equal(current.proposals[0].lastContextRecheckAt,T3);
assert(identity.validate(current).valid);

// An omitted cap cannot establish absence or retrospectively reset first-seen.
const capped=receipt('2026-10-19T13:00:00Z',[altered],2);
const next=h.advance(delta.ledger,capped);
assert.equal(next.status,'NO_NEW_HYPOTHESES');
assert.equal(next.ledger.entries[b.proposalId].presenceState,h.CURRENT);
assert.equal(next.ledger.entries[c.proposalId].presenceState,h.CURRENT);
const vanished=receipt('2026-10-19T14:00:00Z',[altered]);
const gone=h.advance(next.ledger,vanished);
assert.equal(gone.ledger.entries[b.proposalId].presenceState,h.ABSENT);
assert.equal(gone.ledger.entries[b.proposalId].firstObservedAt,T0);
const returned=receipt('2026-10-19T15:00:00Z',[altered,b]);
const again=h.advance(gone.ledger,returned);
assert.deepEqual(again.newProposalIds,[]);
assert.equal(again.ledger.entries[b.proposalId].presenceState,h.CURRENT);
assert.equal(again.ledger.entries[b.proposalId].firstObservedAt,T0);

// Reject partial genesis instead of falsely baselining a capped queue.
assert.equal(h.bootstrap(receipt(T0,[a],2)).status,'REVIEW');
const corrupt=structuredClone(again.ledger);
corrupt.entries[a.proposalId].firstObservedAt=T3;
assert(h.validate(corrupt).failures.includes('IDENTITY_HISTORY_FINGERPRINT_INVALID'));
assert.equal(h.advance(again.ledger,receipt(T0,[a])).status,'REVIEW');
const sameClock=h.advance(again.ledger,receipt('2026-10-19T15:00:00Z',[a]));
assert(sameClock.failures.includes('IDENTITY_HISTORY_SAME_TIME_REWRITE'));
const forged=structuredClone(returned);
forged.proposals[0].candidateName='DIFFERENT BUSINESS';
assert.equal(h.advance(again.ledger,forged).status,'REVIEW');
const forgedContext=structuredClone(returned);
forgedContext.proposals[0].sourceOwnerName='FAKE';
const {artifactFingerprint:_old,...body}=forgedContext;
forgedContext.artifactFingerprint=hash(body);
assert(h.annotate(forgedContext,again.ledger).failures.includes('IDENTITY_HISTORY_CONTEXT_MISMATCH'));
// Hashes prove internal consistency, not independent source truth.
const resealed=h.seal(corrupt);
assert(h.validate(resealed).valid);
assert.equal(current.customerDeliveryAllowed,false);
assert.equal(current.automaticIdentityLinkAllowed,false);
assert.equal(current.externalSendCalls,0);
console.log('Identity triage history: stable first-observation, novelty, context recheck, capped windows and fail-closed gates passed.');
