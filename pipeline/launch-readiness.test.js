'use strict';

const assert=require('assert');
const readiness=require('./launch-readiness');
const detection=require('./detection-ledger');
const opportunity=require('./opportunity-ledger');

function candidate(id){
  return {
    entityId:'CAMIS:'+id,
    projectSignalId:'PS:'+id,
    lifecycleStage:'JUST FILED',
    sourceLatestEffectiveAt:'2026-09-21T12:00:00Z',
    sourceSystems:['DOHMH'],
    commercialEvidence:[]
  };
}
function graph(state='COMPLETE'){
  return {
    graphState:state,
    graphDigest:'graph-launch-1',
    candidates:[candidate('1'),candidate('2')],
    metrics:{candidateCount:2}
  };
}
function currentScoring(overrides){
  return Object.assign({
    graphState:'COMPLETE',
    graphDigest:'graph-launch-1',
    shadow:{coverageRate:1},
    benchmark:{
      overlap:13,
      exactAllCategoryRowRate:1,
      bestFitAgreementRate:1
    }
  },overrides||{});
}
function historical(overrides){
  return Object.assign({
    recordCount:47,
    exactRowRate:1,
    fitAgreementRate:1,
    bestFitAgreementRate:1,
    mismatchCount:0,
    documentedLegacyAnomalies:[
      {camis:'50192386'},
      {camis:'50192550'}
    ]
  },overrides||{});
}
function promotion(overrides){
  return Object.assign({
    canaryReady:true,
    failures:[],
    evidenceFingerprint:'promotion-fp'
  },overrides||{});
}
function subscriberCanary(overrides){
  return Object.assign({
    passed:true,
    externalSendCalls:0,
    transportPreflight:{
      allowed:false,
      failures:['OWNER_AUTHORIZATION_MISSING']
    },
    artifactFingerprint:'subscriber-canary-fp',
    preferenceSource:'STRIPE_CUSTOM_FIELDS',
    preferenceReceiptId:'cs_canary_permitplate',
    checkoutSessionId:'cs_canary_permitplate',
    subscriptionId:'sub_canary',
    checkoutEmail:'canary@permitplate.invalid'
  },overrides||{});
}
function external(overrides){
  const base={
    evidenceVersion:'PermitPlate-external-launch-evidence-v1.1.0',
    observedAt:'2026-09-21T17:40:00Z',
    stripe:{
      checkoutPreferenceFieldsVerified:false,
      checkoutPreferenceFieldKeys:[],
      paymentLinkActiveVerified:true,
      customerPortalActiveVerified:false,
      customerPortalCancellationMode:null
    },
    githubPages:{
      enabled:false,
      verifiedPublicSourceFingerprint:null,
      verifiedPublicBuildCommit:null,
      liveVerifiedCommit:null,
      livePublicSourceFingerprint:null,
      productionDeployVerified:false
    },
    customerProof:{
      realPaidSubscriberEndToEndVerified:false,
      providerBackedDeliveryVerified:false,
      nextRunDuplicateSuppressionVerifiedForRealSubscriber:false
    }
  };
  const o=overrides||{};
  return {
    evidenceVersion:o.evidenceVersion||base.evidenceVersion,
    observedAt:o.observedAt||base.observedAt,
    stripe:Object.assign({},base.stripe,o.stripe||{}),
    githubPages:Object.assign({},base.githubPages,o.githubPages||{}),
    customerProof:Object.assign({},base.customerProof,o.customerProof||{})
  };
}
function readyExternal(overrides){
  const o=overrides||{};
  return external({
    stripe:Object.assign({
      checkoutPreferenceFieldsVerified:true,
      checkoutPreferenceFieldKeys:['category','starter','territory'],
      paymentLinkActiveVerified:true,
      customerPortalActiveVerified:true,
      customerPortalCancellationMode:'at_period_end'
    },o.stripe||{}),
    githubPages:Object.assign({
      enabled:true,
      verifiedPublicSourceFingerprint:'public-source-fp',
      verifiedPublicBuildCommit:'build-commit',
      liveVerifiedCommit:'build-commit',
      livePublicSourceFingerprint:'public-source-fp',
      productionDeployVerified:true
    },o.githubPages||{}),
    customerProof:Object.assign({},o.customerProof||{}),
    observedAt:o.observedAt
  });
}
function internalInput(overrides){
  const g=graph();
  const boot=detection.bootstrapLedger(g,'2026-09-21T17:00:00Z');
  const input={
    graph:g,
    currentScoring:currentScoring(),
    historicalScoring:historical(),
    promotion:promotion(),
    detectionLedger:boot.ledger,
    opportunityLedger:opportunity.emptyLedger('2026-09-21T17:00:00Z'),
    subscriberCanary:subscriberCanary(),
    publicBuildFailures:[],
    currentPublicSourceFingerprint:'public-source-fp',
    externalEvidence:external(),
    evaluatedAt:'2026-09-21T18:00:00Z'
  };
  return Object.assign(input,overrides||{});
}

