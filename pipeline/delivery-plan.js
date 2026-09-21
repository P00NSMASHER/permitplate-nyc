'use strict';

const crypto = require('crypto');
const model = require('../model-v7');

const DELIVERY_PLANNER_VERSION = 'PermitPlate-delivery-plan-v1.0.0';

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

function text(value) {
  return value == null ? '' : String(value).trim();
}

function candidateChangeFingerprint(candidate) {
  const c = candidate || {};
  return sha256(stableStringify({
    entityId: c.entityId || null,
    projectSignalId: c.projectSignalId || null,
    lifecycleStage: c.lifecycleStage || null,
    sourceLatestEffectiveAt: c.sourceLatestEffectiveAt || null,
    sourceSystems: Array.isArray(c.sourceSystems) ? c.sourceSystems.slice().sort() : [],
    commercialEvidence: (c.commercialEvidence || []).map((item) => ({
      tag: item && item.tag || null,
      sourceSystem: item && item.sourceSystem || null,
      sourceRecordId: item && item.sourceRecordId || null
    })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)))
  }));
}

function uniqueIndex(rows, keyField) {
  const out = new Map();
  for (const row of rows || []) {
    const key = text(row && row[keyField]);
    if (!key) continue;
    if (out.has(key)) throw new Error(`Duplicate ${keyField}: ${key}`);
    out.set(key, row);
  }
  return out;
}

function categoryScoreKey(category) {
  const normalized = text(category).toUpperCase().replace(/[^A-Z]/g, '');
  const map = {
    POS: 'POS',
    INSURANCE: 'Insurance',
    EQUIPMENT: 'Equipment',
    HOODFIRE: 'Hood/Fire',
    WASTE: 'Waste',
    PEST: 'Pest',
    LINEN: 'Linen',
    DISTRIBUTION: 'Distribution'
  };
  return map[normalized] || null;
}

