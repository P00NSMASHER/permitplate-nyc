'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const cohortLib=require('./calibration-cohort');
const evaluator=require('./calibration-evaluation');
const policy=require('./scoring-policy');
const lab=require('./simulated-independent-review');

const OBS='2026-10-20T12:00:00.000Z';
const CODE={
  'scoring.js':'a'.repeat(64),
  'source-adapters.js':'b'.repeat(64),
  'review-simulator.js':'c'.repeat(64)
};

function fixture(n=140){
  const records=Array.from({length:n},(_,i)=>adapters.normalizeDohmhRow({
    camis:String(59900000+i),dba:'SYNTHETIC REVIEW CAFE '+i,
    building:String(100+i),street:'SYNTHETIC AVE',
    boro:'Manhattan',zipcode:'10001',
    cuisine_description:'Coffee/Tea',
    // Deliberately include source-dated and undated fictional cases so
    // conservative and contextual simulators can genuinely disagree.
    inspection_date:i%4===0?'2026-10-18T00:00:00.000':'1900-01-01T00:00:00.000',
    inspection_type:i%4===0?'Pre-permit (Non-operational) / Initial Inspection':'',
    record_date:'2026-10-20T00:00:00.000'
  },{observedAt:OBS}));
  const batch=items=>({
    records:items,
    observation:{
      state:items.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
      supportsPositiveObservation:items.length>0,
      supportsAbsenceConclusion:true
    }
  });
  const batches={DOHMH:batch(records),SLA_PENDING:batch([]),DOB_NOW:batch([])};
  const graph=builder.buildCurrentGraph({
    dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW
  });
  assert.equal(graph.graphState,'COMPLETE');
  return cohortLib.buildCohort({
    graph,batches,observedAt:OBS,sourceRevision:'d'.repeat(40),
    codeHashes:CODE,isSynthetic:true,
    benchmarkSize:100,diagnosticSize:24
  });
}

const card={
  identityCaveat:null,
  eventTimeStatus:'KNOWN',
  businessEventDate:'2026-10-19',
  evidence:[{
    recordId:'SYNTHETIC-1',
    sourceUrl:'https://data.cityofnewyork.us/resource/43nn-pn8j.json',
    facts:{inspection_type:'Installation of commercial kitchen equipment'}
  }]
};

test('simulates three distinct perspectives without buyer claims',()=>{
  assert.deepEqual(lab.REVIEWER_MODES,[
    'SOURCE_STRICT','RESEARCH_CONTEXT','ADVERSARIAL_UNCERTAINTY'
  ]);
  assert.equal(lab.syntheticVerdict(card,'Equipment','SOURCE_STRICT'),'WATCH');
  assert.equal(lab.syntheticVerdict(card,'Insurance','SOURCE_STRICT'),'INSUFFICIENT_EVIDENCE');
  assert.equal(lab.syntheticVerdict(card,'Insurance','RESEARCH_CONTEXT'),'WATCH');
  assert.equal(lab.syntheticVerdict(card,'Equipment','ADVERSARIAL_UNCERTAINTY'),'INSUFFICIENT_EVIDENCE');
  assert.throws(()=>lab.syntheticVerdict(card,'POS','REAL_HUMAN'),/SIMULATED_MODE_UNKNOWN/);
  assert.throws(()=>lab.syntheticVerdict(card,'BuyerIntent','SOURCE_STRICT'),/SIMULATED_CATEGORY_UNSUPPORTED/);
});

test('rejects claimed authority based on missing, stale or wrong-identity sources',()=>{
  const changed=structuredClone(card);
  changed.identityCaveat='Unverified operator identity';
  assert.equal(lab.syntheticVerdict(changed,'Equipment','SOURCE_STRICT'),'NOT_RELEVANT');
  changed.identityCaveat=null;changed.eventTimeStatus='UNKNOWN';
  assert.equal(lab.syntheticVerdict(changed,'Equipment','RESEARCH_CONTEXT'),'INSUFFICIENT_EVIDENCE');
  changed.eventTimeStatus='KNOWN';changed.evidence[0].sourceUrl=
    'https://data.cityofnewyork.us.evil.invalid/resource/43nn-pn8j.json';
  assert.equal(lab.syntheticVerdict(changed,'Equipment','RESEARCH_CONTEXT'),'INSUFFICIENT_EVIDENCE');
  changed.evidence[0].sourceUrl='javascript:alert(1)';
  assert.equal(lab.officialEvidence(changed),false);
});

