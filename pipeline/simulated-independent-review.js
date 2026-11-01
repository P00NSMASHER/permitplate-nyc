'use strict';

// Deterministic fake reviewer perspectives for test-only safety checks.
// No person is impersonated. Never call a synthetic vote an independent label.
const cohortLib=require('./calibration-cohort');
const evaluator=require('./calibration-evaluation');
const scoringPolicy=require('./scoring-policy');

const VERSION='PermitPlate-simulated-review-panels-v1.0.0';
const REVIEWER_MODES=Object.freeze([
  'SOURCE_STRICT','RESEARCH_CONTEXT','ADVERSARIAL_UNCERTAINTY'
]);
const CATEGORY_TERMS=Object.freeze({
  POS:/\b(?:point.of.sale|payment.processing|pos.system)\b/i,
  Insurance:/\b(?:insurance|underwriting|liability.policy)\b/i,
  Equipment:/\b(?:equipment|installation|commercial.kitchen|hvac)\b/i
});
const DISPOSITION=Object.freeze([
  'WATCH','NOT_RELEVANT','INSUFFICIENT_EVIDENCE'
]);
const NO_SEND='NO_SEND';
const STRICT_STATUS='SIMULATED_QA_ONLY_NO_INDEPENDENT_ATTESTATION';

function evidenceText(card){
  return (Array.isArray(card?.evidence)?card.evidence:[])
    .map(row=>Object.values(row?.facts||{}).filter(value=>
      typeof value==='string'||typeof value==='number').join(' '))
    .join(' ').slice(0,20_000);
}

function officialEvidence(card){
  return (Array.isArray(card?.evidence)?card.evidence:[]).some(row=>{
    if(!row||typeof row.recordId!=='string')return false;
    try{
      const u=new URL(row.sourceUrl);
      return u.protocol==='https:'&&
        ['data.cityofnewyork.us','data.ny.gov'].includes(u.hostname)&&
        !u.username&&!u.password&&!u.port&&!u.hash;
    }catch{return false;}
  });
}

function syntheticVerdict(card,category,mode){
  if(!REVIEWER_MODES.includes(mode))throw Error('SIMULATED_MODE_UNKNOWN');
  if(!Object.prototype.hasOwnProperty.call(CATEGORY_TERMS,category))
    throw Error('SIMULATED_CATEGORY_UNSUPPORTED');
  if(card?.identityCaveat)return 'NOT_RELEVANT';
  if(card?.eventTimeStatus!=='KNOWN'||!card.businessEventDate||!officialEvidence(card))
    return 'INSUFFICIENT_EVIDENCE';
  if(mode==='ADVERSARIAL_UNCERTAINTY')
    return 'INSUFFICIENT_EVIDENCE';
  if(mode==='RESEARCH_CONTEXT')return 'WATCH';
  return CATEGORY_TERMS[category].test(evidenceText(card))?
    'WATCH':'INSUFFICIENT_EVIDENCE';
}

function simulatedReviewEnvelopes(cohort){
  cohortLib.validateCohort(cohort);
  if(cohort.isSynthetic!==true)throw Error('SIMULATION_REQUIRES_SYNTHETIC_COHORT');
  const packet=cohortLib.blindPacket(cohort,'TUNING');
  if(packet.isSynthetic!==true||
     packet.cards.some(card=>['predictions','scores','v3','v4','split','panel']
       .some(key=>Object.prototype.hasOwnProperty.call(card,key))))
    throw Error('BLIND_PACKET_LEAKAGE');
  const reviewedAt=new Date(Date.parse(cohort.observedAt)+60*60*1000).toISOString();
  const reviewers=REVIEWER_MODES.map(mode=>({
    version:cohortLib.VERSION,
    phase:'TUNING',
    cohortFingerprint:cohort.fingerprint,
    packetFingerprint:packet.fingerprint,
    lockFingerprint:packet.lockFingerprint,
    reviewerId:'SIMULATED_'+mode,
    reviewerRole:'AUTOMATED_TEST_PERSONA',
    attestation:'SIMULATION_NOT_INDEPENDENT_HUMAN_SOURCE_REVIEW',
    blinded:true,
    isSynthetic:true,
    judgments:packet.cards.flatMap(card=>cohort.categories.map(category=>({
      caseId:card.caseId,
      category,
      evidenceFingerprint:card.evidenceFingerprint,
      verdict:syntheticVerdict(card,category,mode),
      reason:'SIMULATION ONLY; deterministic source-evidence QA, not buyer intent.',
      evidenceRefs:(card.evidence||[]).slice(0,1).map(row=>row.recordId),
      reviewedAt
    })))
  }));
  return {packet,reviewers};
}

