'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('./calibration-cohort');
const sim=require('./calibration-simulated-reviewers');
const review=require('./calibration-evaluation');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');

const AT='2026-10-19T13:00:00.000Z';
const REVIEW_TIME='2026-10-19T14:46:00.000Z';
function fixtureCards(){
  const unknown={
    caseId:'CASE-c3fe3e4edbb12e08eaab',
    evidenceFingerprint:'a'.repeat(64),businessName:'BRIAR COFFEE & GRILL',
    businessEventDate:null,eventTimeStatus:'UNKNOWN',
    evidence:[{sourceSystem:'DOHMH',
      eventType:'DOHMH_APPLICANT_RECORD',
      recordId:'DOHMH:50110000:1900-01-01:fixture',
      facts:{inspection_date:'1900-01-01T00:00:00.000'}}]
  };
  const dated={
    caseId:'CASE-c3fe3e4edbb12e08eaac',
    evidenceFingerprint:'b'.repeat(64),businessName:'PIZZA TEST KITCHEN',
    businessEventDate:'2026-10-14',eventTimeStatus:'KNOWN',
    evidence:[{sourceSystem:'DOHMH',
      eventType:'DOHMH_PRE_PERMIT_EVENT',
      recordId:'DOHMH:50110001:2026-10-14:fixture',
      facts:{inspection_date:'2026-10-14T00:00:00.000',
        inspection_type:'Pre-permit (Operational) / Initial Inspection'}}]
  };
  const uncertain={
    caseId:'CASE-c3fe3e4edbb12e08eaad',
    evidenceFingerprint:'c'.repeat(64),businessName:'UNSPECIFIED 12 LLC',
    businessEventDate:null,eventTimeStatus:'UNKNOWN',
    evidence:[{sourceSystem:'DOHMH',
      eventType:'DOHMH_APPLICANT_RECORD',
      recordId:'DOHMH:50110002:1900-01-01:fixture',
      facts:{inspection_date:'1900-01-01T00:00:00.000'}}]
  };
  return [unknown,dated,uncertain];
}
function packet(cards){
  return c.sealed({version:c.VERSION,cohortId:'COHORT-SIMULATED-UNIT',
    cohortFingerprint:'d'.repeat(64),
    phase:'TUNING',lockFingerprint:null,
    categories:['Equipment'],isSynthetic:false,
    observedAt:AT,cards,
    instructions:'Reviewer must judge source evidence without model predictions.'});
}
test('Two simulated reviewers evaluate only blind evidence, never become real reviewers',()=>{
  const p=packet(fixtureCards());
  const envelopes=sim.simulate(p,REVIEW_TIME);
  assert.equal(envelopes.length,2);
  assert.notEqual(envelopes[0].reviewerId,envelopes[1].reviewerId);
  for(const e of envelopes){
    assert.equal(e.isSynthetic,true);
    assert.equal(e.blinded,true);
    assert.equal(e.attestation,'SIMULATED_MODEL_REVIEW_NOT_INDEPENDENT_HUMAN');
    assert.equal(e.provenance.reviewerIsRealPerson,false);
    assert.equal(e.provenance.independentlyVerified,false);
    assert.equal(e.judgments.length,p.cards.length);
    assert(e.judgments.every(j=>j.evidenceRefs.length===1&&
      p.cards.some(card=>card.caseId===j.caseId&&
        card.evidenceFingerprint===j.evidenceFingerprint&&
        card.evidence.some(evidence=>j.evidenceRefs.includes(evidence.recordId)))));
    assert(e.judgments.every(j=>j.reason.length>=12));
    assert(!JSON.stringify(e).includes('"predictions"'));
    assert(!JSON.stringify(e).includes('INDEPENDENT_HUMAN_SOURCE_REVIEW'));
  }
  assert.equal(envelopes[0].judgments[0].verdict,'WATCH');
  assert.equal(envelopes[1].judgments[0].verdict,'INSUFFICIENT_EVIDENCE');
  assert.equal(envelopes[0].judgments[1].verdict,'WATCH');
  assert.equal(envelopes[1].judgments[1].verdict,'WATCH');
  const summary=sim.summarize(p,envelopes);
  assert.equal(summary.uniqueBlindCases,3);
  assert.equal(summary.simulatedJudgments,6);
  assert.equal(summary.disagreementCases,1);
  assert.equal(summary.exactAgreementCases,2);
  assert.equal(summary.productionAuthorized,false);
  assert.equal(summary.humanCalibrationSubstitute,false);
  assert.equal(summary.holdoutOpened,false);
  assert.equal(summary.actualIndependentHumanReviews,0);
  assert.equal(summary.externalSendCalls,0);
});
test('Reject scores in input, forged packet fingerprints and fake reviewer metadata',()=>{
  const p=packet(fixtureCards());
  const bad=structuredClone(p);
  bad.cards[0].predictions={Equipment:100};
  bad.fingerprint=c.hash((( {fingerprint,...rest})=>rest)(bad));
  assert.throws(()=>sim.simulate(bad,REVIEW_TIME),/BLIND_SOURCE_PACKET_REQUIRED/);
  const forged=structuredClone(p);forged.cards[0].businessName='CHANGED';
  assert.throws(()=>sim.simulate(forged,REVIEW_TIME),/BLIND_SOURCE_PACKET_REQUIRED/);
  assert.throws(()=>sim.simulate(p,'2026-10-18T00:00:00Z'),/SIMULATION_TIME_INVALID/);
  const out=sim.simulate(p,REVIEW_TIME);
  out[0].isSynthetic=false;
  assert.throws(()=>sim.summarize(p,out),/TWO_COMPLETE_SYNTHETIC_REVIEWERS_REQUIRED/);
});
test('Production threshold-lock implementation rejects fabricated reviewer roles and attestations',()=>{
  const observedAt=new Date(Date.now()-3600000).toISOString();
  const row=adapters.normalizeDohmhRow({
    camis:'50110008',dba:'SIMULATION ONLY RESTAURANT',
    building:'11',street:'MOCK ST',boro:'Brooklyn',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:observedAt
  },{observedAt});
  const row2=adapters.normalizeDohmhRow({
    camis:'50110009',dba:'SECOND MOCK RESTAURANT',
    building:'99',street:'DIFFERENT AVENUE',boro:'Queens',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:observedAt
  },{observedAt});
  const batch=records=>({records,observation:{
    state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
    supportsPositiveObservation:records.length>0,
    supportsAbsenceConclusion:true}});
  const graph=builder.buildCurrentGraph({
    dohmhBatch:batch([row,row2]),slaBatch:batch([]),dobBatch:batch([])
  });
  const cohort=c.buildCohort({
    graph,batches:{DOHMH:batch([row,row2]),DOB_NOW:batch([]),SLA_PENDING:batch([])},
    observedAt,sourceRevision:'f'.repeat(40),
    codeHashes:{
      one:'a'.repeat(64),two:'b'.repeat(64),three:'c'.repeat(64)
    },
    isSynthetic:false,benchmarkSize:2,diagnosticSize:0,
    categories:['Equipment']
  });
  const blind=c.blindPacket(cohort);
  const envelopes=sim.simulate(blind,new Date().toISOString());
  // This is a unit-test-only mock cohort with valid review schema. Crucially,
  // the real gate still rejects explicitly simulated reviewer attestations.
  const actual=review.validateReviews(cohort,envelopes,'TUNING');
  assert(actual.errors.includes('INDEPENDENT_HUMAN_REVIEW_REQUIRED'));
  const verdict=sim.dryRunGate(cohort,envelopes,new Date().toISOString());
  assert.equal(verdict.status,'BLOCKED');
  assert.equal(verdict.productionAuthorized,false);
  assert.equal(verdict.independentHumanReviewsValidated,0);
  assert(verdict.failures.includes('INDEPENDENT_HUMAN_REVIEW_REQUIRED'));
});
