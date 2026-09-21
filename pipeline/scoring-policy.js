'use strict';

const crypto = require('crypto');
const legacyReceipt = require('./scoring-receipt');
const canonicalReceipt = require('./canonical-score-receipt');

const SCORING_POLICY_VERSION = 'PermitPlate-scoring-policy-v1.0.0';
const PRODUCTION_SCORING_MODE = 'LEGACY_LITERAL';
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

function scoreCandidateWithPolicy(input) {
  const data = input || {};
  const candidate = data.candidate || {};
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
      fallbackReason:null
    };
  }

  const promotion = evaluateCanonicalPromotionEvidence(data.promotionEvidence || {});
  if (!promotion.canaryReady) {
    return {
      policyVersion:SCORING_POLICY_VERSION,
      selectedMode:'REVIEW',
      productionAuthorized:false,
      receipt:null,
      fallbackReason:'NO_VALID_LEGACY_AUTHORITY_AND_CANARY_GATE_NOT_READY',
      legacyErrors:legacy.errors || [],
      promotion
    };
  }

  const canonical = canonicalReceipt.buildCanonicalCanaryScoreReceipt({
    candidate,
    graphDigest:data.graphDigest,
    recordsById:data.recordsById,
    sourceRecords:data.sourceRecords,
    observedAt:data.observedAt,
    policyEvidenceFingerprint:promotion.evidenceFingerprint
  });

  return {
    policyVersion:SCORING_POLICY_VERSION,
    selectedMode:canonical.status === 'CANARY_SCORED' ? 'CANONICAL_V3_CANARY' : 'REVIEW',
    productionAuthorized:false,
    receipt:canonical.status === 'CANARY_SCORED' ? canonical : null,
    fallbackReason:canonical.status === 'CANARY_SCORED' ?
      'LEGACY_AUTHORITY_UNAVAILABLE_CANONICAL_CANARY_ONLY' :
      'CANONICAL_CANARY_SCORE_FAILED',
    legacyErrors:legacy.errors || [],
    canonicalErrors:canonical.errors || [],
    promotion
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
  scoreCandidateWithPolicy
};
