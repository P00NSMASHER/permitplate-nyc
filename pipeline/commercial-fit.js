'use strict';

const crypto = require('crypto');
const delivery = require('./delivery-plan');

const COMMERCIAL_FIT_VERSION = 'PermitPlate-commercial-fit-v1.0.0';

const STRONG_CONCEPT_PATTERNS = Object.freeze([
  ['PIZZA', /\bPIZZA|PIZZERIA\b/i],
  ['RESTAURANT', /\bRESTAURANT\b/i],
  ['CAFE', /\bCAFE\b/i],
  ['PUB', /\bPUB\b/i],
  ['BISTRO', /\bBISTRO\b/i],
  ['COFFEE', /\bCOFFEE\b/i],
  ['TEA', /\bTEA\b/i],
  ['ICE_CREAM', /ICE[ -]?CREAM/i],
  ['DOUGHNUT_BAKERY', /DOUGHNUT|DONUT|\bBAKERY\b/i],
  ['POKE_BOWL', /\bPOKE\b|\bBOWL\b/i],
  ['DINER', /\bDINER\b/i],
  ['SUSHI', /\bSUSHI\b/i],
  ['GRILL', /\bGRILL\b/i],
  ['DELI', /\bDELI\b/i],
  ['SANDWICH', /\bSANDWICH\b/i],
  ['LOUNGE', /\bLOUNGE\b/i],
  ['BRICK_OVEN', /BRICK[ -]?OVEN/i]
]);

const EXCLUDE_PATTERNS = Object.freeze([
  ['RESIDENCE', /\bRESIDENCE\b/i],
  ['CORPORATE_FLOOR', /\b(?:1ST|2ND|3RD|[4-9]TH|1\dTH|2\dTH|3\dTH|4\dTH|5\dTH)\s+(?:FL|FLOOR)\b/i],
  ['OFFICE_CAFETERIA', /\bOFFICE\b.*\bCAFETERIA\b|\bEMPLOYEE\b.*\bCAFETERIA\b/i]
]);

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

function sourceRecordMap(records) {
  const map = new Map();
  for (const record of records || []) {
    const id = text(record && record.sourceRecordId);
    if (id) map.set(id, record);
  }
  return map;
}

function directConceptEvidence(candidate) {
  const name = text(candidate && candidate.canonicalName);
  const hits = STRONG_CONCEPT_PATTERNS
    .filter(([,pattern]) => pattern.test(name))
    .map(([tag]) => tag);
  return {
    authority:'DIRECT_SOURCE_TEXT',
    text:name,
    tags:hits,
    explicit:hits.length > 0,
    hotFood:hits.some((tag) => ['PIZZA','DOUGHNUT_BAKERY','GRILL','DELI','BRICK_OVEN'].includes(tag)),
    restaurant:hits.some((tag) => ['RESTAURANT','PUB','BISTRO','DINER','SUSHI','LOUNGE'].includes(tag)),
    pokeBowl:hits.includes('POKE_BOWL'),
    lightPrep:hits.some((tag) => ['COFFEE','TEA','ICE_CREAM','SANDWICH'].includes(tag))
  };
}

function acceptedEvidence(candidate, recordsById) {
  const accepted = candidate && candidate.projectSignal &&
    candidate.projectSignal.corroboration &&
    candidate.projectSignal.corroboration.accepted || [];

  const records = accepted
    .map((item) => recordsById.get(text(item && item.sourceRecordId)))
    .filter(Boolean);

  const sla = records.filter((record) => record.sourceSystem === 'SLA_PENDING');
  const dob = records.filter((record) => record.sourceSystem === 'DOB_NOW');
  return {records,sla,dob};
}

function explicitHospitalitySla(records) {
  return (records || []).some((record) => {
    const facts = record && record.facts || {};
    const parties = record && record.parties || {};
    const value = [
      facts.description,
      parties.dba,
      parties.legalName
    ].filter(Boolean).join(' ');
    return /RESTAURANT|FOOD\s*&\s*BEVERAGE|CAFE|BAR|TAVERN|LOUNGE|DINER|PIZZA|SUSHI|OMAKASE/i.test(value);
  });
}

function explicitHospitalityDob(records) {
  return (records || []).some((record) => {
    const facts = record && record.facts || {};
    return /RESTAURANT|EATING\s*&?\s*DRINKING|TAKE[ -]?OUT|COMMERCIAL KITCHEN|FOOD SERVICE/i
      .test(text(facts.job_description));
  });
}

