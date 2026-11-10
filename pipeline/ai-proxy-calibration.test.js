'use strict';
// Regression fixtures are deliberately synthetic. Even when structural
// checks appear green, they are never real reviewers or production evidence.
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const c=require('./calibration-cohort');
const gate=require('./ai-proxy-calibration');
const authorization=require('../scoring/ai-proxy-review-owner-authorization.json');

const OBS='2026-09-20T12:00:00.000Z',REVIEW='2026-09-20T13:00:00.000Z';
const r=Array.from({length:110},(_,i)=>adapters.normalizeDohmhRow({
  camis:String(58820000+i),dba:'Synthetic Source Evidence '+i,
  building:String(100+i),street:'TEST ONLY AVE',boro:'Manhattan',
  zipcode:'10001',cuisine_description:'Coffee/Tea',
  inspection_date:'1900-01-01T00:00:00.000',
  record_date:'2026-09-20T00:00:00.000'
},{observedAt:OBS}));
const batch=records=>({records,observation:{
  state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
  supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true
}});
const batches={DOHMH:batch(r),DOB_NOW:batch([]),SLA_PENDING:batch([])};
const graph=builder.buildCurrentGraph({
  dohmhBatch:batches.DOHMH,dobBatch:batches.DOB_NOW,slaBatch:batches.SLA_PENDING
});
const synthetic=c.buildCohort({
  graph,batches,observedAt:OBS,sourceRevision:authorization.sourceRevision,
  codeHashes:{"source.js":"a".repeat(64),"model.js":"b".repeat(64),"calibration.js":"c".repeat(64)},
  categories:['Equipment'],benchmarkSize:100,diagnosticSize:0,isSynthetic:true
});
const {fingerprint,...body}=synthetic;
// Metadata exercise only; this does not turn synthetic records into real ones.
const fakeRealShape=c.sealed({...body,isSynthetic:false});
const packet=c.blindPacket(fakeRealShape);
function artifactFor(c0=fakeRealShape,options={}){
  const p=c.blindPacket(c0);
  const ids=authorization.expectedReviewerCodes;
  const reviewers=ids.map((reviewerId,i)=>({
    version:c.VERSION,phase:'TUNING',cohortFingerprint:c0.fingerprint,
    packetFingerprint:p.fingerprint,reviewerId,
    reviewerRole:'AI_SIMULATED_NOT_HUMAN',
    reviewerType:'AI_SIMULATED_SOURCE_REVIEWER',
    rubric:'Simulation of a specific source-evidence prioritization policy, not an independently tested reviewer.',
    attestation:'AI_GENERATED_SOURCE_HEURISTIC_NOT_INDEPENDENT_HUMAN',
    independentHuman:false,isSynthetic:true,draft:false,
    blindedToModelScoresInRules:true,
    judgments:p.cards.map((card,index)=>({
      caseId:card.caseId,category:'Equipment',
      evidenceFingerprint:card.evidenceFingerprint,
      verdict:options.allPositive?'PURSUE_NOW':
        index<(i===0?3:6)?'PURSUE_NOW':'INSUFFICIENT_EVIDENCE',
      reason:'Synthetic source benchmark rationale, not an actual buyer outcome or completed independent human review.',
      evidenceRefs:[card.evidence[0].recordId],reviewedAt:REVIEW
    }))
  }));
  const x={
    version:'PermitPlate-AI-Proxy-Review-Evidence-v1.0.0',
    status:'SIMULATED_ONLY_NO_HUMAN_VALIDATION',
    source:{blindPacketRunId:authorization.privateEvidenceRunId,
      sourceRevision:c0.sourceRevision,cohortFingerprint:c0.fingerprint,
      packetFingerprint:p.fingerprint,phase:'TUNING',category:'Equipment',
      caseCount:p.cards.length,reviewedAt:REVIEW},
    reviewers,productionAuthorized:false,customerDeliveryAllowed:false,
    verifiedBuyerPrecision:null,realIndependentHumanReviews:0,externalSendCalls:0
  };
  return x;
}