{
  const out=readiness.evaluateLaunchReadiness(internalInput());
  assert.equal(out.internalReady,true);
  assert.equal(out.firstCustomerOperationallyReady,false);
  assert.equal(out.commerciallyProven,false);
  assert.equal(out.launchState,'EXTERNAL_INTEGRATION_BLOCKED');
  assert.deepEqual(out.internalFailures,[]);
  assert(out.firstCustomerExternalFailures.includes('preferenceCaptureReady'));
  assert(out.firstCustomerExternalFailures.includes('stripeCustomerPortalActiveVerified'));
  assert(out.firstCustomerExternalFailures.includes('stripeCustomerPortalCancellationVerified'));
  assert(out.firstCustomerExternalFailures.includes('githubPagesEnabled'));
  assert(out.firstCustomerExternalFailures.includes('verifiedPublicBuildMatchesCurrentSource'));
  assert(out.firstCustomerExternalFailures.includes('githubPagesProductionDeployVerified'));
  assert(out.firstCustomerExternalFailures.includes('githubPagesLiveBuildIdentityVerified'));
  assert.equal(out.criticalPathClass,'EXTERNAL_INTEGRATION');
  assert(out.recommendedNextActions.includes('APPLY_AND_VERIFY_STRIPE_CHECKOUT_PREFERENCES'));
  assert(out.recommendedNextActions.includes('CONFIGURE_AND_VERIFY_STRIPE_CUSTOMER_PORTAL'));
  assert(out.recommendedNextActions.includes('ENABLE_GITHUB_PAGES_ACTIONS_SOURCE'));
  assert(out.recommendedNextActions.includes('DEPLOY_VERIFIED_PUBLIC_ARTIFACT_TO_GITHUB_PAGES'));
  assert(!out.recommendedNextActions.includes('RUN_FIRST_REAL_PAID_SUBSCRIBER_ACCEPTANCE'));
  assert(out.deferredBlockers.some((item)=>item.class==='COMMERCIAL_PROOF'));
}

{
  const input=internalInput({graph:graph('PARTIAL')});
  input.graph.graphDigest='graph-launch-1';
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert.equal(out.launchState,'INTERNAL_BLOCKED');
  assert.equal(out.criticalPathClass,'INTERNAL');
  assert(out.internalFailures.includes('graphComplete'));
  assert(out.criticalPathBlockers.every((item)=>item.class==='INTERNAL'));
  assert(!out.recommendedNextActions.includes('DEPLOY_VERIFIED_PUBLIC_ARTIFACT_TO_GITHUB_PAGES'));
}

{
  const input=internalInput({
    currentScoring:currentScoring({
      shadow:{coverageRate:0.999},
      benchmark:{
        overlap:9,
        exactAllCategoryRowRate:0.9,
        bestFitAgreementRate:0.9
      }
    })
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('scoringCoverage'));
  assert(out.internalFailures.includes('currentScoreOverlapSufficient'));
  assert(out.internalFailures.includes('currentCategoryParity'));
  assert(out.internalFailures.includes('currentBestFitParity'));
}

{
  const input=internalInput({
    historicalScoring:historical({recordCount:46,exactRowRate:46/47,mismatchCount:1})
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('historicalSampleSufficient'));
  assert(out.internalFailures.includes('historicalCategoryParity'));
  assert(out.internalFailures.includes('historicalNoUnexpectedMismatch'));
}

{
  const input=internalInput();
  input.detectionLedger=JSON.parse(JSON.stringify(input.detectionLedger));
  input.detectionLedger.graphDigest='stale-graph';
  input.detectionLedger.ledgerFingerprint=detection.ledgerFingerprint(input.detectionLedger);
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('detectionGraphMatchesCurrent'));
}

{
  const input=internalInput({
    currentPublicSourceFingerprint:'current-source',
    externalEvidence:readyExternal({
      githubPages:{verifiedPublicSourceFingerprint:'old-source'}
    })
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,true);
  assert.equal(out.launchState,'EXTERNAL_INTEGRATION_BLOCKED');
  assert(out.firstCustomerExternalFailures.includes('verifiedPublicBuildMatchesCurrentSource'));
}

{
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:readyExternal({observedAt:'2026-09-19T12:00:00Z'})
  }));
  assert.equal(out.internalReady,true);
  assert.equal(out.launchState,'EXTERNAL_INTEGRATION_BLOCKED');
  assert(out.firstCustomerExternalFailures.includes('externalEvidenceFresh'));
  assert(out.recommendedNextActions.includes('REFRESH_EXTERNAL_LAUNCH_EVIDENCE'));
}

