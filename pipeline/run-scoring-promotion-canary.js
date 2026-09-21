'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {scanBatches} = require('./run-source-health');
const {buildCurrentGraph} = require('./candidate-builder');
const currentEval = require('./run-shadow-scoring-evaluation');
const historical = require('./historical-shadow-score-benchmark');
const shadow = require('./shadow-scoring-v3');
const policy = require('./scoring-policy');
const delivery = require('./delivery-plan');

const RUNNER_VERSION = 'PermitPlate-scoring-promotion-canary-v1.0.0';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function inc(obj,key) {
  const k=String(key||'UNKNOWN');
  obj[k]=(obj[k]||0)+1;
}
function allRecords(batches) {
  return Object.values(batches||{}).flatMap((batch)=>batch.records||[]);
}
function minusMinutes(iso,minutes) {
  const ms=Date.parse(String(iso||''));
  if(!Number.isFinite(ms)) return '1970-01-01T00:00:00Z';
  return new Date(ms-minutes*60*1000).toISOString();
}

function promotionEvidenceFrom(current,historicalResult) {
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

function deliveryBoundaryProbe(candidate,scoreReceipt,graphDigest,observedAt) {
  const cloned=JSON.parse(JSON.stringify(candidate));
  cloned.scoreReceiptId=scoreReceipt.scoreReceiptId;
  cloned.detectionReceiptId='CANARY-DET:'+String(candidate.entityId);
  const fingerprint=delivery.candidateChangeFingerprint(cloned);
  const result=delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest,candidates:[cloned]},
    profile:{
      subscriberId:'canary-owner-only',
      baselineAt:minusMinutes(observedAt,60),
      category:'POS',
      boroughs:[],
      minimumScore:0,
      starterSnapshotEnabled:false
    },
    detectionReceipts:[{
      receiptId:cloned.detectionReceiptId,
      entityId:cloned.entityId,
      changeFingerprint:fingerprint,
      firstDetectedAt:observedAt
    }],
    scoreReceipts:[scoreReceipt],
    deliveredSignalKeys:[]
  });
  const blocked=result.signals.length===0 &&
    result.reviews.some((item)=>
      (item.reasons||[]).includes('SCORE_NOT_PRODUCTION_AUTHORIZED')
    );
  return {
    blocked,
    signalCount:result.signals.length,
    reviewCount:result.reviews.length,
    reasons:result.reviews.flatMap((item)=>item.reasons||[])
  };
}

async function run(nowIso) {
  const {observedAt,batches}=await scanBatches(nowIso);
  const graph=buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });
  const current=currentEval.evaluate(graph,batches,observedAt);
  const historicalResult=historical.evaluateHistoricalFixture();
  const evidence=promotionEvidenceFrom(current,historicalResult);
  const promotion=policy.evaluateCanonicalPromotionEvidence(evidence);
  const recordsById=shadow.sourceMap(allRecords(batches));

  const modeCounts={};
  let productionAuthorizedReceiptCount=0;
  let canonicalCanaryReceiptCount=0;
  let canonicalCanaryProductionAuthorizedCount=0;
  let firstCanonical=null;

  for(const candidate of graph.candidates||[]) {
    const scored=policy.scoreCandidateWithPolicy({
      candidate,
      graphDigest:graph.graphDigest,
      recordsById,
      observedAt,
      promotionEvidence:evidence
    });
    inc(modeCounts,scored.selectedMode);
    if(scored.receipt&&scored.receipt.productionAuthorized===true) {
      productionAuthorizedReceiptCount+=1;
    }
    if(scored.selectedMode==='CANONICAL_V3_CANARY'&&scored.receipt) {
      canonicalCanaryReceiptCount+=1;
      if(scored.receipt.productionAuthorized===true) {
        canonicalCanaryProductionAuthorizedCount+=1;
      }
      if(!firstCanonical) firstCanonical={candidate,receipt:scored.receipt};
    }
  }

  const probe=firstCanonical?
    deliveryBoundaryProbe(firstCanonical.candidate,firstCanonical.receipt,graph.graphDigest,observedAt):
    {blocked:false,signalCount:0,reviewCount:0,reasons:['NO_CANONICAL_CANARY_RECEIPT']};

  const result={
    runnerVersion:RUNNER_VERSION,
    observedAt,
    transportMode:'NO_SEND',
    externalSendCalls:0,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest,
    candidateCount:(graph.candidates||[]).length,
    productionScoringMode:policy.PRODUCTION_SCORING_MODE,
    promotion,
    currentBenchmark:{
      overlap:current.benchmark.overlap,
      exactAllCategoryRowRate:current.benchmark.exactAllCategoryRowRate,
      bestFitAgreementRate:current.benchmark.bestFitAgreementRate,
      shadowCoverageRate:current.shadow.coverageRate
    },
    historicalBenchmark:{
      recordCount:historicalResult.recordCount,
      exactRowRate:historicalResult.exactRowRate,
      fitAgreementRate:historicalResult.fitAgreementRate,
      bestFitAgreementRate:historicalResult.bestFitAgreementRate,
      documentedLegacyAnomalyCount:historicalResult.documentedLegacyAnomalyCount,
      documentedLegacyAnomalyIds:(historicalResult.documentedLegacyAnomalies||[]).map((item)=>item.camis)
    },
    policyModeCounts:modeCounts,
    productionAuthorizedReceiptCount,
    canonicalCanaryReceiptCount,
    canonicalCanaryProductionAuthorizedCount,
    deliveryBoundaryProbe:probe
  };

  result.passed=Boolean(
    graph.graphState==='COMPLETE' &&
    promotion.canaryReady===true &&
    policy.PRODUCTION_SCORING_MODE==='LEGACY_LITERAL' &&
    canonicalCanaryReceiptCount>0 &&
    canonicalCanaryProductionAuthorizedCount===0 &&
    probe.blocked===true &&
    result.externalSendCalls===0
  );
  result.artifactFingerprint=sha256(stableStringify(result));
  return result;
}

async function main() {
  const result=await run();
  const outputPath=process.argv[2]||path.join(__dirname,'scoring-promotion-canary-result.json');
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!result.passed) process.exitCode=1;
}

if(require.main===module) {
  main().catch((error)=>{console.error(error);process.exit(1);});
}

module.exports={
  RUNNER_VERSION,
  stableStringify,
  sha256,
  promotionEvidenceFrom,
  deliveryBoundaryProbe,
  run
};