test('owner authorization is explicitly AI only, never human-precision or automatic promotion',()=>{
  assert.equal(authorization.status,
    'OWNER_AUTHORIZED_AI_REVIEW_SUBSTITUTION_FOR_EXPERIMENTAL_CALIBRATION');
  assert.equal(authorization.allowAIProxyForTuningEvidence,true);
  assert.equal(authorization.numericProtocolUnchanged,true);
  assert.equal(authorization.allowAIProxyForHumanPrecisionClaim,false);
  assert.equal(authorization.allowAIProxyForBuyerPrecisionClaim,false);
  assert.equal(authorization.allowCustomerScoredFeed,false);
  assert.equal(authorization.automaticPromotionAllowed,false);
  assert.equal(authorization.automaticExternalSendAllowed,false);
});
test('3-vs-6 simulated positives fail unchanged support and cannot unlock customer scores',()=>{
  const out=gate.evaluateAIProxy(fakeRealShape,artifactFor());
  assert.equal(out.mode,'OWNER_AUTHORIZED_AI_PROXY_TUNING_ONLY');
  assert.equal(out.tuningCases,70);
  assert.equal(out.simulatedReviewerCount,2);
  assert.equal(out.independentHumanReviewerCount,0);
  assert.equal(out.agreementCount,67);
  assert.equal(out.disagreementCount,3);
  assert(out.failures.includes('AI_PROXY_DISAGREEMENTS_UNRESOLVED'));
  assert(out.failures.includes('AI_PROXY_PRECISION_OR_SUPPORT_FAILED'));
  assert(out.simulatedReviewerMetrics.every(x=>!x.anyThresholdPasses));
  assert.equal(out.status,'AI_PROXY_CALIBRATION_BLOCKED');
  assert.equal(out.aiProxyTuningGatePassed,false);
  assert.equal(out.productionAuthorized,false);
  assert.equal(out.customerDeliveryAllowed,false);
  assert.equal(out.holdoutReleased,false);
  assert.equal(out.actualBuyerPrecision,null);
  assert.equal(out.externalSendCalls,0);
  assert(c.verify(out));
});
test('even hypothetical perfect AI proxy labels remain unvalidated, cannot promote',()=>{
  const out=gate.evaluateAIProxy(fakeRealShape,artifactFor(fakeRealShape,{allPositive:true}));
  assert.equal(out.disagreementCount,0);
  assert.equal(out.aiProxyTuningGatePassed,true);
  assert.equal(out.status,'AI_PROXY_TUNING_DIAGNOSTIC_PASSED_HOLDOUT_REQUIRED');
  assert.equal(out.productionAuthorized,false);
  assert.equal(out.customerDeliveryAllowed,false);
  assert.equal(out.verifiedBuyerPrecision,null);
  assert.equal(out.reviewerIndependenceVerified,false);
  assert.equal(out.holdoutReleased,false);
  assert.equal(out.thresholdLocked,false);
  assert.equal(out.externalSendCalls,0);
});
test('simulated cohort and mismatched source revision fail despite fabricated reviewer agreement',()=>{
  const a=gate.evaluateAIProxy(synthetic,artifactFor(synthetic,{allPositive:true}));
  assert(a.failures.includes('GENUINE_SOURCE_COHORT_REQUIRED'));
  assert.equal(a.productionAuthorized,false);
});
for(const [name,mutate,expected]of [
  ['missing one simulated rubric',a=>a.reviewers.pop(),'TWO_AUTHORIZED_AI_RUBRICS_REQUIRED'],
  ['claimed human reviewer',a=>a.reviewers[1].independentHuman=true,'AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID'],
  ['wrong attestation',a=>a.reviewers[1].attestation='INDEPENDENT_HUMAN_SOURCE_REVIEW','AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID'],
  ['draft instead of final review',a=>a.reviewers[1].draft=true,'AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID'],
  ['missing one judgment',a=>a.reviewers[0].judgments.pop(),'AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID'],
  ['wrong official source binding',a=>a.reviewers[1].judgments[0].evidenceRefs=['FORGED'],'AI_JUDGMENT_INTEGRITY_INVALID'],
  ['wrong packet fingerprint',a=>a.source.packetFingerprint='f'.repeat(64),'AI_PROXY_SOURCE_BINDING_INVALID'],
  ['forged buyer accuracy',a=>a.verifiedBuyerPrecision=1,'AI_PROXY_ARTIFACT_SCOPE_INVALID'],
  ['fake production authorization',a=>a.productionAuthorized=true,'AI_PROXY_ARTIFACT_SCOPE_INVALID']
])test(name+' fails closed',()=>{
  const artifact=artifactFor(fakeRealShape,{allPositive:true});mutate(artifact);
  const out=gate.evaluateAIProxy(fakeRealShape,artifact);
  assert(out.failures.includes(expected),JSON.stringify(out.failures));
  assert.equal(out.aiProxyTuningGatePassed,false);
  assert.equal(out.productionAuthorized,false);
  assert.equal(out.customerDeliveryAllowed,false);
});
test('diagnostic output contains no reviewer notes or case IDs',()=>{
  const out=gate.evaluateAIProxy(fakeRealShape,artifactFor());
  const text=JSON.stringify(out);
  assert(!text.includes('Synthetic Source Evidence'));
  assert(!text.includes('Synthetic source benchmark rationale'));
  assert(!text.includes('CASE-'));
  assert(!text.includes('reviewedAt'));
});
test('unchanged sample and precision thresholds control both AI proxy and human gate',()=>{
  assert.equal(c.PROTOCOL.minimumTuningCases,50);
  assert.equal(c.PROTOCOL.minimumHoldoutCases,30);
  assert.equal(c.PROTOCOL.minimumSelected,20);
  assert.equal(c.PROTOCOL.minimumPrecision,0.8);
  assert.equal(c.PROTOCOL.minimumWilsonLower95,0.6);
  assert.equal(c.PROTOCOL.minimumReviewerAgreement,0.8);
  assert.equal(c.PROTOCOL.automaticPromotion,false);
});
