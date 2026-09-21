'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {scanBatches}=require('./run-source-health');
const {buildCurrentGraph}=require('./candidate-builder');
const currentEval=require('./run-shadow-scoring-evaluation');
const historical=require('./historical-shadow-score-benchmark');
const shadow=require('./shadow-scoring-v3');
const policy=require('./scoring-policy');
const candidatePackage=require('./candidate-package');

const RUNNER_VERSION='PermitPlate-opportunity-packages-v1.0.0';

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
function allRecords(batches){
  return Object.values(batches||{}).flatMap((batch)=>batch.records||[]);
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
    documentedLegacyAnomalyIds:(historicalResult.documentedLegacyAnomalies||[]).map((item)=>item.camis),
    transportMode:'NO_SEND'
  };
}

function readDetectionResult(filePath){
  if(!fs.existsSync(filePath)) throw new Error('detection result missing: '+filePath);
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
}

async function run(options){
  const opts=options||{};
  const detectionPath=path.resolve(opts.detectionPath||path.join(__dirname,'detection-ledger-run-result.json'));
  const outputPath=path.resolve(opts.outputPath||path.join(__dirname,'opportunity-packages-result.json'));
  const detectionResult=readDetectionResult(detectionPath);

  const base={
    runnerVersion:RUNNER_VERSION,
    externalSendCalls:0,
    transportMode:'NO_SEND',
    detectionArtifactFingerprint:detectionResult.artifactFingerprint||null,
    detectionObservedAt:detectionResult.observedAt||null,
    detectionGraphDigest:detectionResult.graphDigest||null,
    detectionCustomerEligibleCount:Number(detectionResult.customerEligibleReceiptCount||0)
  };

  if(detectionResult.committed!==true){
    const result=Object.assign(base,{
      passed:false,
      reason:'DETECTION_LEDGER_NOT_ADVANCED',
      packages:[],
      packageCount:0,
      reviewCount:0
    });
    result.artifactFingerprint=sha256(stableStringify(result));
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
    return result;
  }

  const receipts=Array.isArray(detectionResult.customerEligibleReceipts)?
    detectionResult.customerEligibleReceipts:[];

  // A zero-event day is a successful no-op and should not require another source scan.
  if(receipts.length===0){
    const result=Object.assign(base,{
      passed:true,
      reason:'NO_CUSTOMER_ELIGIBLE_DETECTIONS',
      packages:[],
      packageCount:0,
      readyCount:0,
      reviewCount:0
    });
    result.artifactFingerprint=sha256(stableStringify(result));
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
    return result;
  }

  const {observedAt,batches}=await scanBatches(opts.nowIso);
  const graph=buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });

  const failures=[];
  if(graph.graphState!=='COMPLETE') failures.push('GRAPH_NOT_COMPLETE');
  if(String(graph.graphDigest||'')!==String(detectionResult.graphDigest||'')){
    failures.push('GRAPH_DIGEST_DRIFT_SINCE_DETECTION');
  }

  const current=currentEval.evaluate(graph,batches,observedAt);
  const historicalResult=historical.evaluateHistoricalFixture();
  const promotionEvidence=promotionEvidenceFrom(current,historicalResult);
  const promotion=policy.evaluateCanonicalPromotionEvidence(promotionEvidence);
  if(!promotion.canaryReady) failures.push('SCORING_PROMOTION_GATE_NOT_READY');

  const recordsById=shadow.sourceMap(allRecords(batches));
  const candidatesById=new Map((graph.candidates||[]).map((candidate)=>[String(candidate.entityId),candidate]));
  const packages=[];

  if(failures.length===0){
    for(const receipt of receipts){
      const candidate=candidatesById.get(String(receipt.entityId));
      if(!candidate){
        packages.push({
          packageVersion:candidatePackage.CANDIDATE_PACKAGE_VERSION,
          status:'REVIEW',
          entityId:receipt.entityId||null,
          detectionReceiptId:receipt.receiptId||null,
          failures:['DETECTED_ENTITY_NOT_IN_CURRENT_GRAPH']
        });
        continue;
      }
      packages.push(candidatePackage.buildCandidatePackage({
        graph,
        candidate,
        detectionReceipt:receipt,
        recordsById,
        observedAt,
        promotionEvidence
      }));
    }
  }

  const readyCount=packages.filter((item)=>item.status==='READY_FOR_PROFILE_MATCHING').length;
  const reviewCount=packages.filter((item)=>item.status!=='READY_FOR_PROFILE_MATCHING').length;
  if(reviewCount>0) failures.push('CANDIDATE_PACKAGE_REVIEW_REQUIRED');
  if(readyCount!==receipts.length) failures.push('DETECTION_PACKAGE_COUNT_MISMATCH');

  const result=Object.assign(base,{
    observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest||null,
    promotionEvidenceFingerprint:promotion.evidenceFingerprint||null,
    productionScoringMode:policy.PRODUCTION_SCORING_MODE,
    packages,
    packageCount:packages.length,
    readyCount,
    reviewCount,
    failures,
    passed:failures.length===0 && readyCount===receipts.length,
    reason:failures.length?'FAIL_CLOSED':'ALL_DETECTIONS_PACKAGED'
  });
  result.artifactFingerprint=sha256(stableStringify(result));
  fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  return result;
}

async function main(){
  const detectionPath=process.argv[2]||path.join(__dirname,'detection-ledger-run-result.json');
  const outputPath=process.argv[3]||path.join(__dirname,'opportunity-packages-result.json');
  const result=await run({detectionPath,outputPath});
  console.log(JSON.stringify(result,null,2));
  if(!result.passed) process.exitCode=1;
}

if(require.main===module){
  main().catch((error)=>{console.error(error);process.exit(1);});
}

module.exports={
  RUNNER_VERSION,
  stableStringify,
  sha256,
  allRecords,
  promotionEvidenceFrom,
  readDetectionResult,
  run
};
