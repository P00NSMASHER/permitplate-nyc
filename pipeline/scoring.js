'use strict';

const crypto = require('crypto');
const snapshot = require('../scoring/legacy-score-authority-2026-09-18.json');

const SCORING_VERSION = 'permitplate-score-authority-v1-2026-09-21';
const CATEGORIES = Object.freeze([
  'POS','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution'
]);
const SNAPSHOT_SCORE_KEYS = Object.freeze({
  POS:'POS Score',
  Insurance:'Insurance Score',
  Equipment:'Equipment Score',
  'Hood/Fire':'Hood/Fire Score',
  Waste:'Waste Score',
  Pest:'Pest Score',
  Linen:'Linen Score',
  Distribution:'Distribution Score'
});

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

function normSource(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canonicalSources(values) {
  return Array.from(new Set((values || []).map(normSource).filter(Boolean))).sort();
}

function equalArrays(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function candidateCamis(candidate) {
  const direct = candidate && candidate.camis;
  if (direct) return String(direct).trim();
  const entityId = String(candidate && candidate.entityId || '');
  const match = /^CAMIS:(.+)$/i.exec(entityId);
  return match ? match[1].trim() : null;
}

function authorityByCamis(camis) {
  if (!camis) return [];
  return (snapshot.records || []).filter((record) =>
    String(record && record.authorityKey && record.authorityKey.camis || '').trim() === String(camis).trim()
  );
}

function literalScores(record) {
  const input = record && record.scores || {};
  const scores = {};
  for (const category of CATEGORIES) {
    const key = SNAPSHOT_SCORE_KEYS[category];
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < 0 || value > 100) return null;
    scores[category] = value;
  }
  return scores;
}

function authorityState(record) {
  return {
    stage:String(record && record.stage || '').trim(),
    sourceCount:Number(record && record.sourceCount || 0),
    sources:canonicalSources(record && record.sources),
    commercialFit:String(record && record.commercialFit || '').trim().toUpperCase(),
    lastUpdated:record && record.lastUpdated || null
  };
}

function candidateState(candidate) {
  return {
    stage:String(candidate && candidate.lifecycleStage || '').trim(),
    sourceCount:Number(candidate && (candidate.sourceCount ?? (candidate.sourceSystems || []).length) || 0),
    sources:canonicalSources(candidate && candidate.sourceSystems),
    sourceLatestEffectiveAt:candidate && candidate.sourceLatestEffectiveAt || null,
    suppressed:candidate && candidate.deliverySuppressed === true
  };
}

function authorityFingerprint(record) {
  return sha256(stableStringify({
    authorityId:snapshot.authorityId,
    authorityKey:record.authorityKey,
    commercialFit:record.commercialFit,
    stage:record.stage,
    sourceCount:record.sourceCount,
    sources:record.sources,
    scores:record.scores,
    bestVendorFit:record.bestVendorFit,
    bestScore:record.bestScore,
    purchaseWindow:record.purchaseWindow,
    lastUpdated:record.lastUpdated,
    intelligenceStatus:record.intelligenceStatus,
    confidence:record.confidence
  }));
}

function verifyAuthorityMatch(candidate, record) {
  const errors = [];
  const c = candidateState(candidate);
  const a = authorityState(record);

  if (!record) return {matched:false,errors:['SCORE_AUTHORITY_MISSING']};
  if (c.suppressed) errors.push('CANDIDATE_SUPPRESSED');
  if (!c.stage || c.stage !== a.stage) errors.push('LEGACY_AUTHORITY_STAGE_DRIFT');
  if (!Number.isInteger(c.sourceCount) || c.sourceCount !== a.sourceCount) {
    errors.push('LEGACY_AUTHORITY_SOURCE_COUNT_DRIFT');
  }
  if (!equalArrays(c.sources, a.sources)) errors.push('LEGACY_AUTHORITY_SOURCE_SET_DRIFT');

  const candidateLatest = parseTime(c.sourceLatestEffectiveAt);
  const authorityCutoff = parseTime(a.lastUpdated);
  if (candidateLatest !== null && authorityCutoff !== null && candidateLatest > authorityCutoff) {
    errors.push('LEGACY_AUTHORITY_SUPERSEDED_BY_NEWER_STATE');
  }
  if (!literalScores(record)) errors.push('LEGACY_AUTHORITY_SCORE_INVALID');

  return {matched:errors.length === 0,errors,candidateState:c,authorityState:a};
}

function resolveScoreAuthority(candidate) {
  const camis = candidateCamis(candidate);
  if (!camis) {
    return {
      status:'REVIEW',
      scoringVersion:SCORING_VERSION,
      authorityId:snapshot.authorityId,
      errors:['SCORE_AUTHORITY_IDENTITY_MISSING']
    };
  }

  const records = authorityByCamis(camis);
  if (records.length === 0) {
    return {
      status:'REVIEW',
      scoringVersion:SCORING_VERSION,
      authorityId:snapshot.authorityId,
      errors:['SCORE_AUTHORITY_MISSING']
    };
  }
  if (records.length !== 1) {
    return {
      status:'REVIEW',
      scoringVersion:SCORING_VERSION,
      authorityId:snapshot.authorityId,
      errors:['SCORE_AUTHORITY_AMBIGUOUS']
    };
  }

  const record = records[0];
  const verification = verifyAuthorityMatch(candidate, record);
  if (!verification.matched) {
    return {
      status:'REVIEW',
      scoringVersion:SCORING_VERSION,
      authorityId:snapshot.authorityId,
      authorityRecordFingerprint:authorityFingerprint(record),
      errors:verification.errors
    };
  }

  const scores = literalScores(record);
  return {
    status:'SCORED',
    scoringVersion:SCORING_VERSION,
    authorityId:snapshot.authorityId,
    authorityKind:snapshot.authorityKind,
    authorityRecordFingerprint:authorityFingerprint(record),
    authorityCutoff:record.lastUpdated,
    commercialFit:record.commercialFit,
    scores,
    bestVendorFit:record.bestVendorFit,
    bestScore:Number(record.bestScore),
    purchaseWindow:record.purchaseWindow,
    intelligenceStatus:record.intelligenceStatus,
    confidence:record.confidence
  };
}

// Compatibility name retained for callers. No category formula is computed here.
// The only accepted scores are literal values from a pinned validated authority.
function computeScores(input) {
  if (!input || !input.candidate) {
    return {
      status:'REVIEW',
      scoringVersion:SCORING_VERSION,
      authorityId:snapshot.authorityId,
      errors:['CANDIDATE_REQUIRED_FOR_SCORE_AUTHORITY']
    };
  }
  return resolveScoreAuthority(input.candidate);
}

module.exports = {
  SCORING_VERSION,
  CATEGORIES,
  SNAPSHOT_SCORE_KEYS,
  stableStringify,
  sha256,
  canonicalSources,
  candidateCamis,
  authorityByCamis,
  literalScores,
  authorityState,
  candidateState,
  authorityFingerprint,
  verifyAuthorityMatch,
  resolveScoreAuthority,
  computeScores
};
