'use strict';

const crypto = require('crypto');
const shadow = require('./shadow-scoring-v3');
const delivery = require('./delivery-plan');

const CANONICAL_SCORE_RECEIPT_VERSION = 'PermitPlate-canonical-score-receipt-v1.0.0';

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

function buildCanonicalCanaryScoreReceipt(input) {
  const data = input || {};
  const candidate = data.candidate || {};
  const graphDigest = String(data.graphDigest || '');
  const changeFingerprint = delivery.candidateChangeFingerprint(candidate);
  const scored = shadow.computeShadowScores(
    candidate,
    data.recordsById instanceof Map ? data.recordsById : shadow.sourceMap(data.sourceRecords || []),
    data.observedAt
  );

  if (scored.status !== 'SHADOW_SCORED') {
    return {
      receiptVersion:CANONICAL_SCORE_RECEIPT_VERSION,
      status:'REVIEW',
      authorityMode:'CANONICAL_V3_CANARY',
      productionAuthorized:false,
      entityId:candidate.entityId || null,
      graphDigest:graphDigest || null,
      changeFingerprint,
      scorerVersion:shadow.SHADOW_SCORING_VERSION,
      scoringVersion:shadow.SHADOW_SCORING_VERSION,
      errors:scored.errors || ['CANONICAL_SHADOW_SCORE_FAILED']
    };
  }

  const policyEvidenceFingerprint = data.policyEvidenceFingerprint || null;
  const scoreReceiptId = 'CANARY-SCORE:' + sha256(stableStringify({
    receiptVersion:CANONICAL_SCORE_RECEIPT_VERSION,
    authorityMode:'CANONICAL_V3_CANARY',
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scorerVersion:shadow.SHADOW_SCORING_VERSION,
    policyEvidenceFingerprint,
    scores:scored.scores,
    bestVendorFit:scored.bestVendorFit,
    bestScore:scored.bestScore
  })).slice(0,24);

  return {
    receiptVersion:CANONICAL_SCORE_RECEIPT_VERSION,
    status:'CANARY_SCORED',
    scoreReceiptId,
    authorityMode:'CANONICAL_V3_CANARY',
    productionAuthorized:false,
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scoredAt:data.observedAt || null,
    scorerVersion:shadow.SHADOW_SCORING_VERSION,
    scoringVersion:shadow.SHADOW_SCORING_VERSION,
    policyEvidenceFingerprint,
    fitReceiptId:scored.fitReceipt && scored.fitReceipt.fitReceiptId || null,
    commercialFit:scored.fitReceipt && scored.fitReceipt.fit || null,
    scores:scored.scores,
    bestVendorFit:scored.bestVendorFit,
    bestScore:scored.bestScore,
    input:scored.input
  };
}

module.exports = {
  CANONICAL_SCORE_RECEIPT_VERSION,
  stableStringify,
  sha256,
  buildCanonicalCanaryScoreReceipt
};
