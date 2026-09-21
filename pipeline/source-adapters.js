'use strict';

const crypto = require('crypto');
const model = require('../model-v7');

const PIPELINE_VERSION = 'PermitPlate-source-adapters-v1.0.0';

const SOURCE_CONFIGS = Object.freeze({
  DOHMH: Object.freeze({
    sourceKey: 'DOHMH',
    sourceId: 'nyc-open-data:43nn-pn8j',
    jurisdiction: 'NYC',
    agency: 'NYC DOHMH',
    datasetName: 'DOHMH New York City Restaurant Inspection Results',
    landingUrl: 'https://data.cityofnewyork.us/d/43nn-pn8j',
    apiUrl: 'https://data.cityofnewyork.us/resource/43nn-pn8j.json',
    entityKeyFields: ['camis'],
    recordFields: [
      'camis','dba','boro','building','street','zipcode','cuisine_description',
      'inspection_date','action','violation_code','critical_flag','score','grade',
      'grade_date','record_date','inspection_type','bin','bbl','latitude','longitude'
    ]
  }),
  DOB_NOW: Object.freeze({
    sourceKey: 'DOB_NOW',
    sourceId: 'nyc-open-data:w9ak-ipjd',
    jurisdiction: 'NYC',
    agency: 'NYC DOB',
    datasetName: 'DOB NOW: Build – Job Application Filings',
    landingUrl: 'https://data.cityofnewyork.us/d/w9ak-ipjd',
    apiUrl: 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json',
    entityKeyFields: ['job_filing_number','bin','block','lot'],
    recordFields: [
      'job_filing_number','filing_status','house_no','street_name','borough',
      'block','lot','bin','job_description','initial_cost','owner_s_business_name',
      'filing_date','work_on_floor'
    ]
  }),
  SLA_PENDING: Object.freeze({
    sourceKey: 'SLA_PENDING',
    sourceId: 'ny-open-data:f8i8-k2gm',
    jurisdiction: 'NY',
    agency: 'New York State Liquor Authority',
    datasetName: 'Current SLA Pending Licenses',
    landingUrl: 'https://data.ny.gov/d/f8i8-k2gm',
    apiUrl: 'https://data.ny.gov/resource/f8i8-k2gm.json',
    entityKeyFields: ['application_id'],
    recordFields: [
      'application_id','description','legalname','dba','actual_address_of_premises',
      'additional_address_information','city','state_name','zip_code','received_date',
      'status','aka_address','georeference'
    ]
  })
});

function text(value) {
  return value == null ? '' : String(value).trim();
}

function nullableText(value) {
  const valueText = text(value);
  return valueText || null;
}

function moneyNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

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

function selectedFacts(row, fields) {
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(row || {}, field))
    .map((field) => [field, row[field] == null ? null : row[field]]));
}

function normalizedAddress(parts) {
  return parts.map(nullableText).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null;
}

function sourceRecord(config, input) {
  const facts = input.facts || {};
  const rowFingerprint = sha256(stableStringify(facts));
  return {
    pipelineVersion: PIPELINE_VERSION,
    jurisdiction: config.jurisdiction,
    sourceSystem: config.sourceKey,
    sourceDatasetId: config.sourceId,
    sourceRecordId: input.sourceRecordId || rowFingerprint,
    sourceEntityId: input.sourceEntityId || null,
    sourceUrl: input.sourceUrl || config.landingUrl,
    sourceEffectiveAt: input.sourceEffectiveAt || null,
    observedAt: input.observedAt || null,
    eventType: input.eventType,
    entityKeys: input.entityKeys || {},
    property: input.property || {},
    parties: input.parties || {},
    facts,
    rawFactFingerprint: rowFingerprint
  };
}

function normalizeDohmhRow(row, context) {
  const r = row || {};
  const camis = nullableText(r.camis);
  if (!camis) throw new Error('DOHMH row missing CAMIS');
  const config = SOURCE_CONFIGS.DOHMH;
  const facts = selectedFacts(r, config.recordFields);
  const recordSuffix = [
    nullableText(r.inspection_date),
    nullableText(r.inspection_type),
    nullableText(r.violation_code),
    nullableText(r.action),
    sha256(stableStringify(facts)).slice(0, 12)
  ].filter(Boolean).join(':');

  const inspectionDate = nullableText(r.inspection_date);
  const applicantPlaceholder = Boolean(inspectionDate && /^1900-01-01/.test(inspectionDate));
  const prePermit = /^pre-permit/i.test(text(r.inspection_type));

  return sourceRecord(config, {
    sourceRecordId: `DOHMH:${camis}:${recordSuffix}`,
    sourceEntityId: `CAMIS:${camis}`,
    sourceEffectiveAt: applicantPlaceholder ?
      nullableText(r.record_date) :
      (inspectionDate || nullableText(r.record_date)),
    observedAt: context && context.observedAt,
    eventType: applicantPlaceholder ?
      'DOHMH_APPLICANT_RECORD' :
      (prePermit ? 'DOHMH_PRE_PERMIT_EVENT' : 'DOHMH_RESTAURANT_RECORD'),
    entityKeys: {
      camis,
      bin: nullableText(r.bin),
      bbl: nullableText(r.bbl)
    },
    property: {
      address: normalizedAddress([r.building, r.street]),
      borough: nullableText(r.boro),
      zip: nullableText(r.zipcode),
      bin: nullableText(r.bin),
      bbl: nullableText(r.bbl),
      latitude: moneyNumber(r.latitude),
      longitude: moneyNumber(r.longitude)
    },
    parties: {
      operatorName: nullableText(r.dba)
    },
    facts
  });
}

