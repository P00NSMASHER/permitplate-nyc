'use strict';

const crypto = require('crypto');
const legacyReceipt = require('./scoring-receipt');
const canonicalReceipt = require('./canonical-score-receipt');
const promotionRecord = require('../scoring/canonical-v3-promotion-record.json');

const SCORING_POLICY_VERSION = 'PermitPlate-scoring-policy-v1.0.0';
const PRODUCTION_SCORING_MODE = 'CANONICAL_V3_WITH_LEGACY_FALLBACK';
const DOCUMENTED_LEGACY_ANOMALIES = Object.freeze(['50192386','50192550']);

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

function normalizeIds(values) {
  return Array.from(new Set((values || []).map(String).filter(Boolean))).sort();
}

function evaluateCanonicalPromotionEvidence(input) {
  const e = input || {};
  const failures = [];

  if (e.graphState !== 'COMPLETE') failures.push('GRAPH_NOT_COMPLETE');
  if (Number(e.shadowCoverageRate) !== 1) failures.push('SHADOW_COVERAGE_NOT_FULL');

  if (!Number.isInteger(Number(e.currentOverlap)) || Number(e.currentOverlap) < 10) {
    failures.push('CURRENT_OVERLAP_TOO_SMALL');
  }
  if (Number(e.currentExactAllCategoryRate) !== 1) failures.push('CURRENT_CATEGORY_PARITY_FAIL');
  if (Number(e.currentBestFitAgreementRate) !== 1) failures.push('CURRENT_BEST_FIT_PARITY_FAIL');

  if (!Number.isInteger(Number(e.historicalRecordCount)) || Number(e.historicalRecordCount) < 47) {
    failures.push('HISTORICAL_BENCHMARK_TOO_SMALL');
  }
  if (Number(e.historicalExactRowRate) !== 1) failures.push('HISTORICAL_CATEGORY_PARITY_FAIL');
  if (Number(e.historicalFitAgreementRate) !== 1) failures.push('HISTORICAL_FIT_PARITY_FAIL');
  if (Number(e.historicalBestFitAgreementRate) !== 1) failures.push('HISTORICAL_BEST_FIT_PARITY_FAIL');

  const anomalyIds = normalizeIds(e.documentedLegacyAnomalyIds);
  if (stableStringify(anomalyIds) !== stableStringify(DOCUMENTED_LEGACY_ANOMALIES)) {
    failures.push('LEGACY_ANOMALY_SET_CHANGED');
  }

  if (e.transportMode !== 'NO_SEND') failures.push('CANARY_TRANSPORT_NOT_NO_SEND');

  const evidence = {
    graphState:e.graphState || null,
    shadowCoverageRate:Number(e.shadowCoverageRate),
    currentOverlap:Number(e.currentOverlap),
    currentExactAllCategoryRate:Number(e.currentExactAllCategoryRate),
    currentBestFitAgreementRate:Number(e.currentBestFitAgreementRate),
    historicalRecordCount:Number(e.historicalRecordCount),
    historicalExactRowRate:Number(e.historicalExactRowRate),
    historicalFitAgreementRate:Number(e.historicalFitAgreementRate),
    historicalBestFitAgreementRate:Number(e.historicalBestFitAgreementRate),
    documentedLegacyAnomalyIds:anomalyIds,
    transportMode:e.transportMode || null
  };

  const evidenceFingerprint = sha256(stableStringify(evidence));
  return {
    policyVersion:SCORING_POLICY_VERSION,
    productionScoringMode:PRODUCTION_SCORING_MODE,
    canaryReady:failures.length === 0,
    productionAuthorized:false,
    failures,
    evidence,
    evidenceFingerprint,
    nextMode:failures.length === 0 ? 'CANONICAL_V3_CANARY' : 'REVIEW'
  };
}

function validatePromotionRecord(record) {
  const r=record || {};
  const failures=[];
  if (r.status!=='APPROVED_FOR_INTERNAL_PRODUCTION_SCORING') failures.push('PROMOTION_RECORD_NOT_APPROVED');
  if (r.policyVersion!==SCORING_POLICY_VERSION) failures.push('PROMOTION_RECORD_POLICY_VERSION_MISMATCH');
  if (r.targetProductionMode!==PRODUCTION_SCORING_MODE) failures.push('PROMOTION_RECORD_MODE_MISMATCH');
  if (r.rollbackMode!=='LEGACY_LITERAL') failures.push('PROMOTION_RECORD_ROLLBACK_INVALID');
  if (r.externalTransportAllowed!==false) failures.push('PROMOTION_RECORD_EXTERNAL_TRANSPORT_NOT_DISABLED');
  if (r.transportMode!=='NO_SEND') failures.push('PROMOTION_RECORD_TRANSPORT_MODE_INVALID');
  if (stableStringify(normalizeIds(r.referenceCanary&&r.referenceCanary.documentedLegacyAnomalyIds)) !==
      stableStringify(DOCUMENTED_LEGACY_ANOMALIES)) {
    failures.push('PROMOTION_RECORD_ANOMALY_SET_MISMATCH');
  }
  return {
    valid:failures.length===0,
    failures,
    promotionRecordId:r.promotionRecordId || null
  };
}