function exclusionEvidence(candidate) {
  const name = text(candidate && candidate.canonicalName);
  return EXCLUDE_PATTERNS
    .filter(([,pattern]) => pattern.test(name))
    .map(([tag]) => tag);
}

function classifyCommercialFit(input) {
  const data = input || {};
  const candidate = data.candidate || {};
  const recordsById = data.recordsById instanceof Map ?
    data.recordsById : sourceRecordMap(data.sourceRecords);
  const fingerprint = delivery.candidateChangeFingerprint(candidate);
  const reasons = [];
  const evidenceRefs = [];

  if (!text(candidate.entityId)) {
    return {status:'REVIEW',fit:null,reasons:['ENTITY_ID_MISSING'],evidenceRefs};
  }

  if (candidate.deliverySuppressed === true ||
      (candidate.crossCamisOperationalConflicts || []).length > 0) {
    reasons.push('OPERATIONAL_PREDECESSOR_OR_IDENTITY_CONFLICT');
    for (const conflict of candidate.crossCamisOperationalConflicts || []) {
      if (conflict.primarySourceRecordId) evidenceRefs.push(conflict.primarySourceRecordId);
    }
    return buildReceipt(candidate,fingerprint,'LOW',reasons,evidenceRefs);
  }

  const excludedBy = exclusionEvidence(candidate);
  if (excludedBy.length) {
    reasons.push(...excludedBy.map((tag) => 'INSTITUTIONAL_CONTEXT:' + tag));
    if (candidate.primaryRecord && candidate.primaryRecord.sourceRecordId) {
      evidenceRefs.push(candidate.primaryRecord.sourceRecordId);
    }
    return buildReceipt(candidate,fingerprint,'EXCLUDE',reasons,evidenceRefs);
  }

  const accepted = acceptedEvidence(candidate, recordsById);
  if (explicitHospitalitySla(accepted.sla)) {
    reasons.push('ACCEPTED_SLA_HOSPITALITY_CLASSIFICATION');
    evidenceRefs.push(...accepted.sla.map((record) => record.sourceRecordId));
    return buildReceipt(candidate,fingerprint,'HIGH',reasons,evidenceRefs);
  }
  if (explicitHospitalityDob(accepted.dob)) {
    reasons.push('ACCEPTED_DOB_HOSPITALITY_SCOPE');
    evidenceRefs.push(...accepted.dob.map((record) => record.sourceRecordId));
    return buildReceipt(candidate,fingerprint,'HIGH',reasons,evidenceRefs);
  }

  const concept = directConceptEvidence(candidate);
  if (concept.explicit) {
    reasons.push('DIRECT_DBA_COMMERCIAL_CONCEPT:' + concept.tags.join('|'));
    if (candidate.primaryRecord && candidate.primaryRecord.sourceRecordId) {
      evidenceRefs.push(candidate.primaryRecord.sourceRecordId);
    }
    return buildReceipt(candidate,fingerprint,'HIGH',reasons,evidenceRefs,{conceptEvidence:concept});
  }

  if (candidate.primaryRecord && candidate.primaryRecord.sourceSystem === 'DOHMH') {
    reasons.push('DOHMH_APPLICANT_CONCEPT_UNCLEAR');
    evidenceRefs.push(candidate.primaryRecord.sourceRecordId);
    return buildReceipt(candidate,fingerprint,'MEDIUM',reasons,evidenceRefs);
  }

  return {
    status:'REVIEW',
    fit:null,
    entityId:candidate.entityId,
    changeFingerprint:fingerprint,
    fitVersion:COMMERCIAL_FIT_VERSION,
    reasons:['COMMERCIAL_CONTEXT_UNPROVEN'],
    evidenceRefs
  };
}

function buildReceipt(candidate, changeFingerprint, fit, reasons, evidenceRefs, extra) {
  const base = {
    fitVersion:COMMERCIAL_FIT_VERSION,
    status:'CLASSIFIED',
    entityId:candidate.entityId,
    changeFingerprint,
    fit,
    reasons:reasons.slice(),
    evidenceRefs:Array.from(new Set(evidenceRefs || [])).sort()
  };
  const payload = Object.assign(base, extra || {});
  payload.fitReceiptId = 'FIT:' + sha256(stableStringify(payload)).slice(0,24);
  return payload;
}

module.exports = {
  COMMERCIAL_FIT_VERSION,
  STRONG_CONCEPT_PATTERNS,
  EXCLUDE_PATTERNS,
  sourceRecordMap,
  directConceptEvidence,
  acceptedEvidence,
  explicitHospitalitySla,
  explicitHospitalityDob,
  exclusionEvidence,
  classifyCommercialFit
};
