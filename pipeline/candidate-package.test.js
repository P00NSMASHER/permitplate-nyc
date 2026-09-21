'use strict';

const assert=require('assert');
const adapters=require('./source-adapters');
const project=require('./project-signal');
const delivery=require('./delivery-plan');
const pkg=require('./candidate-package');
const shadow=require('./shadow-scoring-v3');

function goodEvidence(overrides){
  return Object.assign({
    graphState:'COMPLETE',
    shadowCoverageRate:1,
    currentOverlap:13,
    currentExactAllCategoryRate:1,
    currentBestFitAgreementRate:1,
    historicalRecordCount:47,
    historicalExactRowRate:1,
    historicalFitAgreementRate:1,
    historicalBestFitAgreementRate:1,
    documentedLegacyAnomalyIds:['50192386','50192550'],
    transportMode:'NO_SEND'
  },overrides||{});
}
function build(){
  const primary=adapters.normalizeDohmhRow({
    camis:'57770001',
    dba:'FUTURE PIZZA TEST',
    boro:'Manhattan',
    building:'10',
    street:'TEST AVE',
    zipcode:'10001',
    phone:'555-7000',
    cuisine_description:'Pizza',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-09-21T16:30:00.000'
  },{observedAt:'2026-09-21T17:00:00Z'});
  const signal=project.buildProjectSignal(primary,[]);
  const candidate={
    entityId:'CAMIS:57770001',
    camis:'57770001',
    projectSignalId:signal.signalId,
    canonicalName:'FUTURE PIZZA TEST',
    borough:'Manhattan',
    lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-09-21T16:30:00.000Z',
    sourceLatestEffectiveAt:'2026-09-21T16:30:00.000Z',
    sourceSystems:signal.sourceSystems,
    sourceCount:signal.sourceCount,
    deliverySuppressed:false,
    crossCamisOperationalConflicts:[],
    primaryRecord:primary,
    commercialEvidence:signal.commercialEvidence,
    projectSignal:signal
  };
  const changeFingerprint=delivery.candidateChangeFingerprint(candidate);
  const detectionReceipt={
    receiptId:'DET:future-pizza',
    detectionVersion:'PermitPlate-detection-ledger-v1.0.0',
    detectionClass:'NEW_ENTITY',
    customerEligible:true,
    entityId:candidate.entityId,
    changeFingerprint,
    firstDetectedAt:'2026-09-21T17:00:00Z',
    materialChangeAt:null,
    reopenAt:null,
    observedAt:'2026-09-21T17:00:00Z'
  };
  return {candidate,primary,detectionReceipt};
}

{
  const {candidate,primary,detectionReceipt}=build();
  const graph={graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[candidate]};
  const packageReceipt=pkg.buildCandidatePackage({
    graph,
    candidate,
    detectionReceipt,
    recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(packageReceipt.status,'READY_FOR_PROFILE_MATCHING');
  assert.equal(packageReceipt.productionAuthorized,true);
  assert.equal(packageReceipt.scoringMode,'CANONICAL_V3_PRODUCTION');
  assert.equal(packageReceipt.scoreReceipt.productionAuthorized,true);
  assert.equal(packageReceipt.scoreReceipt.authorityMode,'CANONICAL_V3_PRODUCTION');
  assert.equal(packageReceipt.bestVendorFit,'Equipment');
  assert(packageReceipt.packageId.startsWith('PKG:'));

  const deliveryCandidate=pkg.candidateForDelivery(candidate,packageReceipt);
  const plan=delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:graph.graphDigest,candidates:[deliveryCandidate]},
    profile:{
      subscriberId:'sub-test',
      baselineAt:'2026-09-21T16:00:00Z',
      category:'POS',
      boroughs:['Manhattan'],
      minimumScore:0,
      starterSnapshotEnabled:false
    },
    detectionReceipts:[packageReceipt.detectionReceipt],
    scoreReceipts:[packageReceipt.scoreReceipt],
    deliveredSignalKeys:[]
  });
  assert.equal(plan.status,'READY');
  assert.equal(plan.signals.length,1);
  assert.equal(plan.signals[0].entityId,candidate.entityId);
}

{
  const {candidate,primary,detectionReceipt}=build();
  const baseline=Object.assign({},detectionReceipt,{
    detectionClass:'BASELINE_EXISTING',
    customerEligible:false,
    firstDetectedAt:null
  });
  const out=pkg.buildCandidatePackage({
    graph:{graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[candidate]},
    candidate,
    detectionReceipt:baseline,
    recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('DETECTION_NOT_CUSTOMER_ELIGIBLE'));
  assert(out.failures.includes('DETECTION_CLASS_NOT_DELIVERABLE'));
}

{
  const {candidate,primary,detectionReceipt}=build();
  const tampered=Object.assign({},detectionReceipt,{changeFingerprint:'tampered'});
  const out=pkg.buildCandidatePackage({
    graph:{graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[candidate]},
    candidate,
    detectionReceipt:tampered,
    recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('DETECTION_CHANGE_MISMATCH'));
}

{
  const {candidate,primary,detectionReceipt}=build();
  const out=pkg.buildCandidatePackage({
    graph:{graphState:'PARTIAL',graphDigest:'graph-package-1',candidates:[candidate]},
    candidate,
    detectionReceipt,
    recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('GRAPH_NOT_COMPLETE'));
}

{
  const {candidate,primary,detectionReceipt}=build();
  const out=pkg.buildCandidatePackage({
    graph:{graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[candidate]},
    candidate,
    detectionReceipt,
    recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',
    promotionEvidence:goodEvidence({historicalExactRowRate:46/47})
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PRODUCTION_SCORE_AUTHORITY_UNAVAILABLE'));
}

{
  const {candidate,primary,detectionReceipt}=build();
  const a=pkg.buildCandidatePackage({
    graph:{graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[candidate]},
    candidate,detectionReceipt,recordsById:shadow.sourceMap([primary]),
    observedAt:'2026-09-21T17:00:00Z',promotionEvidence:goodEvidence()
  });
  const b=pkg.buildCandidatePackage({
    graph:{graphState:'COMPLETE',graphDigest:'graph-package-1',candidates:[JSON.parse(JSON.stringify(candidate))]},
    candidate:JSON.parse(JSON.stringify(candidate)),
    detectionReceipt:JSON.parse(JSON.stringify(detectionReceipt)),
    sourceRecords:[JSON.parse(JSON.stringify(primary))],
    observedAt:'2026-09-21T17:00:00Z',promotionEvidence:goodEvidence()
  });
  assert.equal(a.packageFingerprint,b.packageFingerprint);
  assert.equal(a.packageId,b.packageId);
}

console.log('PermitPlate candidate package end-to-end no-send tests passed.');
