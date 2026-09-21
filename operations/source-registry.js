'use strict';

const NYC_SOURCE_REGISTRY = Object.freeze({
  DOHMH: Object.freeze({
    key: 'DOHMH',
    sourceId: 'nyc-open-data:43nn-pn8j',
    domain: 'data.cityofnewyork.us',
    datasetId: '43nn-pn8j',
    authority: 'NYC Department of Health and Mental Hygiene',
    maxFreshnessHours: 72
  }),
  DOB: Object.freeze({
    key: 'DOB',
    sourceId: 'nyc-open-data:w9ak-ipjd',
    domain: 'data.cityofnewyork.us',
    datasetId: 'w9ak-ipjd',
    authority: 'NYC Department of Buildings',
    maxFreshnessHours: 168
  }),
  SLA: Object.freeze({
    key: 'SLA',
    sourceId: 'ny-open-data:f8i8-k2gm',
    domain: 'data.ny.gov',
    datasetId: 'f8i8-k2gm',
    authority: 'New York State Liquor Authority',
    maxFreshnessHours: 168
  })
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
