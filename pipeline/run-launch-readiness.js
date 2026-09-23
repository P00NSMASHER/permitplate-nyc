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

const RUNNER_VERSION='PermitPlate-launch-readiness-runner-v1.1.0';

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
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
  const externalEvidence=readJson(externalEvidencePath);
  const subscriberCanary=firstSubscriber.run();
  const founderCuratedCanary=curatedCanary.run();
  const manifest=readJson(path.join(__dirname,'..','release-manifest.json'));
  const curatedFulfillmentRunbookPresent=fs.existsSync(
    path.join(__dirname,'..','operations','FOUNDER_CURATED_FULFILLMENT.md')
  );
  const publicBuildFailures=publicBuild.validateAllowlist();
  const currentPublicSourceFingerprint=readiness.publicSourceFingerprint();

  const result=readiness.evaluateLaunchReadiness({
    graph,
    currentScoring:current,
    historicalScoring:historicalResult,
    promotion,
    detectionLedger,
    opportunityLedger,
    subscriberCanary,
    curatedCanary:founderCuratedCanary,
    launchMode:manifest.checkout&&manifest.checkout.launch_mode,
    curatedFulfillmentRunbookPresent,
    publicBuildFailures,
    currentPublicSourceFingerprint,
    externalEvidence,
    evaluatedAt:observedAt
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

async function main(){
  const outputPath=process.argv[2]||
    path.join(__dirname,'launch-readiness-result.json');
  const detectionPath=process.argv[3]||undefined;
  const opportunityPath=process.argv[4]||undefined;
  const result=await run({detectionPath,opportunityPath});
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!result.internalReady) process.exitCode=1;
}

if(require.main===module){
  main().catch((error)=>{console.error(error);process.exit(1);});
}

module.exports={
  RUNNER_VERSION,
  readJson,
  promotionEvidenceFrom,
  run
};
