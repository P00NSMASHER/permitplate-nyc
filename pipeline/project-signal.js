'use strict';

const crypto = require('crypto');

const PROJECT_SIGNAL_VERSION = 'PermitPlate-project-signal-v1.0.0';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function norm(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function partyNames(record) {
  const parties = record && record.parties || {};
  return [
    parties.operatorName,
    parties.dba,
    parties.legalName,
    parties.applicantBusinessName,
    parties.permitteeBusinessName
  ].map(norm).filter(Boolean);
}

function identityNamespacePairs(record) {
  const keys = record && record.entityKeys || {};
  return [
    ['camis', keys.camis],
    ['applicationId', keys.applicationId],
    ['jobFilingNumber', keys.jobFilingNumber]
  ].filter(([, value]) => text(value));
}

function conflictingSameNamespaceIdentifier(a, b) {
  const aPairs = new Map(identityNamespacePairs(a));
  const bPairs = new Map(identityNamespacePairs(b));
  for (const [namespace, value] of aPairs) {
    if (bPairs.has(namespace) && text(bPairs.get(namespace)) !== text(value)) {
      return {namespace, a: text(value), b: text(bPairs.get(namespace))};
    }
  }
  return null;
}

function sameLocation(a, b) {
  const pa = a && a.property || {};
  const pb = b && b.property || {};
  const addressMatch = norm(pa.address) && norm(pa.address) === norm(pb.address);
  const binMatch = text(pa.bin) && text(pa.bin) === text(pb.bin);
  const bblMatch = text(pa.bbl) && text(pa.bbl) === text(pb.bbl);
  return Boolean(addressMatch || binMatch || bblMatch);
}

function exactPartyBridge(a, b) {
  const left = new Set(partyNames(a));
  if (!left.size) return null;
  for (const name of partyNames(b)) {
    if (left.has(name)) return name;
  }
  return null;
}

function reviewedBridgeKey(a, b) {
  return [text(a && a.sourceRecordId), text(b && b.sourceRecordId)].sort().join('|');
}

function corroborate(primary, evidence, options) {
  const opts = options || {};
  const reasons = [];
  const conflict = conflictingSameNamespaceIdentifier(primary, evidence);
  if (conflict) {
    return {
      corroborates: false,
      coLocated: sameLocation(primary, evidence),
      confidence: 'REJECTED',
      reasons: ['CONTRADICTORY_STABLE_IDENTIFIER'],
      conflict
    };
  }

  const exactSourceEntity = Boolean(
    primary && evidence &&
    primary.sourceEntityId && evidence.sourceEntityId &&
    text(primary.sourceEntityId) === text(evidence.sourceEntityId)
  );
  if (exactSourceEntity) {
    return {
      corroborates: true,
      coLocated: sameLocation(primary, evidence),
      confidence: 'HIGH',
      reasons: ['EXACT_SOURCE_ENTITY_ID'],
      conflict: null
    };
  }

  const bridgeSet = new Set(Array.isArray(opts.reviewedIdentityBridges) ? opts.reviewedIdentityBridges : []);
  if (bridgeSet.has(reviewedBridgeKey(primary, evidence))) {
    return {
      corroborates: true,
      coLocated: sameLocation(primary, evidence),
      confidence: 'HIGH',
      reasons: ['REVIEWED_IDENTITY_BRIDGE'],
      conflict: null
    };
  }

  const coLocated = sameLocation(primary, evidence);
  const partyBridge = exactPartyBridge(primary, evidence);

  // SLA pending records may corroborate a restaurant only when the licensed-premise
  // location and a business/operator name both align. Address alone is never enough.
  const sourcePair = new Set([primary && primary.sourceSystem, evidence && evidence.sourceSystem]);
  const isDohmhSlaPair = sourcePair.has('DOHMH') && sourcePair.has('SLA_PENDING');
  if (isDohmhSlaPair && coLocated && partyBridge) {
    return {
      corroborates: true,
      coLocated: true,
      confidence: 'HIGH',
      reasons: ['SAME_PREMISE', 'EXACT_BUSINESS_NAME_BRIDGE'],
      matchedPartyName: partyBridge,
      conflict: null
    };
  }

  if (coLocated) reasons.push('COLOCATED_ONLY');
  if (partyBridge) reasons.push('PARTY_NAME_MATCH_WITHOUT_APPROVED_SOURCE_PAIR');
  if (!coLocated) reasons.push('LOCATION_NOT_MATCHED');
  if (!partyBridge) reasons.push('NO_ENTITY_NAME_BRIDGE');

  return {
    corroborates: false,
    coLocated,
    confidence: coLocated ? 'LOW' : 'UNRESOLVED',
    reasons,
    conflict: null
  };
}

const COMMERCIAL_EVIDENCE_RULES = Object.freeze([
  {
    tag: 'HOOD_FIRE',
    patterns: [
      /\bhood\b/i,
      /fire suppression/i,
      /ansul/i,
      /kitchen exhaust/i
    ]
  },
  {
    tag: 'EQUIPMENT',
    patterns: [
      /commercial kitchen/i,
      /food service equipment/i,
      /cooking equipment/i,
      /kitchen equipment/i
    ]
  },
  {
    tag: 'WASTE',
    patterns: [
      /\bdemolition\b/i,
      /\bdemo\b/i,
      /interior demolition/i
    ]
  }
]);

function evidenceText(record) {
  const facts = record && record.facts || {};
  const selected = [
    facts.job_description,
    facts.description,
    facts.inspection_type,
    facts.action
  ].filter(Boolean);
  return selected.join(' | ');
}

function mapCommercialEvidence(records) {
  const results = [];
  for (const record of records || []) {
    const haystack = evidenceText(record);
    if (!haystack) continue;
    for (const rule of COMMERCIAL_EVIDENCE_RULES) {
      const matched = rule.patterns.filter((pattern) => pattern.test(haystack)).map((pattern) => pattern.source);
      if (!matched.length) continue;
      results.push({
        tag: rule.tag,
        sourceSystem: record.sourceSystem,
        sourceRecordId: record.sourceRecordId,
        sourceUrl: record.sourceUrl,
        matchedPatterns: matched,
        evidenceText: haystack
      });
    }
  }
  return results;
}

function buildProjectSignal(primary, evidenceRecords, options) {
  if (!primary || !primary.sourceRecordId) throw new Error('primary SourceRecord is required');
  const opts = options || {};
  const evidence = [];
  const rejectedEvidence = [];

  for (const record of evidenceRecords || []) {
    const result = corroborate(primary, record, opts);
    const item = {
      sourceRecordId: record.sourceRecordId,
      sourceSystem: record.sourceSystem,
      sourceUrl: record.sourceUrl,
      result
    };
    if (result.corroborates) evidence.push(Object.assign({record}, item));
    else rejectedEvidence.push(item);
  }

  const acceptedRecords = [primary].concat(evidence.map((item) => item.record));
  const sources = Array.from(new Set(acceptedRecords.map((record) => record.sourceSystem).filter(Boolean)));
  const commercialEvidence = mapCommercialEvidence(acceptedRecords);
  const signalId = 'PS:' + sha256(stableStringify({
    version: PROJECT_SIGNAL_VERSION,
    primary: primary.sourceRecordId,
    corroborated: evidence.map((item) => item.sourceRecordId).sort()
  })).slice(0, 24);

  return {
    projectSignalVersion: PROJECT_SIGNAL_VERSION,
    signalId,
    jurisdiction: primary.jurisdiction,
    primarySourceRecordId: primary.sourceRecordId,
    sourceRecordIds: acceptedRecords.map((record) => record.sourceRecordId),
    sourceSystems: sources,
    sourceCount: sources.length,
    property: primary.property || {},
    entities: primary.parties || {},
    corroboration: {
      sameEntityOnly: true,
      accepted: evidence.map((item) => ({
        sourceRecordId: item.sourceRecordId,
        sourceSystem: item.sourceSystem,
        confidence: item.result.confidence,
        reasons: item.result.reasons
      })),
      rejected: rejectedEvidence
    },
    commercialEvidence,
    provenance: {
      sourceUrls: acceptedRecords.map((record) => record.sourceUrl).filter(Boolean),
      sourceObservationIds: Array.from(new Set(
        acceptedRecords.map((record) => record.sourceObservationId).filter(Boolean)
      ))
    }
  };
}

module.exports = {
  PROJECT_SIGNAL_VERSION,
  norm,
  sameLocation,
  exactPartyBridge,
  conflictingSameNamespaceIdentifier,
  corroborate,
  mapCommercialEvidence,
  buildProjectSignal,
  reviewedBridgeKey
};
