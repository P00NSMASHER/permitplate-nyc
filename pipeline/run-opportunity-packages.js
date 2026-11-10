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

// Canonical promotion is a candidate-specific authorization decision, not a
// global prerequisite to the explicitly approved LEGACY_LITERAL fallback.
function buildDetectionPackages({graph,receipts,recordsById,observedAt,promotionEvidence}){
  const candidatesById=new Map((graph.candidates||[])
    .map(candidate=>[String(candidate.entityId),candidate]));
  return receipts.map(receipt=>{
    const candidate=candidatesById.get(String(receipt.entityId));
    if(!candidate){
      return {
        packageVersion:candidatePackage.CANDIDATE_PACKAGE_VERSION,
        status:'REVIEW',
        entityId:receipt.entityId||null,
        detectionReceiptId:receipt.receiptId||null,
        failures:['DETECTED_ENTITY_NOT_IN_CURRENT_GRAPH']
      };
    }
    return candidatePackage.buildCandidatePackage({
      graph,candidate,detectionReceipt:receipt,recordsById,observedAt,
      promotionEvidence
    });
  });
}

function packageGate(receipts,packages,promotion,preflightFailures=[]){
  const readyCount=packages.filter(item=>item.status==='READY_FOR_PROFILE_MATCHING' &&
    item.productionAuthorized===true && item.scoreReceipt?.productionAuthorized===true).length;
  const reviewCount=packages.length-readyCount;
  const failures=preflightFailures.slice();
  if(!promotion.canaryReady && readyCount!==receipts.length){
    failures.push('SCORING_PROMOTION_GATE_NOT_READY');
  }
  if(reviewCount>0) failures.push('CANDIDATE_PACKAGE_REVIEW_REQUIRED');
  if(packages.length!==receipts.length) failures.push('DETECTION_PACKAGE_COUNT_MISMATCH');
  return {readyCount,reviewCount,failures,
    passed:failures.length===0 && readyCount===receipts.length};
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
  // A missing/truncated receipt array must never masquerade as a zero-event
  // day, bypass a score gate, or cause the staged history to be committed.
  if(!Array.isArray(detectionResult.customerEligibleReceipts) ||
      !Number.isSafeInteger(detectionResult.customerEligibleReceiptCount) ||
      detectionResult.customerEligibleReceiptCount<0 ||
      receipts.length!==detectionResult.customerEligibleReceiptCount){
    const result=Object.assign(base,{
      passed:false,reason:'DETECTION_RECEIPT_COUNT_MISMATCH',
      failures:['DETECTION_RECEIPT_COUNT_MISMATCH'],
      packages:[],packageCount:0,readyCount:0,reviewCount:0
    });
    result.artifactFingerprint=sha256(stableStringify(result));
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
    return result;
  }

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
  const recordsById=shadow.sourceMap(allRecords(batches));
  // A partial/drifted graph still aborts before evaluating any package.
  // Otherwise each candidate must satisfy the unchanged scoring policy.
  const packages=failures.length?[]:buildDetectionPackages({
    graph,receipts,recordsById,observedAt,promotionEvidence
  });
  const gate=packageGate(receipts,packages,promotion,failures);
  const {readyCount,reviewCount}=gate;

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
    failures:gate.failures,
    passed:gate.passed,
    reason:gate.passed?'ALL_DETECTIONS_PACKAGED':'FAIL_CLOSED'
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
  buildDetectionPackages,
  packageGate,
  run
};
