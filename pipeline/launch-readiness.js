'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const detection=require('./detection-ledger');
const opportunity=require('./opportunity-ledger');
const scoringPolicy=require('./scoring-policy');
const firstSubscriber=require('./run-first-subscriber-canary');
const publicBuild=require('../build-site');

const LAUNCH_READINESS_VERSION='PermitPlate-launch-readiness-v1.3.0';
const EXTERNAL_EVIDENCE_MAX_AGE_MS=24*60*60*1000;

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function countBy(entries,field){
  const out={};
  for(const item of Object.values(entries||{})){
    const key=String(item&&item[field]||'UNKNOWN');
    out[key]=(out[key]||0)+1;
  }
  return out;
}
function publicSourceFingerprint(){
  const items=publicBuild.PUBLIC_FILES
    .map((file)=>({
      path:file,
      sha256:publicBuild.sha256File(path.join(publicBuild.ROOT,file))
    }))
    .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return sha256(items.map((item)=>item.path+':'+item.sha256).join('\n'));
}
function normalizeBool(value){ return value===true; }
function timeMs(value){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?ms:null;
}
function evidenceFresh(observedAt,evaluatedAt){
  const observed=timeMs(observedAt);
  const evaluated=timeMs(evaluatedAt);
  if(observed===null||evaluated===null||evaluated<observed) return false;
  return evaluated-observed<=EXTERNAL_EVIDENCE_MAX_AGE_MS;
}
function remediationFor(gate){
  const map={
    stripeCheckoutPreferenceFieldsVerified:'APPLY_AND_VERIFY_STRIPE_CHECKOUT_PREFERENCES',
    stripePaymentLinkActiveVerified:'VERIFY_STRIPE_PAYMENT_LINK_ACTIVE',
    preferenceCaptureReady:'APPLY_AND_VERIFY_STRIPE_CHECKOUT_PREFERENCES',
    verifiedPublicBuildMatchesCurrentSource:'REBUILD_DEPLOYABLE_PUBLIC_ARTIFACT',
    githubPagesEnabled:'ENABLE_GITHUB_PAGES_ACTIONS_SOURCE',
    githubPagesProductionDeployVerified:'DEPLOY_VERIFIED_PUBLIC_ARTIFACT_TO_GITHUB_PAGES',
    githubPagesLiveCommitKnown:'VERIFY_GITHUB_PAGES_LIVE_BUILD_IDENTITY',
    githubPagesLiveCommitMatchesVerifiedBuild:'ALIGN_GITHUB_PAGES_LIVE_DEPLOY_TO_VERIFIED_BUILD',
    githubPagesLiveBuildIdentityVerified:'VERIFY_GITHUB_PAGES_LIVE_BUILD_IDENTITY',
    externalEvidenceFresh:'REFRESH_EXTERNAL_LAUNCH_EVIDENCE',
    realPaidSubscriberEndToEndVerified:'RUN_FIRST_REAL_PAID_SUBSCRIBER_ACCEPTANCE',
    providerBackedDeliveryVerified:'RECONCILE_REAL_PROVIDER_DELIVERY',
    nextRunDuplicateSuppressionVerifiedForRealSubscriber:'VERIFY_REAL_NEXT_RUN_DEDUPE'
  };
  return map[gate]||('FIX_'+String(gate||'UNKNOWN').toUpperCase());
}

