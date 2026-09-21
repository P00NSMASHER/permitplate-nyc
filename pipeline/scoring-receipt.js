'use strict';

const crypto = require('crypto');
const scoring = require('./scoring');
const delivery = require('./delivery-plan');

const SCORE_RECEIPT_VERSION = 'PermitPlate-score-receipt-v1.1.0';

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

function buildScoreReceipt(input) {
  const data = input || {};
  const candidate = data.candidate || {};
  const graphDigest = String(data.graphDigest || '');
  const changeFingerprint = delivery.candidateChangeFingerprint(candidate);
  const resolved = scoring.resolveScoreAuthority(candidate);

  if (resolved.status !== 'SCORED') {
    return {
      receiptVersion:SCORE_RECEIPT_VERSION,
      status:'REVIEW',
      entityId:candidate.entityId || null,
      graphDigest:graphDigest || null,
      changeFingerprint,
      scoringVersion:scoring.SCORING_VERSION,
      scorerVersion:scoring.SCORING_VERSION,
      authorityMode:'LEGACY_LITERAL',
      productionAuthorized:false,
      authorityId:resolved.authorityId || null,
      authorityRecordFingerprint:resolved.authorityRecordFingerprint || null,
      errors:resolved.errors || ['SCORE_AUTHORITY_FAILED']
    };
  }

  const scoreReceiptId = 'SCORE:' + sha256(stableStringify({
    receiptVersion:SCORE_RECEIPT_VERSION,
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scoringVersion:scoring.SCORING_VERSION,
    authorityId:resolved.authorityId,
    authorityRecordFingerprint:resolved.authorityRecordFingerprint,
    scores:resolved.scores,
    bestVendorFit:resolved.bestVendorFit,
    bestScore:resolved.bestScore
  })).slice(0,24);

  return {
    receiptVersion:SCORE_RECEIPT_VERSION,
    status:'SCORED',
    scoreReceiptId,
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scoredAt:data.scoredAt || resolved.authorityCutoff || null,
    scoringVersion:scoring.SCORING_VERSION,
    scorerVersion:scoring.SCORING_VERSION,
    authorityMode:'LEGACY_LITERAL',
    productionAuthorized:true,
    authorityId:resolved.authorityId,
    authorityKind:resolved.authorityKind,
    authorityRecordFingerprint:resolved.authorityRecordFingerprint,
    authorityCutoff:resolved.authorityCutoff,
    commercialFit:resolved.commercialFit,
    scores:resolved.scores,
    bestVendorFit:resolved.bestVendorFit,
    bestScore:resolved.bestScore,
    purchaseWindow:resolved.purchaseWindow,
    intelligenceStatus:resolved.intelligenceStatus,
    confidence:resolved.confidence
  };
}

module.exports = {
  SCORE_RECEIPT_VERSION,
  stableStringify,
  sha256,
  buildScoreReceipt
};
