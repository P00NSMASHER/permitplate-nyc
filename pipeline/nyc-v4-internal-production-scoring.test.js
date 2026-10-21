'use strict';
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const current=require('./run-current-graph');
const score=require('./nyc-v4-internal-production-scoring');
const delivery=require('./delivery-plan');

const NOW='2026-10-21T15:00:00.000Z';
function observation(sourceKey,records,state='COMPLETE_NONEMPTY'){
  return {
    observation:{
      observationId:'OBS:'+sourceKey,
      sourceId:adapters.SOURCE_CONFIGS[sourceKey].sourceId,
      state,sourceFresh:true,transportOk:true,cursorClosed:true,
      publisherCount:records.length,fetchedCount:records.length,
      supportsPositiveObservation:state==='COMPLETE_NONEMPTY',
      supportsAbsenceConclusion:state==='COMPLETE_NONEMPTY'||state==='VERIFIED_EMPTY'
    },
    records
  };
}
const record=(camis,boro,inspection,street)=>adapters.normalizeDohmhRow({
  camis,dba:'PUBLIC RESTAURANT '+camis,boro,
  building:'20',street,zipcode:'10001',
  inspection_date:inspection,
  inspection_type:inspection.startsWith('1900')?'':'Pre-permit (Non-operational) / Initial Inspection',
  record_date:'2026-10-20T06:00:27.000'
},{observedAt:NOW});
function fixture(){
  const rows=[
    record('59980101','Manhattan','2026-10-18T00:00:00.000','VALID PRE-PERMIT WAY'),
    record('59980102','Manhattan','1900-01-01T00:00:00.000','UNINSPECTED WAY'),
    record('59980103','0','1900-01-01T00:00:00.000','UNKNOWN BOROUGH WAY')
  ];
  const batches={
    DOHMH:observation('DOHMH',rows),
    DOB_NOW:observation('DOB_NOW',[],'VERIFIED_EMPTY'),
    SLA_PENDING:observation('SLA_PENDING',[],'VERIFIED_EMPTY')
  };
  const graph=builder.buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    dobBatch:batches.DOB_NOW,
    slaBatch:batches.SLA_PENDING,
    reviewedIdentityBridges:[]
  });
  assert.equal(graph.graphState,'COMPLETE');
  const publicGraph={
    graphState:'COMPLETE',passed:true,graphDigest:graph.graphDigest,
    observedAt:NOW,
    sourceObservations:Object.fromEntries(Object.entries(batches).map(([k,b])=>[k,b.observation])),
    candidates:graph.candidates.map(current.publicCandidate)
  };
  return {publicGraph,fullGraph:graph,batches,observedAt:NOW};
}
{
  const auth=score.validateOwnerAuthority(score.OWNER_AUTHORIZATION);
  assert.equal(auth.valid,true);
  assert.equal(auth.externalTransportAllowed,false);
  assert.equal(auth.buyerPrecisionKnown,false);
}
{
  const input=fixture(),r=score.scoreSnapshot(input);
  assert.equal(r.status,'ACTIVE_INTERNAL_PRODUCTION');
  assert.equal(r.internalProductionAuthorized,true);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.customerDeliveryAllowed,false);
  assert.equal(r.externalSendCalls,0);
  assert.equal(r.graphDigest,input.publicGraph.graphDigest);
  assert.equal(r.candidateCount,3);
  assert.equal(r.knownEventScoredCount,1);
  assert.equal(score.validateSnapshot(r).valid,true);
  const edited=JSON.parse(JSON.stringify(r));
  edited.researchRows[0].scores.Equipment=100;
  assert.equal(score.validateSnapshot(edited).valid,false);
  assert(score.validateSnapshot(edited).failures.includes('INTERNAL_SCORING_FINGERPRINT_INVALID'));
  assert.equal(r.unknownEventHeldCount,1);
  assert.equal(r.suppressedCount,1);
  assert.equal(r.researchRows.length,1);
  const row=r.researchRows[0];
  assert.equal(row.entityId,'CAMIS:59980101');
  assert.equal(row.eventDate,'2026-10-18');
  assert.equal(row.eventBasis,'DOHMH_INSPECTION_DATE');
  assert.equal(row.internalProductionAuthorized,true);
  assert.equal(row.productionAuthorized,false);
  assert.equal(row.customerDeliveryAllowed,false);
  assert.equal(row.buyerNeedVerified,false);
  assert.equal(row.confirmedOpening,false);
  assert.equal(row.scoringVersion,require('./shadow-scoring-v4').SHADOW_SCORING_VERSION);
  assert.deepEqual(Object.keys(row.scores).sort(),score.CATEGORIES.slice().sort());
  assert(Object.values(row.scores).every(n=>Number.isInteger(n)&&n>=0&&n<=39));
  assert(Object.values(row.categoryBases).every(b=>b==='APPLICANT_CONTEXT_ONLY'));
  assert(!Object.prototype.hasOwnProperty.call(row,'scoreReceiptId'));
  assert.match(row.internalScoreId,/^INTERNAL-V4:[a-f0-9]{24}$/);
  assert.equal(r.accuracy.verifiedBuyerPrecision,null);
  assert.equal(r.accuracy.verifiedBuyerRecall,null);
  assert.equal(r.accuracy.independentBuyerLabels,0);
  const repeat=score.scoreSnapshot(fixture());
  assert.equal(repeat.fingerprint,r.fingerprint);
  assert.deepEqual(repeat.researchRows,r.researchRows);
  // A private research-only receipt cannot be forged into scored customer delivery.
  const f=input.fullGraph.candidates.find(x=>x.camis==='59980101');
  const customer=delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:r.graphDigest,candidates:[f]},
    profile:{subscriberId:'local-no-send',baselineAt:'2026-10-18T00:00:00Z',
      category:'Equipment',boroughs:['Manhattan'],minimumScore:0,starterSnapshotEnabled:false},
    detectionReceipts:[],scoreReceipts:[row],deliveredSignalKeys:[]
  });
  assert.equal(customer.signals.length,0);
  // Even if a caller deliberately renames an internal-only score into the
  // delivery planner's expected receipt field, production authorization is
  // checked independently and must reject it.
  const forgedCandidate={...f,
    detectionReceiptId:'DET:INTERNAL-TO-CUSTOMER-PROBE',
    scoreReceiptId:'SCORE:FORGED-INTERNAL'};
  const fingerprint=delivery.candidateChangeFingerprint(forgedCandidate);
  const probe=delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:r.graphDigest,candidates:[forgedCandidate]},
    profile:{subscriberId:'local-no-send',baselineAt:'2026-10-18T00:00:00Z',
      category:'Equipment',boroughs:['Manhattan'],minimumScore:0,starterSnapshotEnabled:false},
    detectionReceipts:[{
      receiptId:forgedCandidate.detectionReceiptId,entityId:f.entityId,
      changeFingerprint:fingerprint,firstDetectedAt:NOW
    }],
    scoreReceipts:[{
      ...row,scoreReceiptId:forgedCandidate.scoreReceiptId,graphDigest:r.graphDigest,
      changeFingerprint:fingerprint
    }],
    deliveredSignalKeys:[]
  });
  assert.equal(probe.signals.length,0);
  assert(probe.reviews.some(x=>x.reasons.includes('SCORE_NOT_PRODUCTION_AUTHORIZED')));
}
{
  // Source-matched, same-premise/same-business pending SLA licensing provides
  // dated RELATED_OFFICIAL_ACTIVITY, not category-specific purchase proof.
  const input=fixture();
  const license=adapters.normalizeSlaPendingRow({
    application_id:'NYC-INTERNAL-V4-SLA-TEST',
    dba:'PUBLIC RESTAURANT 59980102',
    legalname:'PUBLIC RESTAURANT 59980102 LLC',
    actual_address_of_premises:'20 UNINSPECTED WAY',
    city:'NEW YORK',state_name:'NY',zip_code:'10001',
    received_date:'2026-10-19T00:00:00.000',status:'Pending',
    description:'Restaurant Wine'
  },{observedAt:NOW});
  input.batches.SLA_PENDING=observation('SLA_PENDING',[license]);
  input.fullGraph=builder.buildCurrentGraph({
    dohmhBatch:input.batches.DOHMH,
    dobBatch:input.batches.DOB_NOW,
    slaBatch:input.batches.SLA_PENDING,
    reviewedIdentityBridges:[]
  });
  input.publicGraph.graphDigest=input.fullGraph.graphDigest;
  input.publicGraph.candidates=input.fullGraph.candidates.map(current.publicCandidate);
  input.publicGraph.sourceObservations.SLA_PENDING=input.batches.SLA_PENDING.observation;
  const result=score.scoreSnapshot(input);
  assert.equal(result.status,'ACTIVE_INTERNAL_PRODUCTION');
  assert.equal(result.knownEventScoredCount,2);
  const correlated=result.researchRows.find(x=>x.camis==='59980102');
  assert(correlated);
  assert.equal(correlated.eventBasis,'SLA_APPLICATION_RECEIVED_DATE');
  assert.equal(correlated.eventDate,'2026-10-19');
  assert.equal(correlated.categoryBases.Insurance,'RELATED_OFFICIAL_ACTIVITY');
  assert(correlated.scores.Insurance<=54);
  assert.equal(correlated.productionAuthorized,false);
}
{
  const invalidAuthority={...score.OWNER_AUTHORIZATION,externalTransportAllowed:true};
  assert.equal(score.validateOwnerAuthority(invalidAuthority).valid,false);
}
{
  const f=fixture();
  f.publicGraph.sourceObservations.DOHMH.sourceFresh=false;
  const r=score.scoreSnapshot(f);
  assert.equal(r.status,'REVIEW');
  assert.equal(r.internalProductionAuthorized,false);
  assert.equal(r.researchRows.length,0);
  assert(r.failures.includes('OFFICIAL_SOURCE_INCOMPLETE_OR_STALE'));
}
{
  const f=fixture();
  f.fullGraph.graphDigest='fake-mismatched-digest';
  const r=score.scoreSnapshot(f);
  assert.equal(r.status,'REVIEW');
  assert(r.failures.includes('GRAPH_DIGEST_MISMATCH'));
}
{
  const f=fixture();
  const known=f.fullGraph.candidates.find(x=>x.camis==='59980101');
  known.borough='Queens';
  const r=score.scoreSnapshot(f);
  assert.equal(r.status,'REVIEW');
  assert(r.failures.includes('SOURCE_GRAPH_CANDIDATE_MISMATCH'));
}
console.log('NYC internal V4 production ranking: owner scope, full source, event chronology, caps, integrity and NO SEND passed.');
