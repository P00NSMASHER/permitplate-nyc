'use strict';

const crypto=require('crypto');
const delivery=require('./delivery-plan');
const scoringPolicy=require('./scoring-policy');

const CANDIDATE_PACKAGE_VERSION='PermitPlate-candidate-package-v1.0.0';

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
function detectionTime(receipt){
  return receipt&&(
    receipt.materialChangeAt ||
    receipt.firstDetectedAt ||
    receipt.reopenAt ||
    receipt.observedAt
  ) || null;
}

function validateDetection(candidate,receipt){
  const failures=[];
  const fingerprint=delivery.candidateChangeFingerprint(candidate||{});
  if(!receipt){
    failures.push('DETECTION_RECEIPT_MISSING');
    return {valid:false,failures,changeFingerprint:fingerprint};
  }
  if(String(receipt.entityId||'')!==String(candidate&&candidate.entityId||'')){
    failures.push('DETECTION_ENTITY_MISMATCH');
  }
  if(String(receipt.changeFingerprint||'')!==fingerprint){
    failures.push('DETECTION_CHANGE_MISMATCH');
  }
  if(receipt.customerEligible!==true){
    failures.push('DETECTION_NOT_CUSTOMER_ELIGIBLE');
  }
  if(!['NEW_ENTITY','MATERIAL_CHANGE'].includes(String(receipt.detectionClass||''))){
    failures.push('DETECTION_CLASS_NOT_DELIVERABLE');
  }
  if(!detectionTime(receipt)){
    failures.push('DETECTION_TIME_MISSING');
  }
  return {valid:failures.length===0,failures,changeFingerprint:fingerprint};
}

function buildCandidatePackage(input){
  const data=input||{};
  const graph=data.graph||{};
  const candidate=data.candidate||{};
  const failures=[];

  if(graph.graphState!=='COMPLETE') failures.push('GRAPH_NOT_COMPLETE');
  if(!graph.graphDigest) failures.push('GRAPH_DIGEST_MISSING');

  const detection=validateDetection(candidate,data.detectionReceipt);
  failures.push(...detection.failures);

  let scoring=null;
  if(failures.length===0){
    scoring=scoringPolicy.scoreCandidateWithPolicy({
      candidate,
      graphDigest:graph.graphDigest,
      recordsById:data.recordsById,
      sourceRecords:data.sourceRecords,
      observedAt:data.observedAt,
      promotionEvidence:data.promotionEvidence
    });
    if(!scoring||scoring.productionAuthorized!==true||!scoring.receipt){
      failures.push('PRODUCTION_SCORE_AUTHORITY_UNAVAILABLE');
    }
  }

  const status=failures.length===0?'READY_FOR_PROFILE_MATCHING':'REVIEW';
  const payload={
    packageVersion:CANDIDATE_PACKAGE_VERSION,
    status,
    entityId:candidate.entityId||null,
    graphDigest:graph.graphDigest||null,
    changeFingerprint:detection.changeFingerprint,
    projectSignalId:candidate.projectSignal&&candidate.projectSignal.signalId||
      candidate.projectSignalId||null,
    businessName:candidate.canonicalName||null,
    address:candidate.address||null,
    borough:candidate.borough||null,
    zip:candidate.zip||null,
    lifecycleStage:candidate.lifecycleStage||null,
    sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt||null,
    sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt||null,
    sourceSystems:Array.isArray(candidate.sourceSystems)?candidate.sourceSystems.slice().sort():[],
    sourceRecordIds:candidate.projectSignal&&
      Array.isArray(candidate.projectSignal.sourceRecordIds)?
        candidate.projectSignal.sourceRecordIds.slice():[],
    sourceUrls:candidate.projectSignal&&candidate.projectSignal.provenance&&
      Array.isArray(candidate.projectSignal.provenance.sourceUrls)?
        Array.from(new Set(candidate.projectSignal.provenance.sourceUrls)).sort():[],
    commercialEvidence:Array.isArray(candidate.commercialEvidence)?
      candidate.commercialEvidence.map((item)=>({
        tag:item&&item.tag||null,
        sourceSystem:item&&item.sourceSystem||null,
        sourceRecordId:item&&item.sourceRecordId||null,
        sourceUrl:item&&item.sourceUrl||null,
        matchedPatterns:Array.isArray(item&&item.matchedPatterns)?item.matchedPatterns.slice():[]
      })):[],
    detectionReceiptId:data.detectionReceipt&&data.detectionReceipt.receiptId||null,
    detectionReceipt:data.detectionReceipt||null,
    detectionClass:data.detectionReceipt&&data.detectionReceipt.detectionClass||null,
    detectedAt:detectionTime(data.detectionReceipt),
    scoringMode:scoring&&scoring.selectedMode||null,
    scoreReceiptId:scoring&&scoring.receipt&&scoring.receipt.scoreReceiptId||null,
    scoreReceipt:scoring&&scoring.receipt||null,
    scorerVersion:scoring&&scoring.receipt&&scoring.receipt.scorerVersion||null,
    commercialFit:scoring&&scoring.receipt&&scoring.receipt.commercialFit||null,
    scores:scoring&&scoring.receipt&&scoring.receipt.scores||null,
    bestVendorFit:scoring&&scoring.receipt&&scoring.receipt.bestVendorFit||null,
    bestScore:scoring&&scoring.receipt&&scoring.receipt.bestScore!=null?
      scoring.receipt.bestScore:null,
    productionAuthorized:status==='READY_FOR_PROFILE_MATCHING',
    failures
  };
  payload.packageFingerprint=sha256(stableStringify(payload));
  payload.packageId='PKG:'+payload.packageFingerprint.slice(0,24);
  return payload;
}

function candidateForDelivery(candidate,packageReceipt){
  if(!packageReceipt||packageReceipt.status!=='READY_FOR_PROFILE_MATCHING'){
    throw new Error('READY candidate package required');
  }
  if(!packageReceipt.detectionReceiptId||!packageReceipt.scoreReceiptId){
    throw new Error('candidate package receipt bindings missing');
  }
  return Object.assign({},candidate||{},{
    detectionReceiptId:packageReceipt.detectionReceiptId,
    scoreReceiptId:packageReceipt.scoreReceiptId
  });
}

module.exports={
  CANDIDATE_PACKAGE_VERSION,
  stableStringify,
  sha256,
  detectionTime,
  validateDetection,
  buildCandidatePackage,
  candidateForDelivery
};
