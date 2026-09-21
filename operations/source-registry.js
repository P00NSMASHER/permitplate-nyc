'use strict';

const {SOURCE_CONFIGS} = require('../pipeline/source-adapters');

function sourceFromAdapter(key, adapterKey, authority, maxFreshnessHours) {
  const config = SOURCE_CONFIGS[adapterKey];
  if (!config) throw new Error(`Missing adapter source config: ${adapterKey}`);
  const url = new URL(config.apiUrl);
  return Object.freeze({
    key,
    adapterKey,
    sourceId:config.sourceId,
    domain:url.hostname,
    datasetId:String(config.sourceId).split(':').pop(),
    authority,
    maxFreshnessHours
  });
}

const NYC_SOURCE_REGISTRY = Object.freeze({
  DOHMH: sourceFromAdapter(
    'DOHMH',
    'DOHMH',
    'NYC Department of Health and Mental Hygiene',
    72
  ),
  DOB: sourceFromAdapter(
    'DOB',
    'DOB_NOW',
    'NYC Department of Buildings',
    168
  ),
  SLA: sourceFromAdapter(
    'SLA',
    'SLA_PENDING',
    'New York State Liquor Authority',
    168
  )
});

function getSource(key) {
  const source = NYC_SOURCE_REGISTRY[String(key || '').toUpperCase()];
  if (!source) throw new Error(`Unknown PermitPlate source: ${key}`);
  return source;
}

module.exports = {
  NYC_SOURCE_REGISTRY,
  getSource
};
