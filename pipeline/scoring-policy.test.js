'use strict';

const assert = require('assert');
const policy = require('./scoring-policy');
const legacyScoring = require('./scoring');
const shadow = require('./shadow-scoring-v3');
const adapters = require('./source-adapters');
const project = require('./project-signal');

function goodEvidence(overrides) {
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

{
  const a=policy.evaluateCanonicalPromotionEvidence(goodEvidence());
  const b=policy.evaluateCanonicalPromotionEvidence(goodEvidence({
    documentedLegacyAnomalyIds:['50192550','50192386','50192550']
  }));
  assert.equal(a.canaryReady,true);
  assert.equal(a.productionAuthorized,false);
  assert.equal(a.productionScoringMode,'LEGACY_LITERAL');
  assert.equal(a.nextMode,'CANONICAL_V3_CANARY');
  assert.equal(a.evidenceFingerprint,b.evidenceFingerprint);
}

{
  const out=policy.evaluateCanonicalPromotionEvidence(goodEvidence({historicalExactRowRate:46/47}));
  assert.equal(out.canaryReady,false);
  assert(out.failures.includes('HISTORICAL_CATEGORY_PARITY_FAIL'));
}

{
  const out=policy.evaluateCanonicalPromotionEvidence(goodEvidence({
    documentedLegacyAnomalyIds:['50192386']
  }));
  assert.equal(out.canaryReady,false);
  assert(out.failures.includes('LEGACY_ANOMALY_SET_CHANGED'));
}

{
  const out=policy.evaluateCanonicalPromotionEvidence(goodEvidence({transportMode:'PROVIDER_SEND'}));
  assert.equal(out.canaryReady,false);
  assert(out.failures.includes('CANARY_TRANSPORT_NOT_NO_SEND'));
}

function legacyCandidate() {
  const record=(require('../scoring/legacy-score-authority-2026-09-18.json').records||[])
    .find((item)=>item && item.authorityKey && item.authorityKey.camis &&
      Number(item.sourceCount)===1 &&
      Array.isArray(item.sources) &&
      item.sources.length===1 &&
      String(item.sources[0]).toUpperCase()==='DOHMH' &&
      String(item.stage)==='JUST FILED');
  if(!record) throw new Error('legacy authority fixture missing');
  const camis=String(record.authorityKey.camis);
  return {
    entityId:'CAMIS:'+camis,
    camis,
    projectSignalId:'PS:'+camis,
    canonicalName:'Legacy candidate',
    borough:'Manhattan',
    lifecycleStage:record.stage,
    sourceLatestEffectiveAt:record.lastUpdated,
    sourceSystems:record.sources.slice(),
    sourceCount:Number(record.sourceCount),
    deliverySuppressed:false,
    commercialEvidence:[]
  };
}

{
  const candidate=legacyCandidate();
  const out=policy.scoreCandidateWithPolicy({
    candidate,
    graphDigest:'graph-1',
    observedAt:'2026-09-21T15:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(out.selectedMode,'LEGACY_LITERAL');
  assert.equal(out.productionAuthorized,true);
  assert.equal(out.receipt.status,'SCORED');
  assert.equal(out.receipt.productionAuthorized,true);
  assert.equal(out.receipt.authorityMode,'LEGACY_LITERAL');
}

function dohmh(row) {
  return adapters.normalizeDohmhRow(row,{observedAt:'2026-09-21T15:00:00Z'});
}
function canonicalCandidate() {
  const primary=dohmh({
    camis:'59999991',
    dba:'NEW PIZZA TEST',
    boro:'Manhattan',
    building:'1',
    street:'TEST ST',
    zipcode:'10001',
    phone:'555-0100',
    cuisine_description:'Pizza',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-09-21T14:00:00.000'
  });
  return {
    candidate:{
      entityId:'CAMIS:59999991',
      camis:'59999991',
      projectSignalId:'PS:59999991',
      canonicalName:'NEW PIZZA TEST',
      borough:'Manhattan',
      lifecycleStage:'JUST FILED',
      sourceLatestEffectiveAt:'2026-09-21T14:00:00.000Z',
      sourceSystems:['DOHMH'],
      sourceCount:1,
      deliverySuppressed:false,
      crossCamisOperationalConflicts:[],
      primaryRecord:primary,
      commercialEvidence:[],
      projectSignal:project.buildProjectSignal(primary,[])
    },
    records:[primary]
  };
}

{
  const {candidate,records}=canonicalCandidate();
  const recordsById=shadow.sourceMap(records);
  const out=policy.scoreCandidateWithPolicy({
    candidate,
    graphDigest:'graph-canary',
    recordsById,
    observedAt:'2026-09-21T15:00:00Z',
    promotionEvidence:goodEvidence()
  });
  assert.equal(out.selectedMode,'CANONICAL_V3_CANARY');
  assert.equal(out.productionAuthorized,false);
  assert.equal(out.receipt.status,'CANARY_SCORED');
  assert.equal(out.receipt.productionAuthorized,false);
  assert.equal(out.receipt.authorityMode,'CANONICAL_V3_CANARY');
  assert.equal(out.receipt.scorerVersion,shadow.SHADOW_SCORING_VERSION);
  assert.equal(out.receipt.scores.Equipment,75);
  assert(out.receipt.policyEvidenceFingerprint);
}

{
  const {candidate,records}=canonicalCandidate();
  const out=policy.scoreCandidateWithPolicy({
    candidate,
    graphDigest:'graph-canary',
    recordsById:shadow.sourceMap(records),
    observedAt:'2026-09-21T15:00:00Z',
    promotionEvidence:goodEvidence({currentOverlap:0})
  });
  assert.equal(out.selectedMode,'REVIEW');
  assert.equal(out.productionAuthorized,false);
  assert.equal(out.receipt,null);
  assert(out.promotion.failures.includes('CURRENT_OVERLAP_TOO_SMALL'));
}

assert.equal(policy.PRODUCTION_SCORING_MODE,'LEGACY_LITERAL');
assert.deepEqual(policy.DOCUMENTED_LEGACY_ANOMALIES,['50192386','50192550']);

console.log('PermitPlate scoring promotion policy regression tests passed.');