{
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:readyExternal()
  }));
  assert.equal(out.internalReady,true);
  assert.equal(out.firstCustomerOperationallyReady,true);
  assert.equal(out.commerciallyProven,false);
  assert.equal(out.launchState,'READY_FOR_FIRST_PAID_CUSTOMER');
  assert.deepEqual(out.firstCustomerExternalFailures,[]);
  assert.equal(out.commercialProofFailures.length,3);
  assert.equal(out.criticalPathClass,'COMMERCIAL_PROOF');
  assert(out.recommendedNextActions.includes('RUN_FIRST_REAL_PAID_SUBSCRIBER_ACCEPTANCE'));
  assert(!out.recommendedNextActions.includes('DEPLOY_VERIFIED_PUBLIC_ARTIFACT_TO_GITHUB_PAGES'));
}

{
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:readyExternal({
      githubPages:{
        liveVerifiedCommit:null,
        livePublicSourceFingerprint:'public-source-fp'
      }
    })
  }));
  assert.equal(out.externalGates.githubPagesLiveCommitMatchesVerifiedBuild,false);
  assert.equal(out.externalGates.githubPagesLivePublicSourceMatchesVerifiedBuild,true);
  assert.equal(out.externalGates.githubPagesLiveBuildIdentityVerified,true);
  assert.equal(out.firstCustomerOperationallyReady,true);
}

{
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:readyExternal({
      customerProof:{
        realPaidSubscriberEndToEndVerified:true,
        providerBackedDeliveryVerified:true,
        nextRunDuplicateSuppressionVerifiedForRealSubscriber:true
      }
    })
  }));
  assert.equal(out.internalReady,true);
  assert.equal(out.firstCustomerOperationallyReady,true);
  assert.equal(out.commerciallyProven,true);
  assert.equal(out.launchState,'PAID_CUSTOMER_PROVEN');
  assert.deepEqual(out.firstCustomerExternalFailures,[]);
  assert.deepEqual(out.commercialProofFailures,[]);
  assert.equal(out.criticalPathClass,null);
  assert.deepEqual(out.criticalPathBlockers,[]);
  assert.deepEqual(out.recommendedNextActions,[]);
}

{
  const missingFieldKey=readyExternal({
    stripe:{checkoutPreferenceFieldKeys:['category','starter']}
  });
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:missingFieldKey
  }));
  assert.equal(out.externalGates.stripeCheckoutPreferenceFieldsVerified,false);
  assert.equal(out.externalGates.preferenceCaptureReady,false);
  assert(out.firstCustomerExternalFailures.includes('preferenceCaptureReady'));
}

{
  const missingPortalCancellation=readyExternal({
    stripe:{customerPortalCancellationMode:'immediately'}
  });
  const out=readiness.evaluateLaunchReadiness(internalInput({
    externalEvidence:missingPortalCancellation
  }));
  assert.equal(out.externalGates.stripeCustomerPortalActiveVerified,true);
  assert.equal(out.externalGates.stripeCustomerPortalCancellationVerified,false);
  assert(out.firstCustomerExternalFailures.includes('stripeCustomerPortalCancellationVerified'));
}

{
  const input=internalInput({
    subscriberCanary:subscriberCanary({
      preferenceReceiptId:'cs_other'
    })
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('subscriberCanaryExactCheckoutCorrelation'));
}

{
  const input=internalInput({
    subscriberCanary:subscriberCanary({
      transportPreflight:{allowed:true,failures:[]}
    })
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('subscriberCanaryStopsWithoutOwnerAuth'));
}

{
  const input=internalInput({
    publicBuildFailures:['BACKEND_FILE_IN_PUBLIC_ALLOWLIST:test']
  });
  const out=readiness.evaluateLaunchReadiness(input);
  assert.equal(out.internalReady,false);
  assert(out.internalFailures.includes('publicBuildBoundaryClean'));
}

{
  const a=readiness.evaluateLaunchReadiness(internalInput());
  const b=readiness.evaluateLaunchReadiness(JSON.parse(JSON.stringify(internalInput())));
  assert.equal(a.readinessFingerprint,b.readinessFingerprint);
}

console.log('PermitPlate launch readiness controller tests passed.');
