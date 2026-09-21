'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const adapters = require('./source-adapters');
const builder = require('./candidate-builder');
const detection = require('./detection-ledger');

// Synthetic business records only. No network, messages, or persisted production state.
function graphFor(recordDate, overrides = {}) {
  const row = {
    camis:'59980001', dba:'Synthetic Example Cafe', boro:'Manhattan',
    building:'10', street:'EXAMPLE ST', zipcode:'10001', cuisine_description:'Coffee/Tea',
    inspection_date:'1900-01-01T00:00:00.000', record_date:recordDate,
    ...overrides
  };
  const batch = records => ({observation:{state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true},records});
  return builder.buildCurrentGraph({
    dohmhBatch:batch([adapters.normalizeDohmhRow(row,{observedAt:recordDate})]),
    slaBatch:batch([]), dobBatch:batch([]), reviewedIdentityBridges:[]
  });
}

test('publisher record_date refresh alone does not create a customer opportunity', () => {
  const first = graphFor('2026-09-21T12:00:00Z');
  const second = graphFor('2026-09-22T12:00:00Z');
  assert.notEqual(first.graphDigest, second.graphDigest, 'raw source provenance must still record a different extract');
  const baseline = detection.bootstrapLedger(first,'2026-09-21T13:00:00Z');
  const replay = detection.advanceDetectionLedger(baseline.ledger,second,'2026-09-22T13:00:00Z');
  assert.equal(replay.committed,true);
  assert.equal(replay.customerEligibleReceipts.length,0,'data-pull timestamps are not business changes');
  assert.equal(replay.ledger.entries['CAMIS:59980001'].lastCustomerEventAt,null);
});

test('a real pre-permit inspection remains a customer-eligible material change', () => {
  const first = graphFor('2026-09-21T12:00:00Z');
  const second = graphFor('2026-09-22T12:00:00Z',{
    inspection_date:'2026-09-22T10:00:00.000',
    inspection_type:'Pre-permit (Operational) / Initial Inspection',
    action:'No violations were recorded at the time of this inspection.'
  });
  const baseline = detection.bootstrapLedger(first,'2026-09-21T13:00:00Z');
  const replay = detection.advanceDetectionLedger(baseline.ledger,second,'2026-09-22T13:00:00Z');
  assert.equal(replay.customerEligibleReceipts.length,1);
  assert.equal(replay.customerEligibleReceipts[0].detectionClass,'MATERIAL_CHANGE');
});
