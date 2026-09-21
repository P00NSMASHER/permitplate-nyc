'use strict';

const NYC_SOURCE_REGISTRY = Object.freeze({
  DOHMH: Object.freeze({
    key: 'DOHMH',
    sourceId: 'nyc-dohmh-restaurant-inspections',
    domain: 'data.cityofnewyork.us',
    datasetId: '43nn-pn8j',
    authority: 'NYC Department of Health and Mental Hygiene',
    maxFreshnessHours: 72
  }),
  DOB: Object.freeze({
    key: 'DOB',
    sourceId: 'nyc-dob-now-job-filings',
    domain: 'data.cityofnewyork.us',
    datasetId: 'w9ak-ipjd',
    authority: 'NYC Department of Buildings',
    maxFreshnessHours: 168
  }),
  SLA: Object.freeze({
    key: 'SLA',
    sourceId: 'nys-sla-pending-licenses',
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
