'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const detection=require('./detection-ledger');
const opportunity=require('./opportunity-ledger');
const scoringPolicy=require('./scoring-policy');
const firstSubscriber=require('./run-first-subscriber-canary');
const publicBuild=require('../build-site');

const LAUNCH_READINESS_VERSION='PermitPlate-launch-readiness-v1.0.0';

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
    publicBuildBoundaryClean:publicBuildFailures.length===0
  };

  const internalFailures=Object.entries(internalGates)
    .filter(([,passed])=>passed!==true)
    .map(([name])=>name);
  const internalReady=internalFailures.length===0;

  const stripe=external.stripe||{};
  const netlify=external.netlify||{};
  const customerProof=external.customerProof||{};

  const externalGates={
    stripePaymentLinkWriteAuthorized:normalizeBool(stripe.paymentLinkWriteAuthorized),
    stripeCheckoutPreferenceFieldsVerified:normalizeBool(stripe.checkoutPreferenceFieldsVerified),
    verifiedPublicBuildMatchesCurrentSource:
      Boolean(currentPublicSourceFingerprint)&&
      Boolean(netlify.verifiedPublicSourceFingerprint)&&
      currentPublicSourceFingerprint===netlify.verifiedPublicSourceFingerprint,
    netlifyProductionDeployVerified:normalizeBool(netlify.productionDeployVerified),
    netlifyLiveCommitKnown:Boolean(netlify.liveVerifiedCommit),
    netlifyLiveCommitMatchesVerifiedBuild:
      Boolean(netlify.liveVerifiedCommit)&&
      Boolean(netlify.verifiedPublicBuildCommit)&&
      netlify.liveVerifiedCommit===netlify.verifiedPublicBuildCommit,
    realPaidSubscriberEndToEndVerified:
      normalizeBool(customerProof.realPaidSubscriberEndToEndVerified),
    providerBackedDeliveryVerified:
      normalizeBool(customerProof.providerBackedDeliveryVerified),
    nextRunDuplicateSuppressionVerifiedForRealSubscriber:
      normalizeBool(customerProof.nextRunDuplicateSuppressionVerifiedForRealSubscriber)
  };

  const firstCustomerExternalGates={
    stripePaymentLinkWriteAuthorized:externalGates.stripePaymentLinkWriteAuthorized,
    stripeCheckoutPreferenceFieldsVerified:externalGates.stripeCheckoutPreferenceFieldsVerified,
    verifiedPublicBuildMatchesCurrentSource:externalGates.verifiedPublicBuildMatchesCurrentSource,
    netlifyProductionDeployVerified:externalGates.netlifyProductionDeployVerified,
    netlifyLiveCommitKnown:externalGates.netlifyLiveCommitKnown,
    netlifyLiveCommitMatchesVerifiedBuild:externalGates.netlifyLiveCommitMatchesVerifiedBuild
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
      verifiedPublicSourceFingerprint:netlify.verifiedPublicSourceFingerprint||null,
      verifiedPublicBuildCommit:netlify.verifiedPublicBuildCommit||null,
      liveVerifiedCommit:netlify.liveVerifiedCommit||null,
      boundaryFailures:publicBuildFailures
    },
    externalEvidenceVersion:external.evidenceVersion||null,
    externalObservedAt:external.observedAt||null,
    internalGates,
    internalFailures,
    externalGates,
    firstCustomerExternalFailures,
    commercialProofFailures,
    blockers:[
      ...internalFailures.map((gate)=>({class:'INTERNAL',gate})),
      ...firstCustomerExternalFailures.map((gate)=>({class:'EXTERNAL_INTEGRATION',gate})),
      ...commercialProofFailures.map((gate)=>({class:'COMMERCIAL_PROOF',gate}))
    ]
  };
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
