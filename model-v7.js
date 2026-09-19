'use strict';

const STAGE_RANK = Object.freeze({
  'JUST FILED': 1,
  'BUILDOUT / LICENSING': 2,
  'HEALTH PRE-PERMIT': 3,
  'MULTI-SOURCE NEAR-OPENING': 4
});

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

function resolveEntity(event, candidate) {
  const exactId = Boolean(
    event && candidate &&
    event.sourceEntityId && candidate.sourceEntityIds &&
    candidate.sourceEntityIds.includes(event.sourceEntityId)
  );
  const addressMatch = norm(event && event.address) &&
    norm(event.address) === norm(candidate && candidate.address);
  const nameSimilarity = jaccard(event && event.businessName, candidate && candidate.canonicalName);
  const unitConflict = Boolean(event && event.unit && candidate && candidate.unit &&
    norm(event.unit) !== norm(candidate.unit));
  const contradictory = Boolean(event && event.contradictoryEvidence);

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
    resolutionScore: Math.max(0, Math.min(100, score)),
    resolutionStatus: status
  };
}

function materialChange(previous, current) {
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

function deliveryGate(input) {
  const reasons = [];
  if (input.resolutionStatus !== 'RESOLVED') reasons.push('IDENTITY_NOT_RESOLVED');
  if (input.commercialFit === 'EXCLUDE') reasons.push('COMMERCIAL_FIT_EXCLUDED');
  if (!input.sourceFresh) reasons.push('SOURCE_NOT_FRESH');
  if (!(input.postBaseline || input.qualifyingReopen)) reasons.push('NOT_NEW_OR_REOPENED');
  if ((Number(input.vendorScore) || 0) < (Number(input.minimumScore) || 0)) reasons.push('BELOW_SCORE_THRESHOLD');
  if (input.alreadyDeliveredFingerprint) reasons.push('DUPLICATE_DELIVERY');
  return {eligible: reasons.length === 0, reasons};
}

module.exports = {
  STAGE_RANK,
  norm,
  jaccard,
  stateHash,
  resolveEntity,
  materialChange,
  vendorScore,
  deliveryGate
};
