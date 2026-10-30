'use strict';

const fs=require('fs');
const path=require('path');
const {scanBatches}=require('./run-source-health');
const {buildCurrentGraph}=require('./candidate-builder');
const currentEval=require('./run-shadow-scoring-evaluation');
const historical=require('./historical-shadow-score-benchmark');
const scoringPolicy=require('./scoring-policy');
const firstSubscriber=require('./run-first-subscriber-canary');
const publicBuild=require('../build-site');
const readiness=require('./launch-readiness');
const curatedCanary=require('./run-founder-curated-canary');
const curatedProduction=require('./curated-production-readiness');
const stripeIntakeReadiness=require('./stripe-intake-readiness');
const externalRefresh=require('./refresh-launch-external-evidence');

const RUNNER_VERSION='PermitPlate-launch-readiness-runner-v1.3.0';

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
}
function readOptionalPrivateJson(filePath){
  try {return readJson(filePath);}
  catch(error){return null;} // Missing, malformed and inaccessible state must fail closed.
}
function promotionEvidenceFrom(current,historicalResult){
  return {
    graphState:current.graphState,
    shadowCoverageRate:current.shadow.coverageRate,
    currentOverlap:current.benchmark.overlap,
    currentExactAllCategoryRate:current.benchmark.exactAllCategoryRowRate,
    currentBestFitAgreementRate:current.benchmark.bestFitAgreementRate,
    historicalRecordCount:historicalResult.recordCount,
    historicalExactRowRate:historicalResult.exactRowRate,
    historicalFitAgreementRate:historicalResult.fitAgreementRate,
    historicalBestFitAgreementRate:historicalResult.bestFitAgreementRate,
    documentedLegacyAnomalyIds:(historicalResult.documentedLegacyAnomalies||[])
      .map((item)=>String(item.camis)),
    transportMode:'NO_SEND'
  };
}

async function run(options){
  const opts=options||{};
  const detectionPath=path.resolve(
    opts.detectionPath||path.join(__dirname,'..','state','detection-ledger.json')
  );
  const opportunityPath=path.resolve(
    opts.opportunityPath||path.join(__dirname,'..','state','opportunity-ledger.json')
  );
  const externalEvidencePath=path.resolve(
    opts.externalEvidencePath||
    path.join(__dirname,'..','verification','launch-external-evidence.json')
  );

  const {observedAt,batches}=await scanBatches(opts.nowIso);
  const graph=buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });
  const current=currentEval.evaluate(graph,batches,observedAt);
  const historicalResult=historical.evaluateHistoricalFixture();
  const promotion=scoringPolicy.evaluateCanonicalPromotionEvidence(
    promotionEvidenceFrom(current,historicalResult)
  );

  const detectionLedger=readJson(detectionPath);
  const opportunityLedger=readJson(opportunityPath);
  const curatedStateDir=path.dirname(detectionPath);
  const curatedResearch=curatedProduction.evaluate({
    snapshot:readOptionalPrivateJson(path.join(curatedStateDir,'curated-current-graph.json')),
    ledger:readOptionalPrivateJson(path.join(curatedStateDir,'curated-research-ledger.json')),
    anchor:readOptionalPrivateJson(path.join(curatedStateDir,'curated-baseline-anchor.json')),
    currentGraphDigest:graph.graphDigest,
    evaluatedAt:observedAt
  });
  // A green public Checkout receipt does not mean paid customers are being
  // checked. Require a private provider-readback heartbeat and an opted-in
  // recurring poll before claiming first-customer operational readiness.
  const stripeIntake=stripeIntakeReadiness.evaluate({
    monitoringEnabled:opts.stripeIntakeMonitoringEnabled===true ||
      process.env.PERMITPLATE_STRIPE_ONBOARDING_ENABLED==='true',
    ledger:readOptionalPrivateJson(path.join(
      curatedStateDir,'curated-onboarding-ledger.json')),
    anchor:readOptionalPrivateJson(path.join(
      curatedStateDir,'curated-onboarding-anchor.json')),
    evaluatedAt:observedAt
  });
  const subscriberCanary=firstSubscriber.run();
  const founderCuratedCanary=curatedCanary.run();
  const manifest=readJson(path.join(__dirname,'..','release-manifest.json'));
  const curatedFulfillmentRunbookPresent=fs.existsSync(
    path.join(__dirname,'..','operations','FOUNDER_CURATED_FULFILLMENT.md')
  );
  const publicBuildFailures=publicBuild.validateAllowlist();
  const currentPublicSourceFingerprint=readiness.publicSourceFingerprint();
  const refreshEnabled=opts.refreshExternalEvidence===true;
  const externalEvidence=refreshEnabled?await externalRefresh.refresh({
    key:opts.stripeReadKey,sourceCommit:opts.sourceCommit
  }):readJson(externalEvidencePath);
  // Public-source collection precedes provider verification. Evaluate freshness
  // at completion so a genuinely new receipt is not mistaken for future data.
  const evaluatedAt=refreshEnabled?new Date().toISOString():observedAt;
  if(refreshEnabled&&opts.externalEvidenceOutputPath){
    fs.writeFileSync(opts.externalEvidenceOutputPath,
      JSON.stringify(externalEvidence,null,2)+'\n');
  }

  const result=readiness.evaluateLaunchReadiness({
    graph,
    currentScoring:current,
    historicalScoring:historicalResult,
    promotion,
    detectionLedger,
    opportunityLedger,
    subscriberCanary,
    curatedCanary:founderCuratedCanary,
    curatedResearch,
    stripeIntake,
    launchMode:manifest.checkout&&manifest.checkout.launch_mode,
    curatedFulfillmentRunbookPresent,
    publicBuildFailures,
    currentPublicSourceFingerprint,
    externalEvidence,
    evaluatedAt
  });

  return Object.assign({
    runnerVersion:RUNNER_VERSION,
    observedAt,
    sourceHealth:{
      states:Object.fromEntries(Object.entries(batches).map(([key,batch])=>[
        key,
        batch&&batch.observation&&batch.observation.state||null
      ]))
    }
  },result);
}

function shouldFailJob(result){
  if(result?.internalReady!==true)return true;
  // The founder-curated public Checkout path can accept money. A missing
  // private paid-customer polling heartbeat is a material operational fault,
  // not merely an advisory external-evidence warning.
  return result.launchMode===readiness.CURATED_LAUNCH_MODE &&
    Array.isArray(result.firstCustomerExternalFailures) &&
    result.firstCustomerExternalFailures.includes('stripeIntakeMonitoringVerified');
}

async function main(){
  const outputPath=process.argv[2]||
    path.join(__dirname,'launch-readiness-result.json');
  const detectionPath=process.argv[3]||undefined;
  const opportunityPath=process.argv[4]||undefined;
  const result=await run({detectionPath,opportunityPath,
    refreshExternalEvidence:process.env.PERMITPLATE_REFRESH_EXTERNAL_EVIDENCE==='true',
    stripeReadKey:process.env.PERMITPLATE_STRIPE_READ_KEY,
    sourceCommit:process.env.GITHUB_SHA,
    externalEvidenceOutputPath:path.join(__dirname,'launch-external-evidence-result.json')});
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(shouldFailJob(result)) {
    console.error('PERMITPLATE_PAID_INTAKE_OR_INTERNAL_READINESS_BLOCKED');
    process.exitCode=1;
  }
}

if(require.main===module){
  main().catch((error)=>{console.error(error);process.exit(1);});
}

module.exports={
  RUNNER_VERSION,
  readJson,
  promotionEvidenceFrom,
  shouldFailJob,
  run
};

