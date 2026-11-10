'use strict';

// This lane accepts the owner's explicit AI-substitution authorization for
// SOURCE-RELEVANCE EXPERIMENTS only. It never claims two independent humans,
// verified buyer outcomes, production scoring, or permission to send.
const cohortLib=require('./calibration-cohort');
const evaluation=require('./calibration-evaluation');
const authorization=require('../scoring/ai-proxy-review-owner-authorization.json');

const VERSION='PermitPlate-AI-proxy-calibration-gate-v1.0.0';
const ARTIFACT_VERSION='PermitPlate-AI-Proxy-Review-Evidence-v1.0.0';
const REVIEWER_TYPE='AI_SIMULATED_SOURCE_REVIEWER';
const ATTESTATION='AI_GENERATED_SOURCE_HEURISTIC_NOT_INDEPENDENT_HUMAN';
const LABELS=new Set(evaluation.VERDICTS);

function validTime(value,earliest,now){
  const d=typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(d)&&d>=Date.parse(earliest)&&d<=Date.parse(now);
}
function histogram(judgments){
  const out=Object.fromEntries([...LABELS].map(v=>[v,0]));
  for(const j of judgments)out[j.verdict]=(out[j.verdict]||0)+1;
  return out;
}
function evaluateAIProxy(cohort,artifact,nowIso=new Date().toISOString()){
  cohortLib.validateCohort(cohort);
  const packet=cohortLib.blindPacket(cohort);
  const errors=[],judgments=new Map(),reviewerJudgments=new Map();
  const source=artifact?.source||{};
  const expected=authorization.expectedReviewerCodes||[];
  if(cohort.isSynthetic!==false)errors.push('GENUINE_SOURCE_COHORT_REQUIRED');
  if(authorization.status!=='OWNER_AUTHORIZED_AI_REVIEW_SUBSTITUTION_FOR_EXPERIMENTAL_CALIBRATION'||
      authorization.allowAIProxyForTuningEvidence!==true||
      authorization.allowCustomerScoredFeed!==false||
      authorization.automaticPromotionAllowed!==false||
      authorization.automaticExternalSendAllowed!==false||
      authorization.allowAIProxyForHumanPrecisionClaim!==false||
      authorization.allowAIProxyForBuyerPrecisionClaim!==false||
      authorization.numericProtocolUnchanged!==true||
      authorization.privateEvidenceRunId!==source.blindPacketRunId||
      authorization.sourceRevision!==cohort.sourceRevision||
      authorization.permittedCategories.length!==1||
      authorization.permittedCategories[0]!=='Equipment'){
    errors.push('EXPLICIT_AI_PROXY_AUTHORIZATION_INVALID');
  }
  if(artifact?.version!==ARTIFACT_VERSION||artifact?.status!=='SIMULATED_ONLY_NO_HUMAN_VALIDATION'||
      artifact?.productionAuthorized!==false||artifact?.customerDeliveryAllowed!==false||
      artifact?.realIndependentHumanReviews!==0||artifact?.verifiedBuyerPrecision!==null||
      artifact?.externalSendCalls!==0){
    errors.push('AI_PROXY_ARTIFACT_SCOPE_INVALID');
  }
  if(source.sourceRevision!==cohort.sourceRevision||
      source.cohortFingerprint!==cohort.fingerprint||
      source.packetFingerprint!==packet.fingerprint||
      source.phase!=='TUNING'||source.category!=='Equipment'||
      source.caseCount!==packet.cards.length||
      !validTime(source.reviewedAt,cohort.observedAt,nowIso)){
    errors.push('AI_PROXY_SOURCE_BINDING_INVALID');
  }
  const reviewers=Array.isArray(artifact?.reviewers)?artifact.reviewers:[];
  if(reviewers.length!==2||expected.length!==2||
      reviewers.map(r=>r?.reviewerId).sort().join('|')!==
      expected.slice().sort().join('|')){
    errors.push('TWO_AUTHORIZED_AI_RUBRICS_REQUIRED');
  }
  const cards=new Map(packet.cards.map(card=>[card.caseId,card]));
  for(const r of reviewers){
    if(r?.version!==cohortLib.VERSION||r?.phase!=='TUNING'||
      r?.cohortFingerprint!==cohort.fingerprint||
      r?.packetFingerprint!==packet.fingerprint||
      r?.reviewerType!==REVIEWER_TYPE||
      r?.reviewerRole!=='AI_SIMULATED_NOT_HUMAN'||
      r?.attestation!==ATTESTATION||
      r?.independentHuman!==false||r?.isSynthetic!==true||
      r?.draft!==false||r?.blindedToModelScoresInRules!==true||
      typeof r?.rubric!=='string'||r.rubric.length<30||
      !Array.isArray(r.judgments)||r.judgments.length!==cards.size){
      errors.push('AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID');continue;
    }
    const byCase=new Map(),held=[];
    for(const j of r.judgments){
      const card=cards.get(j?.caseId);
      if(!card||j?.category!=='Equipment'||byCase.has(j.caseId)||
         j.evidenceFingerprint!==card.evidenceFingerprint||
         !LABELS.has(j.verdict)||
         typeof j.reason!=='string'||j.reason.trim().length<12||
         !Array.isArray(j.evidenceRefs)||j.evidenceRefs.length<1||
         j.evidenceRefs.some(ref=>!card.evidence.some(e=>e.recordId===ref))||
         !validTime(j.reviewedAt,cohort.observedAt,nowIso)||
         'predictions' in j||'scores' in j){
        errors.push('AI_JUDGMENT_INTEGRITY_INVALID');continue;
      }
      byCase.set(j.caseId,j);
      const key=j.caseId+'|Equipment';
      if(!judgments.has(key))judgments.set(key,[]);
      judgments.get(key).push({verdict:j.verdict,reviewerId:r.reviewerId});
      held.push(j);
    }
    if(byCase.size!==cards.size)errors.push('AI_REVIEWER_CASE_COVERAGE_INCOMPLETE');
    if(expected.includes(r.reviewerId))reviewerJudgments.set(r.reviewerId,held);
  }
  const tuning=cohort.rows.filter(row=>row.split==='TUNING');
  const consensus=errors.length===0?
    evaluation.consensus(tuning,'Equipment',judgments):
    {total:tuning.length,rows:[],missing:tuning.map(r=>r.caseId),
      disagreements:[],agreementRate:null,coverage:0};
  if(consensus.total<cohortLib.PROTOCOL.minimumTuningCases)
    errors.push('TUNING_SAMPLE_TOO_SMALL');
  if(consensus.missing.length)errors.push('TUNING_LABELS_INCOMPLETE');
  if(consensus.disagreements.length)errors.push('AI_PROXY_DISAGREEMENTS_UNRESOLVED');
  if(consensus.agreementRate===null||
      consensus.agreementRate<cohortLib.PROTOCOL.minimumReviewerAgreement)
    errors.push('AI_PROXY_AGREEMENT_TOO_SMALL');
  const metrics=[];
  for(const id of expected){
    const judgmentsFor=reviewerJudgments.get(id)||[];
    const byCase=new Map(judgmentsFor.map(j=>[j.caseId,j]));
    const rows=errors.some(e=>[
      'AI_PROXY_ARTIFACT_SCOPE_INVALID','AI_PROXY_SOURCE_BINDING_INVALID',
      'AI_RUBRIC_OR_JUDGMENT_ENVELOPE_INVALID','AI_JUDGMENT_INTEGRITY_INVALID',
      'AI_REVIEWER_CASE_COVERAGE_INCOMPLETE','TWO_AUTHORIZED_AI_RUBRICS_REQUIRED',
      'GENUINE_SOURCE_COHORT_REQUIRED','EXPLICIT_AI_PROXY_AUTHORIZATION_INVALID'
    ].includes(e))?[]:tuning.map(row=>({...row,
      positive:byCase.get(row.caseId)?.verdict==='PURSUE_NOW'}));
    const grid=rows.length===tuning.length?
      cohortLib.PROTOCOL.thresholds.map(t=>{
        const m=evaluation.metrics(rows,'Equipment','v4',t);
        return {threshold:t,selected:m.selected,
          aiProxyTruePositives:m.tp,aiProxyFalsePositives:m.fp,
          aiProxyPrecision:m.precision,
          aiProxyWilsonLower95:m.precisionWilsonLower95,
          meetsUnchangedNumericProtocol:evaluation.passes(m)};
      }):[];
    metrics.push({reviewerCode:id,simulatedLabels:histogram(judgmentsFor),
      diagnosticGrid:grid,anyThresholdPasses:grid.some(m=>m.meetsUnchangedNumericProtocol)});
  }
  if(metrics.some(x=>!x.anyThresholdPasses))errors.push('AI_PROXY_PRECISION_OR_SUPPORT_FAILED');
  const failures=[...new Set(errors)].sort();
  const passed=failures.length===0;
  return cohortLib.sealed({
    version:VERSION,mode:'OWNER_AUTHORIZED_AI_PROXY_TUNING_ONLY',
    sourceRevision:cohort.sourceRevision,cohortFingerprint:cohort.fingerprint,
    protocolId:cohortLib.PROTOCOL.id,reviewerSubstitutionAuthorized:true,
    reviewerTypes:'TWO_AI_RUBRICS_ONE_SYSTEM_NOT_INDEPENDENT_HUMANS',
    simulatedReviewerCount:reviewers.length,independentHumanReviewerCount:0,
    tuningCases:consensus.total,agreementRate:consensus.agreementRate,
    agreementCount:consensus.rows.length,disagreementCount:consensus.disagreements.length,
    missingCases:consensus.missing.length,category:'Equipment',
    minimumSelected:cohortLib.PROTOCOL.minimumSelected,
    minimumPrecision:cohortLib.PROTOCOL.minimumPrecision,
    minimumWilsonLower95:cohortLib.PROTOCOL.minimumWilsonLower95,
    minimumReviewerAgreement:cohortLib.PROTOCOL.minimumReviewerAgreement,
    simulatedReviewerMetrics:metrics,
    status:passed?'AI_PROXY_TUNING_DIAGNOSTIC_PASSED_HOLDOUT_REQUIRED':'AI_PROXY_CALIBRATION_BLOCKED',
    failures,aiProxyTuningGatePassed:passed,
    actualBuyerPrecision:null,verifiedBuyerPrecision:null,
    reviewerIndependenceVerified:false,thresholdLocked:false,holdoutReleased:false,
    productionAuthorized:false,customerDeliveryAllowed:false,externalSendCalls:0,
    nextActions:passed?
      ['PRESPECIFY_AND_EVALUATE_A_SEPARATE_LOCKED_HOLDOUT',
       'VERIFY_LONGITUDINAL_SOURCE_BEHAVIOR',
       'OBTAIN_SEPARATE_EXPLICIT_PRODUCTION_POLICY_APPROVAL']:
      ['DO_NOT_PROMOTE_AI_PROXY_RESULTS',
       'RECONCILE_DISAGREEMENTS_WITHOUT_EXPOSING_MODEL_SCORES',
       'COLLECT_VALID_SOURCE_RELEVANCE_SUPPORT'],
    limitation:'Owner-authorized simulated substitute reviews are not independent human evidence and their AI-proxy precision is NOT real-world buyer precision. A passing research diagnostic cannot authorize scored customer leads.'
  });
}
module.exports={VERSION,ARTIFACT_VERSION,REVIEWER_TYPE,ATTESTATION,evaluateAIProxy};