test('runs 100-case benchmark in a simulated and sealed 70/30 split',()=>{
  const cohort=fixture();
  assert.deepEqual(cohort.counts,{
    graphCandidates:140,eligibleCandidates:140,eligibleSiteGroups:140,
    benchmark:100,holdout:30,tuning:70,diagnostic:24
  });
  const {packet,reviewers}=lab.simulatedReviewEnvelopes(cohort);
  assert.equal(packet.isSynthetic,true);
  assert.equal(packet.phase,'TUNING');
  assert.equal(packet.cards.length,94);
  assert.equal(reviewers.length,3);
  assert.equal(new Set(reviewers.map(x=>x.reviewerId)).size,3);
  for(const reviewer of reviewers){
    assert.equal(reviewer.isSynthetic,true);
    assert.equal(reviewer.attestation,'SIMULATION_NOT_INDEPENDENT_HUMAN_SOURCE_REVIEW');
    assert.equal(reviewer.blinded,true);
    assert.equal(reviewer.judgments.length,282);
    assert.equal(reviewer.judgments.every(j=>
      ['WATCH','NOT_RELEVANT','INSUFFICIENT_EVIDENCE'].includes(j.verdict)
    ),true);
  }
  for(const forbidden of ['predictions','scores','v3','v4','split','panel']){
    assert.equal(packet.cards.some(row=>Object.hasOwn(row,forbidden)),false);
  }
  const result=lab.runSyntheticReview(cohort);
  assert.equal(result.status,lab.STRICT_STATUS);
  assert.equal(result.sampledCases,94);
  assert.equal(result.simulatedVotes,846);
  assert(result.simulatedDisagreements>0,
    'the fictional benchmark must exercise competing reviewer outcomes');
  assert.equal(result.lockedHoldoutCases,30);
  assert.equal(result.holdoutReleased,false);
  assert.equal(result.realIndependentReviewerCount,0);
  assert.equal(result.verifiedHumanLabels,0);
  assert.equal(result.actualBuyerDemandValidated,false);
  assert.equal(result.scoringPromotionAllowed,false);
  assert.equal(result.customerDeliveryAllowed,false);
  assert.equal(result.actualProductionApproval,false);
  assert.equal(result.externalSendCalls,0);
  assert.equal(result.productionStateWrites,0);
  assert.equal(result.calibrationGate,'BLOCKED');
  assert(result.calibrationGateFailures.includes('SYNTHETIC_COHORT_NOT_REAL_REVIEW'));
  assert(result.promotionGateFailures.includes('CURRENT_OVERLAP_TOO_SMALL'));
  assert.equal(lab.verifyReceipt(result),true);
  assert.deepEqual(lab.runSyntheticReview(cohort),result);
  console.log(JSON.stringify({
    simulation:result.status,sampledCases:result.sampledCases,
    votes:result.simulatedVotes,reviewerModes:result.simulatedReviewModes,
    disagreements:result.simulatedDisagreements,
    lockedHoldoutCases:result.lockedHoldoutCases,
    realIndependentReviewerCount:0,productionAuthorized:false,
    customerDeliveryAllowed:false,simulatedReceiptFingerprint:result.fingerprint
  }));
});

test('rejects synthetic attestations even when a tester forges human fields',()=>{
  const cohort=fixture();
  const {reviewers}=lab.simulatedReviewEnvelopes(cohort);
  const later=new Date(Date.parse(cohort.observedAt)+2*3600_000).toISOString();
  for(const reviewer of reviewers.slice(0,2)){
    reviewer.attestation='INDEPENDENT_HUMAN_SOURCE_REVIEW';
    reviewer.reviewerRole='INDEPENDENT_DOMAIN_REVIEWER';
    reviewer.isSynthetic=false;
  }
  const lock=evaluator.lockThresholds(cohort,reviewers.slice(0,2),later);
  assert.equal(lock.status,'BLOCKED');
  assert.equal(lock.productionAuthorized,false);
  assert(lock.failures.includes('SYNTHETIC_COHORT_NOT_REAL_REVIEW'));
  assert.throws(()=>cohortLib.blindPacket(cohort,'HOLDOUT',lock),/HOLDOUT_REQUIRES_THRESHOLD_LOCK/);
});

test('synthetic-review tooling refuses real-looking source cohort',()=>{
  const cohort=fixture();
  const {fingerprint,...body}=cohort;
  const fakeReal=cohortLib.sealed({...body,isSynthetic:false});
  cohortLib.validateCohort(fakeReal);
  assert.throws(()=>lab.simulatedReviewEnvelopes(fakeReal),/SIMULATION_REQUIRES_SYNTHETIC_COHORT/);
  assert.throws(()=>lab.runSyntheticReview(fakeReal),/SIMULATION_REQUIRES_SYNTHETIC_COHORT/);
});

test('a manipulated synthetic receipt can never certify external approval',()=>{
  const receipt=lab.runSyntheticReview(fixture());
  assert.equal(lab.verifyReceipt({...receipt,scoringPromotionAllowed:true}),false);
  assert.equal(lab.verifyReceipt({...receipt,realIndependentReviewerCount:2}),false);
  assert.equal(lab.verifyReceipt({...receipt,externalSendCalls:1}),false);
  assert.equal(lab.verifyReceipt({...receipt,simulatedVotes:845}),false);
  assert.equal(lab.verifyReceipt({...receipt,holdoutReleased:true}),false);
});

test('original production policy remains locked despite every simulated review',()=>{
  const p=policy.evaluateCanonicalPromotionEvidence({
    graphState:'COMPLETE',shadowCoverageRate:1,currentOverlap:0,
    currentExactAllCategoryRate:1,currentBestFitAgreementRate:1,
    historicalRecordCount:47,historicalExactRowRate:1,
    historicalFitAgreementRate:1,historicalBestFitAgreementRate:1,
    documentedLegacyAnomalyIds:['50192386','50192550'],transportMode:'NO_SEND'
  });
  assert.equal(p.canaryReady,false);
  assert.equal(p.productionAuthorized,false);
  assert(p.failures.includes('CURRENT_OVERLAP_TOO_SMALL'));
  assert.equal(policy.PRODUCTION_SCORING_MODE,'CANONICAL_V3_WITH_LEGACY_FALLBACK');
});