function evaluateLaunchReadiness(input){
  const data=input||{};
  const graph=data.graph||{};
  const current=data.currentScoring||{};
  const historical=data.historicalScoring||{};
  const promotion=data.promotion||{};
  const detectionLedger=data.detectionLedger||{};
  const opportunityLedger=data.opportunityLedger||{};
  const subscriberCanary=data.subscriberCanary||{};
  const external=data.externalEvidence||{};
  const publicBuildFailures=Array.isArray(data.publicBuildFailures)?data.publicBuildFailures:[];
  const currentPublicSourceFingerprint=data.currentPublicSourceFingerprint||null;
  const evaluatedAt=data.evaluatedAt||new Date().toISOString();

  const detValidation=detection.validateLedger(detectionLedger);
  const oppValidation=opportunity.validateLedger(opportunityLedger);
  const detStateCounts=countBy(detectionLedger.entries,'presenceState');
  const currentCandidateCount=Number(graph.metrics&&graph.metrics.candidateCount||
    (graph.candidates||[]).length||0);

  const internalGates={
    graphComplete:graph.graphState==='COMPLETE',
    graphHasDigest:Boolean(graph.graphDigest),
    scoringCoverage:Number(current.shadow&&current.shadow.coverageRate)===1,
    currentScoreOverlapSufficient:Number(current.benchmark&&current.benchmark.overlap)>=10,
    currentCategoryParity:Number(current.benchmark&&current.benchmark.exactAllCategoryRowRate)===1,
    currentBestFitParity:Number(current.benchmark&&current.benchmark.bestFitAgreementRate)===1,
    historicalSampleSufficient:Number(historical.recordCount)>=47,
    historicalCategoryParity:Number(historical.exactRowRate)===1,
    historicalFitParity:Number(historical.fitAgreementRate)===1,
    historicalBestFitParity:Number(historical.bestFitAgreementRate)===1,
    historicalNoUnexpectedMismatch:Number(historical.mismatchCount||0)===0,
    canonicalPromotionGate:promotion.canaryReady===true,
    productionScoringMode:
      scoringPolicy.PRODUCTION_SCORING_MODE==='CANONICAL_V3_WITH_LEGACY_FALLBACK',
    detectionLedgerValid:detValidation.valid===true,
    detectionGraphMatchesCurrent:
      Boolean(detectionLedger.graphDigest)&&
      detectionLedger.graphDigest===graph.graphDigest,
    detectionPresentCountMatchesCurrent:
      Number(detStateCounts.PRESENT||0)===currentCandidateCount,
    opportunityLedgerValid:oppValidation.valid===true,
    subscriberCanaryPassed:subscriberCanary.passed===true,
    subscriberCanaryNoSend:Number(subscriberCanary.externalSendCalls)===0,
    subscriberCanaryStopsWithoutOwnerAuth:
      subscriberCanary.transportPreflight&&
      subscriberCanary.transportPreflight.allowed===false&&
      (subscriberCanary.transportPreflight.failures||[])
        .includes('OWNER_AUTHORIZATION_MISSING'),
    subscriberCanaryUsesStripeCustomFields:
      subscriberCanary.preferenceSource==='STRIPE_CUSTOM_FIELDS'&&
      Boolean(subscriberCanary.preferenceReceiptId),
    subscriberCanaryExactCheckoutCorrelation:
      Boolean(subscriberCanary.checkoutSessionId)&&
      Boolean(subscriberCanary.subscriptionId)&&
      Boolean(subscriberCanary.checkoutEmail)&&
      subscriberCanary.preferenceReceiptId===subscriberCanary.checkoutSessionId,
    publicBuildBoundaryClean:publicBuildFailures.length===0
  };

  const internalFailures=Object.entries(internalGates)
    .filter(([,passed])=>passed!==true)
    .map(([name])=>name);
  const internalReady=internalFailures.length===0;

  const stripe=external.stripe||{};
  const githubPages=external.githubPages||{};
  const customerProof=external.customerProof||{};

  const expectedPreferenceKeys=['category','starter','territory'];
  const observedPreferenceKeys=Array.isArray(stripe.checkoutPreferenceFieldKeys)?
    stripe.checkoutPreferenceFieldKeys.slice().sort():[];
  const preferenceFieldKeysVerified=
    JSON.stringify(observedPreferenceKeys)===JSON.stringify(expectedPreferenceKeys);
  const preferenceCaptureReady=
    normalizeBool(stripe.paymentLinkActiveVerified) &&
    normalizeBool(stripe.checkoutPreferenceFieldsVerified) &&
    preferenceFieldKeysVerified;

  const externalGates={
    externalEvidenceFresh:evidenceFresh(external.observedAt,evaluatedAt),
    stripeCheckoutPreferenceFieldsVerified:
      normalizeBool(stripe.checkoutPreferenceFieldsVerified)&&preferenceFieldKeysVerified,
    stripePaymentLinkActiveVerified:normalizeBool(stripe.paymentLinkActiveVerified),
    preferenceCaptureReady,
    githubPagesEnabled:normalizeBool(githubPages.enabled),
    verifiedPublicBuildMatchesCurrentSource:
      Boolean(currentPublicSourceFingerprint)&&
      Boolean(githubPages.verifiedPublicSourceFingerprint)&&
      currentPublicSourceFingerprint===githubPages.verifiedPublicSourceFingerprint,
    githubPagesProductionDeployVerified:normalizeBool(githubPages.productionDeployVerified),
    githubPagesLiveCommitKnown:Boolean(githubPages.liveVerifiedCommit),
    githubPagesLiveCommitMatchesVerifiedBuild:
      Boolean(githubPages.liveVerifiedCommit)&&
      Boolean(githubPages.verifiedPublicBuildCommit)&&
      githubPages.liveVerifiedCommit===githubPages.verifiedPublicBuildCommit,
    githubPagesLivePublicSourceMatchesVerifiedBuild:
      Boolean(githubPages.livePublicSourceFingerprint)&&
      Boolean(githubPages.verifiedPublicSourceFingerprint)&&
      githubPages.livePublicSourceFingerprint===githubPages.verifiedPublicSourceFingerprint,
    realPaidSubscriberEndToEndVerified:
      normalizeBool(customerProof.realPaidSubscriberEndToEndVerified),
    providerBackedDeliveryVerified:
      normalizeBool(customerProof.providerBackedDeliveryVerified),
    nextRunDuplicateSuppressionVerifiedForRealSubscriber:
      normalizeBool(customerProof.nextRunDuplicateSuppressionVerifiedForRealSubscriber)
  };

  externalGates.githubPagesLiveBuildIdentityVerified=
    externalGates.githubPagesLiveCommitMatchesVerifiedBuild ||
    externalGates.githubPagesLivePublicSourceMatchesVerifiedBuild;

  const firstCustomerExternalGates={
    externalEvidenceFresh:externalGates.externalEvidenceFresh,
    stripePaymentLinkActiveVerified:externalGates.stripePaymentLinkActiveVerified,
    preferenceCaptureReady:externalGates.preferenceCaptureReady,
    githubPagesEnabled:externalGates.githubPagesEnabled,
    verifiedPublicBuildMatchesCurrentSource:externalGates.verifiedPublicBuildMatchesCurrentSource,
    githubPagesProductionDeployVerified:externalGates.githubPagesProductionDeployVerified,
    githubPagesLiveBuildIdentityVerified:externalGates.githubPagesLiveBuildIdentityVerified
  };

  const firstCustomerExternalFailures=Object.entries(firstCustomerExternalGates)
    .filter(([,passed])=>passed!==true)
    .map(([name])=>name);
  const firstCustomerOperationallyReady=
    internalReady&&firstCustomerExternalFailures.length===0;

  const commercialProofGates={
    realPaidSubscriberEndToEndVerified:externalGates.realPaidSubscriberEndToEndVerified,
    providerBackedDeliveryVerified:externalGates.providerBackedDeliveryVerified,
    nextRunDuplicateSuppressionVerifiedForRealSubscriber:
      externalGates.nextRunDuplicateSuppressionVerifiedForRealSubscriber
  };
  const commercialProofFailures=Object.entries(commercialProofGates)
    .filter(([,passed])=>passed!==true)
    .map(([name])=>name);
  const commerciallyProven=
    firstCustomerOperationallyReady&&commercialProofFailures.length===0;

  let launchState;
  if(!internalReady) launchState='INTERNAL_BLOCKED';
  else if(firstCustomerExternalFailures.length) launchState='EXTERNAL_INTEGRATION_BLOCKED';
  else if(commercialProofFailures.length) launchState='READY_FOR_FIRST_PAID_CUSTOMER';
  else launchState='PAID_CUSTOMER_PROVEN';

  const allBlockers=[
    ...internalFailures.map((gate)=>({class:'INTERNAL',gate,action:remediationFor(gate)})),
    ...firstCustomerExternalFailures.map((gate)=>({
      class:'EXTERNAL_INTEGRATION',gate,action:remediationFor(gate)
    })),
    ...commercialProofFailures.map((gate)=>({
      class:'COMMERCIAL_PROOF',gate,action:remediationFor(gate)
    }))
  ];
  const criticalPathClass=
    !internalReady?'INTERNAL':
    firstCustomerExternalFailures.length?'EXTERNAL_INTEGRATION':
    commercialProofFailures.length?'COMMERCIAL_PROOF':
    null;
  const criticalPathBlockers=criticalPathClass?
    allBlockers.filter((item)=>item.class===criticalPathClass):[];

  const result={
    readinessVersion:LAUNCH_READINESS_VERSION,
    launchState,
    internalReady,
    firstCustomerOperationallyReady,
    commerciallyProven,
    graph:{
      state:graph.graphState||null,
      digest:graph.graphDigest||null,
      candidateCount:currentCandidateCount
    },
    scoring:{
      productionMode:scoringPolicy.PRODUCTION_SCORING_MODE,
      coverageRate:current.shadow&&current.shadow.coverageRate!=null?
        current.shadow.coverageRate:null,
      currentOverlap:current.benchmark&&current.benchmark.overlap!=null?
        current.benchmark.overlap:null,
      currentExactAllCategoryRowRate:
        current.benchmark&&current.benchmark.exactAllCategoryRowRate!=null?
          current.benchmark.exactAllCategoryRowRate:null,
      currentBestFitAgreementRate:
        current.benchmark&&current.benchmark.bestFitAgreementRate!=null?
          current.benchmark.bestFitAgreementRate:null,
      historicalRecordCount:historical.recordCount!=null?historical.recordCount:null,
      historicalExactRowRate:historical.exactRowRate!=null?historical.exactRowRate:null
    },
    detection:{
      valid:detValidation.valid,
      errors:detValidation.errors,
      graphDigest:detectionLedger.graphDigest||null,
      stateCounts:detStateCounts,
      totalEntries:Object.keys(detectionLedger.entries||{}).length
    },
    opportunities:{
      valid:oppValidation.valid,
      errors:oppValidation.errors,
      totalEntries:Object.keys(opportunityLedger.entries||{}).length
    },
    subscriberCanary:{
      passed:subscriberCanary.passed===true,
      externalSendCalls:subscriberCanary.externalSendCalls!=null?
        subscriberCanary.externalSendCalls:null,
      transportPreflight:subscriberCanary.transportPreflight||null,
      artifactFingerprint:subscriberCanary.artifactFingerprint||null
    },
    publicBuild:{
      currentPublicSourceFingerprint,
      verifiedPublicSourceFingerprint:githubPages.verifiedPublicSourceFingerprint||null,
      verifiedPublicBuildCommit:githubPages.verifiedPublicBuildCommit||null,
      liveVerifiedCommit:githubPages.liveVerifiedCommit||null,
      livePublicSourceFingerprint:githubPages.livePublicSourceFingerprint||null,
      boundaryFailures:publicBuildFailures
    },
    externalEvidenceVersion:external.evidenceVersion||null,
    externalObservedAt:external.observedAt||null,
    evaluatedAt,
    externalEvidenceAgeMs:
      timeMs(external.observedAt)!==null&&timeMs(evaluatedAt)!==null?
        timeMs(evaluatedAt)-timeMs(external.observedAt):null,
    internalGates,
    internalFailures,
    externalGates,
    firstCustomerExternalFailures,
    commercialProofFailures,
    blockers:allBlockers,
    criticalPathClass,
    criticalPathBlockers,
    deferredBlockers:allBlockers.filter((item)=>item.class!==criticalPathClass)
  };
  result.recommendedNextActions=Array.from(new Set(
    criticalPathBlockers.map((item)=>item.action)
  ));
  result.readinessFingerprint=sha256(stableStringify(result));
  return result;
}

module.exports={
  LAUNCH_READINESS_VERSION,
  stableStringify,
  sha256,
  countBy,
  publicSourceFingerprint,
  evaluateLaunchReadiness
};
