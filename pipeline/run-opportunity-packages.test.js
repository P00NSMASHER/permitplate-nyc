'use strict';

// Offline, NO_SEND regression of the exact detection-to-package coupling.
// No private state, network, real buyers, or payment provider is accessed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const runner=require('./run-opportunity-packages');
const scoringPolicy=require('./scoring-policy');
const delivery=require('./delivery-plan');

const observedAt='2026-09-21T17:00:00Z';
const legacyRecord=require('../scoring/legacy-score-authority-2026-09-18.json').records
  .find(r=>r?.authorityKey?.camis&&Number(r.sourceCount)===1&&
    Array.isArray(r.sources)&&r.sources.length===1&&
    String(r.sources[0]).toUpperCase()==='DOHMH'&&r.stage==='JUST FILED');
assert(legacyRecord,'Existing pinned legacy authority fixture is required');

function syntheticCandidate(camis){
  const entityId='CAMIS:'+camis;
  return {
    entityId,camis,projectSignalId:'PS:'+camis,
    canonicalName:'SYNTHETIC REGRESSION VENUE',
    borough:'Manhattan',lifecycleStage:legacyRecord.stage,
    sourceLatestEffectiveAt:legacyRecord.lastUpdated,
    sourceSystems:legacyRecord.sources.slice(),
    sourceCount:legacyRecord.sourceCount,
    deliverySuppressed:false,commercialEvidence:[],
    primaryRecord:{
      sourceRecordId:'DOHMH:SYNTHETIC:'+camis,
      sourceEntityId:entityId,
      sourceSystem:'DOHMH',
      facts:{inspection_date:'1900-01-01',record_date:'2026-09-21'},
      sourceUrl:null
    }
  };
}
function detectionReceipt(candidate){
  return {
    receiptId:'DET:SYNTHETIC:'+candidate.camis,
    detectionClass:'NEW_ENTITY',customerEligible:true,
    entityId:candidate.entityId,
    changeFingerprint:delivery.candidateChangeFingerprint(candidate),
    firstDetectedAt:observedAt,observedAt
  };
}
const promotionEvidence={
  graphState:'COMPLETE',shadowCoverageRate:1,
  currentOverlap:0,currentExactAllCategoryRate:0,
  currentBestFitAgreementRate:0,
  historicalRecordCount:47,historicalExactRowRate:1,
  historicalFitAgreementRate:1,historicalBestFitAgreementRate:1,
  documentedLegacyAnomalyIds:['50192386','50192550'],
  transportMode:'NO_SEND'
};
const promotion=scoringPolicy.evaluateCanonicalPromotionEvidence(promotionEvidence);
assert.equal(promotion.canaryReady,false);
assert(promotion.failures.includes('CURRENT_OVERLAP_TOO_SMALL'));

const legacy=syntheticCandidate(String(legacyRecord.authorityKey.camis));
const missingAuthority=syntheticCandidate('999999999');
const trustedReceipt=detectionReceipt(legacy),heldReceipt=detectionReceipt(missingAuthority);
const graph={
  graphState:'COMPLETE',graphDigest:'synthetic-source-graph',
  candidates:[legacy,missingAuthority]
};
const inputs={
  graph,receipts:[trustedReceipt,heldReceipt],
  recordsById:new Map(),observedAt,promotionEvidence
};
const packages=runner.buildDetectionPackages(inputs);
assert.equal(packages.length,2);
assert.equal(packages[0].status,'READY_FOR_PROFILE_MATCHING');
assert.equal(packages[0].productionAuthorized,true);
assert.equal(packages[0].scoreReceipt.authorityMode,'LEGACY_LITERAL');
assert.equal(packages[0].scoreReceipt.productionAuthorized,true);
assert.equal(packages[0].detectionReceiptId,trustedReceipt.receiptId);
assert.equal(packages[1].status,'REVIEW');
assert.equal(packages[1].productionAuthorized,false);
assert(packages[1].failures.includes('PRODUCTION_SCORE_AUTHORITY_UNAVAILABLE'));

const mixed=runner.packageGate(inputs.receipts,packages,promotion,[]);
assert.equal(mixed.passed,false,'Any unscored receipt holds the entire atomic batch');
assert.equal(mixed.readyCount,1);
assert.equal(mixed.reviewCount,1);
assert(mixed.failures.includes('SCORING_PROMOTION_GATE_NOT_READY'));
assert(mixed.failures.includes('CANDIDATE_PACKAGE_REVIEW_REQUIRED'));
assert(!mixed.failures.includes('DETECTION_PACKAGE_COUNT_MISMATCH'),
  'A review hold is not a missing package when all detection packages exist');

const allHeld=runner.packageGate(inputs.receipts,
  packages.map(item=>({...item,status:'REVIEW',productionAuthorized:false,scoreReceipt:null})),
  promotion,[]);
assert.equal(allHeld.passed,false,'A complete but unscored batch must still fail closed');
assert.equal(allHeld.readyCount,0);
assert.equal(allHeld.reviewCount,inputs.receipts.length);
assert(allHeld.failures.includes('CANDIDATE_PACKAGE_REVIEW_REQUIRED'));
assert(!allHeld.failures.includes('DETECTION_PACKAGE_COUNT_MISMATCH'),
  'The original all-held case must not claim packages were missing');

const missingPackage=runner.packageGate(inputs.receipts,[packages[0]],promotion,[]);
assert.equal(missingPackage.passed,false);
assert(missingPackage.failures.includes('DETECTION_PACKAGE_COUNT_MISMATCH'),
  'An actually missing package must still fail closed with count mismatch');

const legacyOnly=runner.packageGate([trustedReceipt],[packages[0]],promotion,[]);
assert.equal(legacyOnly.passed,true,
  'Verified literal legacy authority must remain usable when canonical canary is unpromoted');
assert.equal(legacyOnly.readyCount,1);
assert.deepEqual(legacyOnly.failures,[]);

const fake={...packages[0],scoreReceipt:{productionAuthorized:false}};
const spoof=runner.packageGate([trustedReceipt],[fake],promotion,[]);
assert.equal(spoof.passed,false,'A claimed READY status cannot bypass an unauthorized score receipt');

const drift=runner.packageGate([trustedReceipt],[packages[0]],promotion,['GRAPH_DIGEST_DRIFT_SINCE_DETECTION']);
assert.equal(drift.passed,false,'Source drift remains a hard stop');

async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-package-integrity-'));
  try{
    const source=path.join(dir,'detection.json'),out=path.join(dir,'result.json');
    fs.writeFileSync(source,JSON.stringify({
      committed:true,customerEligibleReceiptCount:793,
      customerEligibleReceipts:[],
      graphDigest:'synthetic-source-graph'
    }));
    const result=await runner.run({detectionPath:source,outputPath:out});
    assert.equal(result.passed,false,'Truncated receipts cannot be treated as zero-event success');
    assert.equal(result.reason,'DETECTION_RECEIPT_COUNT_MISMATCH');
    assert.deepEqual(result.packages,[]);
    assert.equal(result.readyCount,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(out,'utf8')),result);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
  console.log('Detection packages: legacy fallback, review holds, source drift and truncated-receipt protection passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
