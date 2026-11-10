'use strict';

// Read-only operator diagnostics. The tool never creates reviewer labels,
// infers human identity, releases a hidden holdout, locks thresholds, or
// changes customer/production scoring policy.
const cohort=require('./calibration-cohort');
const review=require('./calibration-evaluation');

const VERSION='PermitPlate-blind-review-progress-v1.0.0';
function evaluateReviewProgress(input,reviewEnvelopes=[]){
  cohort.validateCohort(input);
  if(!Array.isArray(reviewEnvelopes))throw Error('REVIEW_ENVELOPES_ARRAY_REQUIRED');
  const checked=review.validateReviews(input,reviewEnvelopes,'TUNING');
  const tuning=input.rows.filter(row=>row.split==='TUNING');
  const categories={};
  for(const category of input.categories){
    const c=review.consensus(tuning,category,checked.judgments);
    categories[category]={
      tuningCases:c.total,
      acceptedConsensusCases:c.rows.length,
      missingCases:c.missing.length,
      disagreementCases:c.disagreements.length,
      reviewerAgreementRate:c.agreementRate,
      coverage:c.coverage
    };
  }
  const allComplete=Object.values(categories).every(c=>
    c.tuningCases>=cohort.PROTOCOL.minimumTuningCases&&
    c.missingCases===0&&c.disagreementCases===0&&
    c.coverage===1&&c.reviewerAgreementRate>=cohort.PROTOCOL.minimumReviewerAgreement
  );
  const errors=checked.errors.slice();
  const structuralComplete=checked.reviewerCount>=2&&
    errors.length===0&&allComplete&&input.isSynthetic===false;
  const status=input.isSynthetic===true?'SYNTHETIC_COHORT_INELIGIBLE':
    errors.length?'INVALID_OR_DRAFT_REVIEW_INPUT':
    checked.reviewerCount<2?'AWAITING_INDEPENDENT_REVIEW_EXPORTS':
    !allComplete?'INCOMPLETE_OR_DISAGREED_SOURCE_REVIEWS':
    'STRUCTURALLY_COMPLETE_MANUAL_IDENTITY_VERIFICATION_REQUIRED';
  const nextActions=structuralComplete?
    ['VERIFY_REAL_REVIEWER_IDENTITY_AND_INDEPENDENCE',
      'RUN_THRESHOLD_LOCK_AND_HIDDEN_HOLDOUT_EVALUATION',
      'OBTAIN_EXPLICIT_NEW_SCORING_PROMOTION_APPROVAL']:
    input.isSynthetic===true?['USE_GENUINE_SOURCE_LOCKED_COHORT']:
    errors.length?['CORRECT_INVALID_OR_DRAFT_REVIEW_EXPORTS']:
    checked.reviewerCount<2?['OBTAIN_TWO_COMPLETE_INDEPENDENT_TUNING_REVIEWS']:
    ['RESOLVE_EVIDENCE_DISAGREEMENTS_AND_COMPLETE_TUNING_REVIEW'];
  return cohort.sealed({
    version:VERSION,
    protocolId:cohort.PROTOCOL.id,
    sourceRevision:input.sourceRevision,
    sourceObservedAt:input.observedAt,
    cohortFingerprint:input.fingerprint,
    phase:'TUNING',
    status,
    reviewerCodesReceived:checked.reviewerCount,
    reviewerCodesRequired:2,
    submittedReviewFiles:reviewEnvelopes.length,
    // Counts only; never copy reviewer identifiers, reasons, verdicts,
    // score predictions, hidden case IDs, or private source rows.
    reviewerInputCounts:reviewEnvelopes.map(r=>({
      draft:r?.draft===true,
      submittedJudgments:Array.isArray(r?.judgments)?r.judgments.length:0
    })),
    categories,
    inputFailures:errors,
    structurallyCompleteNotAuthenticated:structuralComplete,
    reviewerIdentityIndependenceAuthenticated:false,
    thresholdLocked:false,
    holdoutReleased:false,
    productionAuthorized:false,
    customerDeliveryAllowed:false,
    externalSendCalls:0,
    nextActions,
    limitation:'Reviewer codes and self-attestation are not proof of two independent humans. Structural completeness does not validate model precision, purchase intent, sales, or permission to send.'
  });
}
module.exports={VERSION,evaluateReviewProgress};