function authorizeCanonicalReceipt(canaryReceipt,promotion) {
  const recordCheck=validatePromotionRecord(promotionRecord);
  const failures=[];
  if (!promotion || promotion.canaryReady!==true) failures.push('FRESH_PROMOTION_EVIDENCE_NOT_READY');
  if (!recordCheck.valid) failures.push(...recordCheck.failures);
  if (!canaryReceipt || canaryReceipt.status!=='CANARY_SCORED') failures.push('CANONICAL_CANARY_RECEIPT_INVALID');
  if (canaryReceipt && canaryReceipt.productionAuthorized!==false) failures.push('CANONICAL_CANARY_AUTHORIZATION_STATE_INVALID');
  if (canaryReceipt && promotion &&
      canaryReceipt.policyEvidenceFingerprint!==promotion.evidenceFingerprint) {
    failures.push('CANONICAL_POLICY_EVIDENCE_FINGERPRINT_MISMATCH');
  }
  if (canaryReceipt &&
      promotionRecord.canonicalScoringVersion!==canaryReceipt.scorerVersion) {
    failures.push('PROMOTION_RECORD_SCORER_VERSION_MISMATCH');
  }
  if (failures.length) {
    return {authorized:false,failures,receipt:null,promotionRecordId:recordCheck.promotionRecordId};
  }

  const base=Object.assign({},canaryReceipt,{
    status:'SCORED',
    authorityMode:'CANONICAL_V3_PRODUCTION',
    productionAuthorized:true,
    promotionRecordId:promotionRecord.promotionRecordId,
    promotionEvidenceFingerprint:promotion.evidenceFingerprint,
    canaryScoreReceiptId:canaryReceipt.scoreReceiptId
  });
  base.scoreReceiptId='SCORE:'+sha256(stableStringify({
    receiptVersion:base.receiptVersion,
    authorityMode:base.authorityMode,
    promotionRecordId:base.promotionRecordId,
    promotionEvidenceFingerprint:base.promotionEvidenceFingerprint,
    canaryScoreReceiptId:base.canaryScoreReceiptId,
    entityId:base.entityId,
    graphDigest:base.graphDigest,
    changeFingerprint:base.changeFingerprint,
    scorerVersion:base.scorerVersion,
    scores:base.scores,
    bestVendorFit:base.bestVendorFit,
    bestScore:base.bestScore
  })).slice(0,24);
  return {
    authorized:true,
    failures:[],
    receipt:base,
    promotionRecordId:promotionRecord.promotionRecordId
  };
}

function scoreCandidateWithPolicy(input) {
  const data = input || {};
  const candidate = data.candidate || {};
  const promotion = evaluateCanonicalPromotionEvidence(data.promotionEvidence || {});

  const canonicalCanary = promotion.canaryReady ?
    canonicalReceipt.buildCanonicalCanaryScoreReceipt({
      candidate,
      graphDigest:data.graphDigest,
      recordsById:data.recordsById,
      sourceRecords:data.sourceRecords,
      observedAt:data.observedAt,
      policyEvidenceFingerprint:promotion.evidenceFingerprint
    }) : null;

  if (PRODUCTION_SCORING_MODE==='CANONICAL_V3_WITH_LEGACY_FALLBACK' &&
      canonicalCanary && canonicalCanary.status==='CANARY_SCORED') {
    const authorized=authorizeCanonicalReceipt(canonicalCanary,promotion);
    if (authorized.authorized) {
      return {
        policyVersion:SCORING_POLICY_VERSION,
        selectedMode:'CANONICAL_V3_PRODUCTION',
        productionAuthorized:true,
        receipt:authorized.receipt,
        fallbackReason:null,
        promotion,
        promotionRecordId:authorized.promotionRecordId
      };
    }
  }

  const legacy = legacyReceipt.buildScoreReceipt({
    candidate,
    graphDigest:data.graphDigest,
    scoredAt:data.observedAt
  });
  if (legacy.status === 'SCORED' && legacy.productionAuthorized === true) {
    return {
      policyVersion:SCORING_POLICY_VERSION,
      selectedMode:'LEGACY_LITERAL',
      productionAuthorized:true,
      receipt:legacy,
      fallbackReason:promotion.canaryReady ?
        'CANONICAL_PRODUCTION_AUTHORIZATION_FAILED_LEGACY_FALLBACK' :
        'CANONICAL_GATE_NOT_READY_LEGACY_FALLBACK',
      promotion
    };
  }

  return {
    policyVersion:SCORING_POLICY_VERSION,
    selectedMode:'REVIEW',
    productionAuthorized:false,
    receipt:null,
    fallbackReason:promotion.canaryReady ?
      'CANONICAL_AUTHORIZATION_FAILED_AND_NO_VALID_LEGACY_AUTHORITY' :
      'CANONICAL_GATE_NOT_READY_AND_NO_VALID_LEGACY_AUTHORITY',
    legacyErrors:legacy.errors || [],
    canonicalErrors:canonicalCanary&&canonicalCanary.errors || [],
    promotion,
    promotionRecordValidation:validatePromotionRecord(promotionRecord)
  };
}

module.exports = {
  SCORING_POLICY_VERSION,
  PRODUCTION_SCORING_MODE,
  DOCUMENTED_LEGACY_ANOMALIES,
  stableStringify,
  sha256,
  normalizeIds,
  evaluateCanonicalPromotionEvidence,
  validatePromotionRecord,
  authorizeCanonicalReceipt,
  scoreCandidateWithPolicy
};