function normalizeDobNowRow(row, context) {
  const r = row || {};
  const filing = nullableText(r.job_filing_number);
  if (!filing) throw new Error('DOB NOW row missing job_filing_number');
  const config = SOURCE_CONFIGS.DOB_NOW;
  const facts = selectedFacts(r, config.recordFields);

  return sourceRecord(config, {
    sourceRecordId: `DOB_NOW:${filing}`,
    sourceEntityId: null,
    sourceEffectiveAt: nullableText(r.filing_date),
    observedAt: context && context.observedAt,
    eventType: 'DOB_NOW_JOB_FILING',
    entityKeys: {
      jobFilingNumber: filing,
      bin: nullableText(r.bin),
      block: nullableText(r.block),
      lot: nullableText(r.lot)
    },
    property: {
      address: normalizedAddress([r.house_no, r.street_name]),
      borough: nullableText(r.borough),
      bin: nullableText(r.bin),
      block: nullableText(r.block),
      lot: nullableText(r.lot)
    },
    parties: {
      ownerBusinessName: nullableText(r.owner_s_business_name)
    },
    facts: Object.assign({}, facts, {
      initial_cost_number: moneyNumber(r.initial_cost)
    })
  });
}

function normalizeSlaPendingRow(row, context) {
  const r = row || {};
  const applicationId = nullableText(r.application_id);
  if (!applicationId) throw new Error('SLA pending row missing application_id');
  const config = SOURCE_CONFIGS.SLA_PENDING;
  const facts = selectedFacts(r, config.recordFields);

  return sourceRecord(config, {
    sourceRecordId: `SLA_PENDING:${applicationId}`,
    sourceEntityId: `SLA_APPLICATION:${applicationId}`,
    sourceEffectiveAt: nullableText(r.received_date),
    observedAt: context && context.observedAt,
    eventType: 'SLA_PENDING_LICENSE',
    entityKeys: {
      applicationId
    },
    property: {
      address: normalizedAddress([r.actual_address_of_premises]),
      unit: nullableText(r.additional_address_information),
      city: nullableText(r.city),
      state: nullableText(r.state_name),
      zip: nullableText(r.zip_code)
    },
    parties: {
      legalName: nullableText(r.legalname),
      dba: nullableText(r.dba)
    },
    facts
  });
}

function normalizeRow(sourceKey, row, context) {
  if (sourceKey === 'DOHMH') return normalizeDohmhRow(row, context);
  if (sourceKey === 'DOB_NOW') return normalizeDobNowRow(row, context);
  if (sourceKey === 'SLA_PENDING') return normalizeSlaPendingRow(row, context);
  throw new Error(`Unknown sourceKey: ${sourceKey}`);
}

function configFingerprint(config) {
  return sha256(stableStringify({
    pipelineVersion: PIPELINE_VERSION,
    sourceId: config.sourceId,
    apiUrl: config.apiUrl,
    entityKeyFields: config.entityKeyFields,
    recordFields: config.recordFields
  }));
}

function schemaFingerprint(config, observedFields) {
  return sha256(stableStringify({
    sourceId: config.sourceId,
    expectedFields: config.recordFields.slice().sort(),
    observedFields: Array.from(new Set(observedFields || [])).sort()
  }));
}

function buildSourceObservation(sourceKey, input) {
  const config = SOURCE_CONFIGS[sourceKey];
  if (!config) throw new Error(`Unknown sourceKey: ${sourceKey}`);
  const inData = input || {};
  const rawPages = Array.isArray(inData.rawPages) ? inData.rawPages : [];
  const rows = Array.isArray(inData.rows) ? inData.rows : [];
  const observedFields = Array.from(new Set(
    (Array.isArray(inData.schemaFields) ? inData.schemaFields : [])
      .concat(rows.flatMap((row) => Object.keys(row || {})))
      .filter(Boolean)
  ));
  const receipt = {
    sourceId: config.sourceId,
    connectorConfigHash: configFingerprint(config),
    queryScopeHash: inData.queryScopeHash || null,
    queryScope: inData.queryScope || null,
    observedAt: inData.observedAt || null,
    sourceFresh: inData.sourceFresh === true,
    transportOk: inData.transportOk,
    httpStatus: inData.httpStatus,
    sourceMoved: inData.sourceMoved === true,
    redirected: inData.redirected === true,
    redirectTarget: inData.redirectTarget || null,
    intendedFullScope: inData.intendedFullScope === true,
    publisherCount: inData.publisherCount,
    fetchedCount: rows.length,
    cursorClosed: inData.cursorClosed === true,
    schemaFingerprint: observedFields.length ? schemaFingerprint(config, observedFields) : null,
    rawPageHashes: rawPages.map((page) => sha256(typeof page === 'string' ? page : stableStringify(page)))
  };
  const classified = model.classifySourceObservation(receipt);
  const observationId = `OBS:${sha256(stableStringify({receipt, state: classified.state})).slice(0, 24)}`;
  return Object.assign({observationId}, receipt, {
    state: classified.state,
    supportsPositiveObservation: classified.supportsPositiveObservation,
    supportsAbsenceConclusion: classified.supportsAbsenceConclusion,
    stateReason: classified.reason
  });
}

function normalizeBatch(sourceKey, input) {
  const inData = input || {};
  const observation = buildSourceObservation(sourceKey, inData);
  const records = (inData.rows || []).map((row) => normalizeRow(sourceKey, row, {
    observedAt: observation.observedAt
  })).map((record) => Object.assign({}, record, {
    sourceObservationId: observation.observationId
  }));
  return {observation, records};
}

module.exports = {
  PIPELINE_VERSION,
  SOURCE_CONFIGS,
  moneyNumber,
  stableStringify,
  sha256,
  normalizeDohmhRow,
  normalizeDobNowRow,
  normalizeSlaPendingRow,
  normalizeRow,
  buildSourceObservation,
  normalizeBatch
};
