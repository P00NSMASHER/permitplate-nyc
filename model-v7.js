'use strict';

const MODEL_VERSION = 'PermitPlate-v7.1.0';

const STAGE_RANK = Object.freeze({
  'JUST FILED': 1,
  'BUILDOUT / LICENSING': 2,
  'HEALTH PRE-PERMIT': 3,
  'MULTI-SOURCE NEAR-OPENING': 4
});

const SOURCE_OBSERVATION_STATES = Object.freeze({
  VERIFIED_EMPTY: 'VERIFIED_EMPTY',
  COMPLETE_NONEMPTY: 'COMPLETE_NONEMPTY',
  PARTIAL: 'PARTIAL',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_MOVED: 'SOURCE_MOVED',
  UNKNOWN: 'UNKNOWN'
});

const COMPLETE_SOURCE_STATES = new Set([
  SOURCE_OBSERVATION_STATES.VERIFIED_EMPTY,
  SOURCE_OBSERVATION_STATES.COMPLETE_NONEMPTY
]);

const POSITIVE_OBSERVATION_STATES = new Set([
  SOURCE_OBSERVATION_STATES.COMPLETE_NONEMPTY,
  SOURCE_OBSERVATION_STATES.PARTIAL
]);

function norm(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenSet(value) {
  return new Set(norm(value).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function fnv1a(value) {
  let h = 0x811c9dc5;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function stateHash(state) {
  return fnv1a(stableStringify(state || {}));
}

function nonnegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function classifySourceObservation(receipt) {
  const r = receipt || {};
  const fetchedCount = nonnegativeInteger(r.fetchedCount);
  const publisherCount = nonnegativeInteger(r.publisherCount);
  const httpStatus = Number(r.httpStatus);

  if (r.transportOk === false || (Number.isFinite(httpStatus) && httpStatus >= 400)) {
    if (fetchedCount !== null && fetchedCount > 0) {
      return {
        state: SOURCE_OBSERVATION_STATES.PARTIAL,
        supportsPositiveObservation: true,
        supportsAbsenceConclusion: false,
        reason: 'PARTIAL_FETCH_BEFORE_FAILURE'
      };
    }
    return {
      state: SOURCE_OBSERVATION_STATES.SOURCE_UNAVAILABLE,
      supportsPositiveObservation: false,
      supportsAbsenceConclusion: false,
      reason: 'TRANSPORT_OR_HTTP_FAILURE'
    };
  }

  if (r.sourceMoved === true || r.redirected === true || r.redirectTarget) {
    return {
      state: SOURCE_OBSERVATION_STATES.SOURCE_MOVED,
      supportsPositiveObservation: false,
      supportsAbsenceConclusion: false,
      reason: 'SOURCE_MOVED'
    };
  }

  if (r.sourceFresh === false) {
    return {
      state: SOURCE_OBSERVATION_STATES.UNKNOWN,
      supportsPositiveObservation: false,
      supportsAbsenceConclusion: false,
      reason: 'SOURCE_NOT_FRESH'
    };
  }

  const evidenceBound = Boolean(
    r.sourceId &&
    r.connectorConfigHash &&
    r.queryFingerprint &&
    r.observedAt &&
    r.sourceFresh === true &&
    r.schemaFingerprint &&
    Array.isArray(r.rawPageHashes) &&
    r.rawPageHashes.length > 0 &&
    r.rawPageHashes.every(Boolean)
  );
  const fullScope = r.intendedFullScope === true;
  const cursorClosed = r.cursorClosed === true;

  if (!fullScope) {
    const state = fetchedCount > 0 ?
      SOURCE_OBSERVATION_STATES.PARTIAL :
      SOURCE_OBSERVATION_STATES.UNKNOWN;
    return {
      state,
      supportsPositiveObservation: state === SOURCE_OBSERVATION_STATES.PARTIAL,
      supportsAbsenceConclusion: false,
      reason: fetchedCount > 0 ? 'SAMPLED_POSITIVE_OBSERVATION' : 'SAMPLED_OR_UNKNOWN_EMPTY'
    };
  }

  if (!evidenceBound || !cursorClosed || fetchedCount === null || publisherCount === null) {
    const state = fetchedCount > 0 ?
      SOURCE_OBSERVATION_STATES.PARTIAL :
      SOURCE_OBSERVATION_STATES.UNKNOWN;
    return {
      state,
      supportsPositiveObservation: state === SOURCE_OBSERVATION_STATES.PARTIAL,
      supportsAbsenceConclusion: false,
      reason: 'COMPLETENESS_EVIDENCE_INSUFFICIENT'
    };
  }

  if (publisherCount !== fetchedCount) {
    return {
      state: SOURCE_OBSERVATION_STATES.PARTIAL,
      supportsPositiveObservation: fetchedCount > 0,
      supportsAbsenceConclusion: false,
      reason: 'COUNT_MISMATCH'
    };
  }

  const state = fetchedCount === 0 ?
    SOURCE_OBSERVATION_STATES.VERIFIED_EMPTY :
    SOURCE_OBSERVATION_STATES.COMPLETE_NONEMPTY;

  return {
    state,
    supportsPositiveObservation: fetchedCount > 0,
    supportsAbsenceConclusion: true,
    reason: fetchedCount === 0 ? 'COUNT_ZERO_AND_SOURCE_CLOSED' : 'COUNT_MATCH_AND_SOURCE_CLOSED'
  };
}

function absenceMutationGate(input) {
  const reasons = [];
  const action = String(input && input.action || '').toUpperCase();
  const protectedAction = ['DELETE', 'CLOSE', 'SUPPRESS', 'RETIRE'].includes(action);
  const observationState = input && input.observationState;

  if (!protectedAction) reasons.push('ACTION_NOT_ABSENCE_MUTATION');
  if (!COMPLETE_SOURCE_STATES.has(observationState)) reasons.push('SOURCE_WINDOW_NOT_COMPLETE');
  if (!(input && input.sourceFresh)) reasons.push('SOURCE_NOT_FRESH');
  if (!(input && input.scopeMatches)) reasons.push('SOURCE_SCOPE_NOT_PROVEN');
  if (input && input.targetObserved === true) reasons.push('TARGET_STILL_OBSERVED');

  return {
    allowed: protectedAction && reasons.length === 0,
    reasons
  };
}

function resolveEntity(event, candidate) {
  const candidateSourceIds = candidate && Array.isArray(candidate.sourceEntityIds) ?
    candidate.sourceEntityIds.filter(Boolean) : [];
  const exactId = Boolean(
    event && event.sourceEntityId &&
    candidateSourceIds.includes(event.sourceEntityId)
  );
  const stableIdentifierConflict = Boolean(
    event && event.sourceEntityId &&
    candidateSourceIds.length > 0 &&
    !candidateSourceIds.includes(event.sourceEntityId)
  );
  const addressMatch = norm(event && event.address) &&
    norm(event.address) === norm(candidate && candidate.address);
  const nameSimilarity = jaccard(event && event.businessName, candidate && candidate.canonicalName);
  const unitConflict = Boolean(event && event.unit && candidate && candidate.unit &&
    norm(event.unit) !== norm(candidate.unit));
  const contradictory = Boolean(event && event.contradictoryEvidence) || stableIdentifierConflict;

  let score = 0;
  if (exactId) score += 70;
  if (addressMatch) score += 25;
  score += Math.round(nameSimilarity * 20);
  if (unitConflict) score -= 50;
  if (contradictory) score -= 50;

  let status = 'UNRESOLVED';
  if (score >= 85 && !unitConflict && !contradictory) status = 'RESOLVED';
  else if (score >= 60 && !contradictory) status = 'REVIEW';

  return {
    exactIdentifierMatch: exactId,
    normalizedAddressMatch: Boolean(addressMatch),
    normalizedNameSimilarity: Number(nameSimilarity.toFixed(3)),
    contradictoryEvidence: contradictory || unitConflict,
    stableIdentifierConflict,
    resolutionScore: Math.max(0, Math.min(100, score)),
    resolutionStatus: status
  };
}

function materialChange(previous, current, options) {
  const opts = options || {};
  if (opts.inferredFromAbsence === true) {
    const gate = absenceMutationGate({
      action: opts.absenceAction || 'CLOSE',
      observationState: opts.observationState,
      sourceFresh: opts.sourceFresh,
      scopeMatches: opts.scopeMatches,
      targetObserved: false
    });
    if (!gate.allowed) {
      return {material: false, type: 'UNVERIFIED_ABSENCE', reasons: gate.reasons};
    }
  }
  if (!previous) return {material: true, type: 'NEW_ENTITY'};
  const priorHash = stateHash(previous);
  const currentHash = stateHash(current);
  if (priorHash === currentHash) return {material: false, type: 'UNCHANGED'};

  const pStage = STAGE_RANK[previous.lifecycleStage] || 0;
  const cStage = STAGE_RANK[current.lifecycleStage] || 0;
  if (cStage > pStage) return {material: true, type: 'STAGE_ADVANCE'};

  const pSources = new Set(previous.sourceSystems || []);
  const newSource = (current.sourceSystems || []).find(x => !pSources.has(x));
  if (newSource) return {material: true, type: 'NEW_CORROBORATING_SOURCE', source: newSource};

  const pEvidence = new Set(previous.categoryEvidence || []);
  const newEvidence = (current.categoryEvidence || []).filter(x => !pEvidence.has(x));
  if (newEvidence.length) return {material: true, type: 'NEW_CATEGORY_EVIDENCE', evidence: newEvidence};

  if (norm(previous.status) !== norm(current.status)) {
    return {material: true, type: 'STATUS_CHANGE'};
  }

  if (current.supersedesPrevious === true || current.correctedRecord === true) {
    return {material: true, type: 'CORRECTION_OR_SUPERSESSION'};
  }

  return {material: false, type: 'NON_MATERIAL_STATE_CHANGE'};
}

function clamp(n, max) {
  return Math.max(0, Math.min(max, Number(n) || 0));
}

function vendorScore(parts) {
  const components = {
    changeRecencyMateriality: clamp(parts.changeRecencyMateriality, 30),
    lifecycleTimingUrgency: clamp(parts.lifecycleTimingUrgency, 25),
    categoryRelevance: clamp(parts.categoryRelevance, 25),
    evidenceStrength: clamp(parts.evidenceStrength, 20)
  };
  return {
    components,
    total: Object.values(components).reduce((a,b) => a + b, 0)
  };
}

function parseInstant(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function classifySubscriberEligibility(input) {
  const p = input || {};
  const baseline = parseInstant(p.baselineAt);
  if (baseline === null) {
    return {eligible: false, section: 'REVIEW', reason: 'BASELINE_INVALID'};
  }

  const firstSignal = parseInstant(p.firstSignalAt);
  const materialChange = parseInstant(p.materialChangeAt);
  const reopenAt = parseInstant(p.reopenAt);
  const starterDays = Math.max(0, Math.min(30, Number.isFinite(Number(p.starterDays)) ? Number(p.starterDays) : 7));

  if (materialChange !== null && materialChange >= baseline) {
    return {eligible: true, section: 'NORMAL', reason: 'POST_BASELINE_MATERIAL_CHANGE'};
  }

  if (p.qualifyingReopen === true && reopenAt !== null && reopenAt >= baseline) {
    return {eligible: true, section: 'NORMAL', reason: 'POST_BASELINE_REOPEN'};
  }

  if (firstSignal !== null && firstSignal >= baseline) {
    return {eligible: true, section: 'NORMAL', reason: 'POST_BASELINE_NEW_ENTITY'};
  }

  if (p.starterSnapshotEnabled === true && firstSignal !== null && firstSignal < baseline) {
    const floor = baseline - starterDays * 24 * 60 * 60 * 1000;
    if (firstSignal >= floor) {
      return {eligible: true, section: 'STARTER', reason: 'LABELED_STARTER_SNAPSHOT'};
    }
  }

  if (firstSignal === null && materialChange === null && reopenAt === null) {
    return {eligible: false, section: 'REVIEW', reason: 'EVENT_TIME_UNPROVEN'};
  }

  return {eligible: false, section: 'INELIGIBLE', reason: 'PRE_BASELINE_BACKLOG'};
}

function boundedScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function applyVerticalEvidenceCeiling(input) {
  const data = input || {};
  const category = String(data.category || '').toUpperCase().replace(/[^A-Z]/g, '');
  const rawScore = boundedScore(data.score);
  const posScore = boundedScore(data.posScore);
  const insuranceScore = boundedScore(data.insuranceScore);
  const vertical = category === 'EQUIPMENT' || category === 'HOODFIRE';

  if (!vertical) {
    return {
      category: data.category || null,
      score: rawScore,
      capped: false,
      reviewRequired: rawScore === null,
      reason: rawScore === null ? 'SCORE_INVALID' : 'NOT_VERTICAL_CEILING_CATEGORY'
    };
  }

  if (rawScore === null || posScore === null || insuranceScore === null) {
    return {
      category: data.category || null,
      score: rawScore,
      capped: false,
      reviewRequired: true,
      reason: 'REFERENCE_SCORES_MISSING'
    };
  }

  const referenceScore = Math.max(posScore, insuranceScore);
  const tags = new Set((data.evidenceTags || []).map((tag) =>
    String(tag).toUpperCase().replace(/[^A-Z_]/g, '')
  ));
  const specialist = data.hotFoodSpecialistEvidence === true || tags.has('HOT_FOOD_SPECIALIST');
  const directlySupported = category === 'EQUIPMENT' ?
    (tags.has('EQUIPMENT') || specialist) :
    (tags.has('HOOD_FIRE') || specialist);

  if (rawScore > referenceScore && !directlySupported) {
    return {
      category: data.category || null,
      score: referenceScore,
      originalScore: rawScore,
      referenceScore,
      capped: true,
      reviewRequired: false,
      reason: 'VERTICAL_EVIDENCE_CEILING'
    };
  }

  return {
    category: data.category || null,
    score: rawScore,
    originalScore: rawScore,
    referenceScore,
    capped: false,
    reviewRequired: false,
    reason: directlySupported ? 'DIRECT_VERTICAL_EVIDENCE' : 'WITHIN_REFERENCE_CEILING'
  };
}

function deliveryGate(input) {
  const reasons = [];
  if (input.resolutionStatus !== 'RESOLVED') reasons.push('IDENTITY_NOT_RESOLVED');
  if (input.commercialFit === 'EXCLUDE') reasons.push('COMMERCIAL_FIT_EXCLUDED');
  if (!input.sourceFresh) reasons.push('SOURCE_NOT_FRESH');
  if (input.sourceObservationState &&
      !POSITIVE_OBSERVATION_STATES.has(input.sourceObservationState)) {
    reasons.push('SOURCE_OBSERVATION_NOT_USABLE');
  }
  if (!(input.postBaseline || input.qualifyingReopen || input.starterEligible)) reasons.push('NOT_NEW_OR_REOPENED');
  if ((Number(input.vendorScore) || 0) < (Number(input.minimumScore) || 0)) reasons.push('BELOW_SCORE_THRESHOLD');
  if (input.alreadyDeliveredFingerprint) reasons.push('DUPLICATE_DELIVERY');
  return {eligible: reasons.length === 0, reasons};
}


function buildOpportunityDecision(input) {
  const data = input || {};
  const event = data.event || {};
  const candidate = data.candidate || {};
  const sourceObservation = classifySourceObservation(data.sourceObservation || {});
  const resolution = resolveEntity(event, candidate);
  const change = materialChange(data.previousState || null, data.currentState || {}, data.changeOptions || {});
  const score = vendorScore(data.scoreParts || {});
  const subscriberEligibility = data.subscriberEligibility ?
    classifySubscriberEligibility(data.subscriberEligibility) : null;
  const lineageComplete = Boolean(
    event.sourceRecordId &&
    /^https:\/\//.test(String(event.sourceUrl || ''))
  );

  const delivery = deliveryGate({
    resolutionStatus: resolution.resolutionStatus,
    commercialFit: data.commercialFit || candidate.commercialFit,
    sourceFresh: Boolean(data.sourceObservation && data.sourceObservation.sourceFresh === true),
    sourceObservationState: sourceObservation.state,
    postBaseline: subscriberEligibility ?
      subscriberEligibility.section === 'NORMAL' : data.postBaseline === true,
    qualifyingReopen: subscriberEligibility ?
      subscriberEligibility.reason === 'POST_BASELINE_REOPEN' : data.qualifyingReopen === true,
    starterEligible: subscriberEligibility ?
      subscriberEligibility.section === 'STARTER' : false,
    vendorScore: score.total,
    minimumScore: data.minimumScore,
    alreadyDeliveredFingerprint: data.alreadyDeliveredFingerprint
  });

  const reasons = delivery.reasons.slice();
  if (!change.material) reasons.push('NO_MATERIAL_CHANGE');
  if (!lineageComplete) reasons.push('MISSING_SOURCE_LINEAGE');

  let decision = 'HOLD';
  if (reasons.length === 0) decision = 'DELIVER';
  else if (reasons.some((reason) => [
    'IDENTITY_NOT_RESOLVED',
    'SOURCE_NOT_FRESH',
    'SOURCE_OBSERVATION_NOT_USABLE',
    'MISSING_SOURCE_LINEAGE'
  ].includes(reason))) decision = 'REVIEW';

  const replayFingerprint = stateHash({
    modelVersion: MODEL_VERSION,
    entityId: candidate.entityId || candidate.id || null,
    sourceRecordId: event.sourceRecordId || null,
    sourceObservationState: sourceObservation.state,
    currentStateHash: stateHash(data.currentState || {}),
    changeType: change.type,
    score: score.total,
    decision,
    reasons: reasons.slice().sort()
  });

  return {
    modelVersion: MODEL_VERSION,
    decision,
    reasons,
    replayFingerprint,
    lineageComplete,
    sourceObservation,
    subscriberEligibility,
    resolution,
    change,
    score,
    delivery: {
      eligible: decision === 'DELIVER',
      gateEligible: delivery.eligible
    }
  };
}

module.exports = {
  MODEL_VERSION,
  STAGE_RANK,
  SOURCE_OBSERVATION_STATES,
  norm,
  jaccard,
  stateHash,
  classifySourceObservation,
  absenceMutationGate,
  classifySubscriberEligibility,
  applyVerticalEvidenceCeiling,
  resolveEntity,
  materialChange,
  vendorScore,
  deliveryGate,
  buildOpportunityDecision
};
