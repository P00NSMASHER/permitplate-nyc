'use strict';

const crypto = require('crypto');
const scoring = require('./scoring');
const delivery = require('./delivery-plan');

const SCORE_RECEIPT_VERSION = 'PermitPlate-score-receipt-v1.0.0';

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

function stageNumber(lifecycleStage) {
  const map = {
    'JUST FILED':1,
    'BUILDOUT / LICENSING':2,
    'HEALTH PRE-PERMIT':3,
    'MULTI-SOURCE NEAR-OPENING':4
  };
  return map[String(lifecycleStage || '').toUpperCase()] || null;
}

function ageDays(effectiveAt, scoredAt) {
  const from = Date.parse(String(effectiveAt || ''));
  const to = Date.parse(String(scoredAt || ''));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / (24 * 60 * 60 * 1000);
}

function acceptedDobEvidence(candidate) {
  return (candidate && candidate.commercialEvidence || [])
    .filter((item) => item && item.sourceSystem === 'DOB_NOW');
}

function deriveScoringInput(candidate, authority) {
  const c = candidate || {};
  const a = authority || {};
  const directDob = acceptedDobEvidence(c);
  const tags = new Set(directDob.map((item) => String(item.tag || '').toUpperCase()));
  const stage = stageNumber(c.lifecycleStage);
  const materialAgeDays = ageDays(
    a.materialChangeAt || a.firstDetectedAt || c.sourceLatestEffectiveAt,
    a.scoredAt
  );

  return {
    commercialFit:a.commercialFit,
    materialAgeDays,
    sourceCount:Number(c.sourceCount || (c.sourceSystems || []).length || 0),
    publicPhone:a.publicPhone === true,
    stageNumber:stage,
    sources:Array.isArray(c.sourceSystems) ? c.sourceSystems.slice() : [],
    conceptEvidence:a.conceptEvidence || null,
    knownCuisineType:a.knownCuisineType === true,
    actualDohmhPrePermit:c.lifecycleStage === 'HEALTH PRE-PERMIT',
    strictVenueLinkedHospitalityDob:directDob.length > 0,
    buildingLevelUnmatchedDob:false,
    directEquipmentDobScope:tags.has('EQUIPMENT'),
    directHoodFireDobScope:tags.has('HOOD_FIRE'),
    directHoodExtraScope:a.directHoodExtraScope === true && tags.has('HOOD_FIRE'),
    dobInitialCost:Number.isFinite(Number(a.acceptedDobInitialCost)) ?
      Number(a.acceptedDobInitialCost) : null
  };
}

function buildScoreReceipt(input) {
  const data = input || {};
  const candidate = data.candidate || {};
  const graphDigest = String(data.graphDigest || '');
  const changeFingerprint = delivery.candidateChangeFingerprint(candidate);
  const authority = data.authority || {};
  const scoringInput = deriveScoringInput(candidate, authority);
  const scored = scoring.computeScores(scoringInput);
  const inputFingerprint = sha256(stableStringify(scoringInput));

  if (scored.status !== 'SCORED') {
    return {
      receiptVersion:SCORE_RECEIPT_VERSION,
      status:'REVIEW',
      entityId:candidate.entityId || null,
      graphDigest:graphDigest || null,
      changeFingerprint,
      scoringVersion:scoring.SCORING_VERSION,
      inputFingerprint,
      errors:scored.errors || ['SCORING_FAILED']
    };
  }

  const scoreReceiptId = 'SCORE:' + sha256(stableStringify({
    receiptVersion:SCORE_RECEIPT_VERSION,
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scoringVersion:scoring.SCORING_VERSION,
    inputFingerprint,
    scores:scored.scores
  })).slice(0,24);

  return {
    receiptVersion:SCORE_RECEIPT_VERSION,
    status:'SCORED',
    scoreReceiptId,
    entityId:candidate.entityId,
    graphDigest,
    changeFingerprint,
    scoredAt:authority.scoredAt,
    scoringVersion:scoring.SCORING_VERSION,
    scorerVersion:scoring.SCORING_VERSION,
    inputFingerprint,
    scores:scored.scores,
    bestVendorFit:scored.bestVendorFit,
    bestScore:scored.bestScore,
    reasons:scored.reasons
  };
}

module.exports = {
  SCORE_RECEIPT_VERSION,
  stableStringify,
  sha256,
  stageNumber,
  ageDays,
  deriveScoringInput,
  buildScoreReceipt
};