function runSyntheticReview(cohort){
  const {packet,reviewers}=simulatedReviewEnvelopes(cohort);
  const lockAt=new Date(Date.parse(cohort.observedAt)+2*60*60*1000).toISOString();
  const attemptedLock=evaluator.lockThresholds(cohort,reviewers.slice(0,2),lockAt);
  const attemptedPromotion=scoringPolicy.evaluateCanonicalPromotionEvidence({
    graphState:'COMPLETE',shadowCoverageRate:1,
    currentOverlap:0,currentExactAllCategoryRate:null,
    currentBestFitAgreementRate:null,
    historicalRecordCount:47,historicalExactRowRate:1,
    historicalFitAgreementRate:1,historicalBestFitAgreementRate:1,
    documentedLegacyAnomalyIds:['50192386','50192550'],
    transportMode:NO_SEND
  });
  if(attemptedLock.status!=='BLOCKED'||
     !attemptedLock.failures.includes('SYNTHETIC_COHORT_NOT_REAL_REVIEW')||
     attemptedPromotion.canaryReady!==false||
     !attemptedPromotion.failures.includes('CURRENT_OVERLAP_TOO_SMALL')){
    throw Error('SIMULATION_ACCIDENTALLY_AUTHORIZED_PRODUCTION');
  }
  const results={};
  let disagreements=0,simulatedVotes=0;
  for(const mode of REVIEWER_MODES){
    const reviewer=reviewers.find(x=>x.reviewerId==='SIMULATED_'+mode);
    const count=Object.fromEntries(DISPOSITION.map(x=>[x,0]));
    for(const judgement of reviewer.judgments){
      count[judgement.verdict]++;
      simulatedVotes++;
    }
    results[mode]=count;
  }
  for(let i=0;i<reviewers[0].judgments.length;i++){
    if(new Set(reviewers.map(r=>r.judgments[i].verdict)).size>1)disagreements++;
  }
  const core={
    version:VERSION,status:STRICT_STATUS,cohortFingerprint:cohort.fingerprint,
    simulatedReviewModes:[...REVIEWER_MODES],
    sampledCases:packet.cards.length,
    simulatedVotes,simulatedDisagreements:disagreements,
    bySimulatedMode:results,
    lockedHoldoutCases:cohort.counts.holdout,
    holdoutReleased:false,syntheticCohort:true,
    realIndependentReviewerCount:0,verifiedHumanLabels:0,
    actualBuyerDemandValidated:false,actualSalesValidated:false,
    noSendBoundary:NO_SEND,externalSendCalls:0,productionStateWrites:0,
    scoringPromotionAllowed:false,customerDeliveryAllowed:false,
    actualProductionApproval:false,
    calibrationGate:attemptedLock.status,
    calibrationGateFailures:attemptedLock.failures,
    promotionGate:attemptedPromotion.canaryReady===true?'READY':'BLOCKED',
    promotionGateFailures:attemptedPromotion.failures,
    limitations:[
      'These three perspectives are deterministic software rules, not independent humans.',
      'Results cannot prove buyer need, calibrated precision, source authentication or eligibility.',
      'Original scoring thresholds and reserved holdout remain unchanged and inaccessible.',
      'All outcomes are simulated fixture QA; no customer or production contact occurs.'
    ]
  };
  return {...core,fingerprint:cohortLib.hash(core)};
}

function verifyReceipt(result){
  if(!result||result.status!==STRICT_STATUS||
     result.scoringPromotionAllowed!==false||
     result.customerDeliveryAllowed!==false||
     result.actualProductionApproval!==false||
     result.realIndependentReviewerCount!==0||
     result.verifiedHumanLabels!==0||
     result.holdoutReleased!==false||
     result.externalSendCalls!==0||result.productionStateWrites!==0)return false;
  const {fingerprint,...core}=result;
  return typeof fingerprint==='string'&&fingerprint===cohortLib.hash(core);
}

module.exports={
  VERSION,REVIEWER_MODES,CATEGORY_TERMS,STRICT_STATUS,
  evidenceText,officialEvidence,syntheticVerdict,
  simulatedReviewEnvelopes,runSyntheticReview,verifyReceipt
};
