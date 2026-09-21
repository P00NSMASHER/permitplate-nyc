'use strict';

const adapters = require('./source-adapters');
const model = require('../model-v7');
const {
  stableStringify,
  sha256,
  normalizeScope,
  buildResourceUrl,
  observeSocrataQuery
} = require('../operations/socrata-observer');
const {getSource} = require('../operations/source-registry');

const READER_VERSION = 'PermitPlate-socrata-reader-v1.1.0';

const REGISTRY_KEY = Object.freeze({
  DOHMH:'DOHMH',
  DOB_NOW:'DOB',
  SLA_PENDING:'SLA'
});

function datasetId(config) {
  return String(config.sourceId || '').split(':').pop();
}

function queryScope(config, options) {
  const opts = options || {};
  return {
    readerVersion:READER_VERSION,
    sourceId:config.sourceId,
    where:opts.where || null,
    order:opts.order || null,
    select:opts.select || config.recordFields.join(',')
  };
}

function metadataUrl(config) {
  return `${new URL(config.apiUrl).origin}/api/views/${datasetId(config)}`;
}

function resourceUrl(config, params) {
  const source = {
    domain:new URL(config.apiUrl).hostname,
    datasetId:datasetId(config)
  };
  return buildResourceUrl(source, params);
}

function epochSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function metadataFreshness(metadata, observedAt, maxAgeDays) {
  const candidates = [
    epochSeconds(metadata && metadata.rowsUpdatedAt),
    epochSeconds(metadata && metadata.dataUpdatedAt),
    epochSeconds(metadata && metadata.viewLastModified)
  ].filter(Boolean);
  if (!candidates.length) return {fresh:false,ageMs:null,updatedAt:null};
  const latest = Math.max(...candidates) * 1000;
  const now = Date.parse(observedAt);
  const ageMs = Number.isFinite(now) ? Math.max(0, now - latest) : null;
  const maxAgeMs = Math.max(0, Number(maxAgeDays) || 0) * 24 * 60 * 60 * 1000;
  return {
    fresh:ageMs !== null && ageMs <= maxAgeMs,
    ageMs,
    updatedAt:new Date(latest).toISOString()
  };
}

function schemaFields(metadata) {
  return Array.isArray(metadata && metadata.columns) ?
    metadata.columns.map((column) => column && column.fieldName).filter(Boolean) : [];
}

function countFromPayload(payload) {
  if (!Array.isArray(payload) || !payload.length) return null;
  const value = payload[0] && (payload[0].count ?? payload[0].COUNT ?? payload[0].Count);
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function canonicalObservation(receipt, classification) {
  return {
    observationId:receipt.observationId,
    sourceId:receipt.sourceId,
    connectorConfigHash:receipt.connectorConfigHash,
    queryFingerprint:receipt.queryFingerprint,
    queryScopeHash:receipt.queryScopeHash || receipt.queryFingerprint,
    queryScope:receipt.queryScope || null,
    observedAt:receipt.observedAt,
    sourceFresh:receipt.sourceFresh,
    sourceUpdatedAt:receipt.sourceUpdatedAt || null,
    transportOk:receipt.transportOk,
    httpStatus:receipt.httpStatus,
    sourceMoved:receipt.sourceMoved,
    redirected:receipt.redirected,
    redirectTarget:receipt.redirectTarget,
    intendedFullScope:receipt.intendedFullScope,
    publisherCount:receipt.publisherCount,
    fetchedCount:receipt.fetchedCount,
    cursorClosed:receipt.cursorClosed,
    schemaFingerprint:receipt.schemaFingerprint,
    rawPageHashes:receipt.rawPageHashes || [],
    metadataHash:receipt.metadataHash || null,
    countResponseHash:receipt.countResponseHash || null,
    state:classification.state,
    supportsPositiveObservation:classification.supportsPositiveObservation,
    supportsAbsenceConclusion:classification.supportsAbsenceConclusion,
    stateReason:classification.reason
  };
}

async function readSocrataSource(sourceKey, options) {
  const opts = options || {};
  const config = adapters.SOURCE_CONFIGS[sourceKey];
  const registryKey = REGISTRY_KEY[sourceKey];
  if (!config || !registryKey) throw new Error(`Unknown sourceKey: ${sourceKey}`);

  const baseSource = getSource(registryKey);
  const source = Object.assign({}, baseSource, {
    sourceId:config.sourceId,
    maxFreshnessHours:Number.isFinite(Number(opts.maxAgeDays)) ?
      Math.max(0, Number(opts.maxAgeDays)) * 24 :
      baseSource.maxFreshnessHours
  });

  const scope = normalizeScope({
    where:opts.where || null,
    select:opts.select || config.recordFields.join(','),
    order:opts.order || null
  });
  const observedAt = opts.observedAt || new Date().toISOString();
  const nowMs = Date.parse(observedAt);
  if (!Number.isFinite(nowMs)) throw new Error('observedAt must be a valid ISO date-time');

  const observed = await observeSocrataQuery(source, scope, {
    fetchImpl:opts.fetchFn || opts.fetchImpl || globalThis.fetch,
    nowMs,
    pageSize:Number(opts.pageSize) || 5000,
    maxRows:opts.maxRows === undefined ? 50000 : Number(opts.maxRows),
    appToken:opts.appToken || null
  });

  // Re-run the shared classifier at the wrapper boundary so a future observer
  // change cannot silently bypass the canonical PermitPlate source-state contract.
  const classification = model.classifySourceObservation(observed.receipt);
  const observation = canonicalObservation(observed.receipt, classification);
  const records = observed.records.map((row) => adapters.normalizeRow(sourceKey, row, {
    observedAt:observation.observedAt
  })).map((record) => Object.assign({}, record, {
    sourceObservationId:observation.observationId
  }));

  if (records.length !== observation.fetchedCount) {
    throw new Error(`${sourceKey}: normalized record count differs from source receipt`);
  }

  return {observation, records};
}

module.exports = {
  READER_VERSION,
  stableStringify,
  sha256,
  datasetId,
  queryScope,
  resourceUrl,
  metadataUrl,
  metadataFreshness,
  schemaFields,
  countFromPayload,
  canonicalObservation,
  readSocrataSource
};