function validScore(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

function boroughAllowed(candidate, profile) {
  const allowed = Array.isArray(profile && profile.boroughs) ?
    profile.boroughs.map((value) => text(value).toUpperCase()).filter(Boolean) : [];
  if (!allowed.length) return true;
  return allowed.includes(text(candidate && candidate.borough).toUpperCase());
}

function validateDetectionReceipt(candidate, receipt, fingerprint) {
  const reasons = [];
  if (!receipt) reasons.push('DETECTION_RECEIPT_MISSING');
  else {
    if (text(receipt.entityId) !== text(candidate.entityId)) reasons.push('DETECTION_ENTITY_MISMATCH');
    if (text(receipt.changeFingerprint) !== fingerprint) reasons.push('DETECTION_CHANGE_MISMATCH');
    if (!receipt.firstDetectedAt && !receipt.materialChangeAt && !receipt.reopenAt) {
      reasons.push('DETECTION_TIME_MISSING');
    }
  }
  return reasons;
}

function validateScoreReceipt(candidate, receipt, fingerprint, graphDigest, category) {
  const reasons = [];
  if (!receipt) return {reasons: ['SCORE_RECEIPT_MISSING'], score: null};

  if (text(receipt.entityId) !== text(candidate.entityId)) reasons.push('SCORE_ENTITY_MISMATCH');
  if (text(receipt.changeFingerprint) !== fingerprint) reasons.push('SCORE_CHANGE_MISMATCH');
  if (graphDigest && text(receipt.graphDigest) !== text(graphDigest)) reasons.push('SCORE_GRAPH_MISMATCH');
  if (!text(receipt.scorerVersion)) reasons.push('SCORER_VERSION_MISSING');
  if (receipt.productionAuthorized !== true) reasons.push('SCORE_NOT_PRODUCTION_AUTHORIZED');

  const key = categoryScoreKey(category);
  if (!key) reasons.push('PROFILE_CATEGORY_UNKNOWN');
  const score = key && receipt.scores ? validScore(receipt.scores[key]) : null;
  if (key && score === null) reasons.push('CATEGORY_SCORE_INVALID');

  return {reasons, score, scoreKey: key};
}

function signalKey(subscriberId, section, candidate, fingerprint, baselineAt) {
  if (section === 'STARTER') {
    return `starter:${subscriberId}:${baselineAt}:${candidate.entityId}`;
  }
  return `normal:${subscriberId}:${fingerprint}`;
}

function sortSignals(a, b) {
  return b.selectedScore - a.selectedScore ||
    text(b.effectiveAt).localeCompare(text(a.effectiveAt)) ||
    text(a.entityId).localeCompare(text(b.entityId));
}

function planCustomerDelivery(input) {
  const data = input || {};
  const graph = data.graph || {};
  const profile = data.profile || {};
  const subscriberId = text(profile.subscriberId);
  const baselineAt = text(profile.baselineAt);
  const maxSignals = Math.max(1, Math.min(25, Number(profile.maxSignals) || 25));
  const starterLimit = Math.max(0, Math.min(10, Number(profile.starterLimit) || 10));
  const minimumScore = Math.max(0, Math.min(100, Number(profile.minimumScore) || 0));
  const requireCompleteGraph = profile.requireCompleteGraph !== false;

  const planFailures = [];
  if (!subscriberId) planFailures.push('SUBSCRIBER_ID_MISSING');
  if (model.classifySubscriberEligibility({baselineAt}).reason === 'BASELINE_INVALID') {
    planFailures.push('BASELINE_INVALID');
  }
  if (requireCompleteGraph && graph.graphState !== 'COMPLETE') {
    planFailures.push('GRAPH_NOT_COMPLETE');
  }
  if (!text(graph.graphDigest)) planFailures.push('GRAPH_DIGEST_MISSING');
  if (!categoryScoreKey(profile.category)) planFailures.push('PROFILE_CATEGORY_UNKNOWN');

  if (planFailures.length) {
    return {
      plannerVersion: DELIVERY_PLANNER_VERSION,
      status: 'REVIEW',
      failures: planFailures,
      signals: [],
      reviews: [],
      excluded: [],
      planFingerprint: sha256(stableStringify({version: DELIVERY_PLANNER_VERSION, failures: planFailures.sort()}))
    };
  }

  const detectionById = uniqueIndex(data.detectionReceipts, 'receiptId');
  const scoreById = uniqueIndex(data.scoreReceipts, 'scoreReceiptId');
  const delivered = data.deliveredSignalKeys instanceof Set ?
    data.deliveredSignalKeys : new Set(data.deliveredSignalKeys || []);

  const normal = [];
  const starter = [];
  const reviews = [];
  const excluded = [];

  for (const candidate of graph.candidates || []) {
    const fingerprint = candidateChangeFingerprint(candidate);
    const reasons = [];

    if (candidate.deliverySuppressed === true) reasons.push('CANDIDATE_SUPPRESSED');
    if (!boroughAllowed(candidate, profile)) reasons.push('BOROUGH_FILTERED');

    const detectionReceipt = detectionById.get(text(candidate.detectionReceiptId));
    reasons.push(...validateDetectionReceipt(candidate, detectionReceipt, fingerprint));

    const scoreReceipt = scoreById.get(text(candidate.scoreReceiptId));
    const scoreCheck = validateScoreReceipt(
      candidate, scoreReceipt, fingerprint, graph.graphDigest, profile.category
    );
    reasons.push(...scoreCheck.reasons);

    if (reasons.length) {
      const hardReview = reasons.some((reason) =>
        reason.includes('RECEIPT') ||
        reason.includes('MISMATCH') ||
        reason.includes('INVALID') ||
        reason.includes('MISSING')
      );
      (hardReview ? reviews : excluded).push({
        entityId: candidate.entityId,
        reasons,
        changeFingerprint: fingerprint
      });
      continue;
    }

    const eligibility = model.classifySubscriberEligibility({
      baselineAt,
      firstSignalAt: detectionReceipt.firstDetectedAt,
      materialChangeAt: detectionReceipt.materialChangeAt,
      qualifyingReopen: detectionReceipt.qualifyingReopen === true,
      reopenAt: detectionReceipt.reopenAt,
      starterSnapshotEnabled: profile.starterSnapshotEnabled === true,
      starterDays: profile.starterDays == null ? 7 : profile.starterDays
    });

    if (!eligibility.eligible) {
      excluded.push({
        entityId: candidate.entityId,
        reasons: [eligibility.reason],
        changeFingerprint: fingerprint
      });
      continue;
    }

    if (scoreCheck.score < minimumScore) {
      excluded.push({
        entityId: candidate.entityId,
        reasons: ['BELOW_SCORE_THRESHOLD'],
        changeFingerprint: fingerprint
      });
      continue;
    }

    const key = signalKey(subscriberId, eligibility.section, candidate, fingerprint, baselineAt);
    if (delivered.has(key)) {
      excluded.push({
        entityId: candidate.entityId,
        reasons: ['ALREADY_DELIVERED'],
        changeFingerprint: fingerprint,
        signalKey: key
      });
      continue;
    }

    const signal = {
      signalKey: key,
      section: eligibility.section,
      eligibilityReason: eligibility.reason,
      entityId: candidate.entityId,
      changeFingerprint: fingerprint,
      projectSignalId: candidate.projectSignalId || null,
      name: candidate.canonicalName || null,
      borough: candidate.borough || null,
      lifecycleStage: candidate.lifecycleStage || null,
      selectedScore: scoreCheck.score,
      scoreKey: scoreCheck.scoreKey,
      scoreReceiptId: scoreReceipt.scoreReceiptId,
      scorerVersion: scoreReceipt.scorerVersion,
      detectionReceiptId: detectionReceipt.receiptId,
      effectiveAt: detectionReceipt.materialChangeAt ||
        detectionReceipt.reopenAt ||
        detectionReceipt.firstDetectedAt,
      sourceSystems: Array.isArray(candidate.sourceSystems) ? candidate.sourceSystems.slice().sort() : [],
      commercialEvidence: candidate.commercialEvidence || []
    };

    if (eligibility.section === 'STARTER') starter.push(signal);
    else normal.push(signal);
  }

  normal.sort(sortSignals);
  starter.sort(sortSignals);

  const selectedNormal = normal.slice(0, maxSignals);
  const remaining = Math.max(0, maxSignals - selectedNormal.length);
  const selectedStarter = starter.slice(0, Math.min(starterLimit, remaining));
  const signals = selectedNormal.concat(selectedStarter);

  const planFingerprint = sha256(stableStringify({
    plannerVersion: DELIVERY_PLANNER_VERSION,
    subscriberId,
    baselineAt,
    graphDigest: graph.graphDigest,
    category: profile.category,
    boroughs: profile.boroughs || [],
    minimumScore,
    signalKeys: signals.map((signal) => signal.signalKey)
  }));

  return {
    plannerVersion: DELIVERY_PLANNER_VERSION,
    status: 'READY',
    failures: [],
    subscriberId,
    baselineAt,
    graphDigest: graph.graphDigest,
    category: profile.category,
    minimumScore,
    normalCount: selectedNormal.length,
    starterCount: selectedStarter.length,
    signals,
    reviews,
    excluded,
    planFingerprint
  };
}

function createDeliveryAttempt(plan, recipient) {
  if (!plan || plan.status !== 'READY') throw new Error('READY delivery plan required');
  const email = text(recipient).toLowerCase();
  if (!email || !email.includes('@')) throw new Error('valid recipient required');
  const attemptId = 'PP-ATTEMPT-' + sha256(stableStringify([
    plan.planFingerprint,
    email,
    plan.signals.map((signal) => signal.signalKey)
  ])).slice(0, 20);
  const messageIdentity = 'PP-MSG-' + sha256(stableStringify([attemptId, email])).slice(0, 24);
  return {
    attemptId,
    messageIdentity,
    recipient: email,
    planFingerprint: plan.planFingerprint,
    signalKeys: plan.signals.map((signal) => signal.signalKey),
    state: 'PLANNED'
  };
}

function reconcileProviderObservation(attempt, providerObservation, deliveredSignalKeys) {
  const delivered = deliveredSignalKeys instanceof Set ?
    deliveredSignalKeys : new Set(deliveredSignalKeys || []);
  const observation = providerObservation || {};

  if (!attempt || attempt.state !== 'PLANNED') {
    return {state: 'REVIEW', reason: 'ATTEMPT_NOT_PLANNED', delivered};
  }
  if (observation.status !== 'ACCEPTED') {
    return {state: observation.status === 'REJECTED' ? 'REJECTED' : 'PENDING', reason: 'PROVIDER_NOT_CONFIRMED', delivered};
  }
  if (text(observation.messageIdentity) !== text(attempt.messageIdentity)) {
    return {state: 'REVIEW', reason: 'MESSAGE_IDENTITY_MISMATCH', delivered};
  }
  if (!text(observation.providerMessageId)) {
    return {state: 'REVIEW', reason: 'PROVIDER_MESSAGE_ID_MISSING', delivered};
  }

  const newlyDelivered = [];
  for (const key of attempt.signalKeys) {
    if (delivered.has(key)) continue;
    delivered.add(key);
    newlyDelivered.push(key);
  }

  return {
    state: 'FINALIZED',
    reason: newlyDelivered.length ? 'PROVIDER_ACCEPTED' : 'IDEMPOTENT_REPLAY',
    providerMessageId: observation.providerMessageId,
    newlyDelivered,
    delivered
  };
}

module.exports = {
  DELIVERY_PLANNER_VERSION,
  stableStringify,
  sha256,
  candidateChangeFingerprint,
  categoryScoreKey,
  validateDetectionReceipt,
  validateScoreReceipt,
  signalKey,
  planCustomerDelivery,
  createDeliveryAttempt,
  reconcileProviderObservation
};
