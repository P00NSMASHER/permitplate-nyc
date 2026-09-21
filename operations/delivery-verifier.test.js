'use strict';

const assert = require('assert');
const v = require('./delivery-verifier');

assert.equal(v.safeCsvCell('=1+1'), "'=1+1");
assert.equal(v.safeCsvCell('+cmd'), "'+cmd");
assert.equal(v.safeCsvCell('-cmd'), "'-cmd");
assert.equal(v.safeCsvCell('@cmd'), "'@cmd");
assert.equal(v.safeCsvCell('safe'), 'safe');
const csv = v.csvEncode([['comma,value', 'quote"value', 'line\nbreak']]);
assert(csv.includes('"comma,value"'));
assert(csv.includes('"quote""value"'));
assert(csv.includes('"line\nbreak"'));

const retryPlan = {signals: [{signalKey:'a'}, {signalKey:'b'}, {signalKey:'c'}]};
let delivered = new Set();
assert.deepEqual(v.pendingSignalKeys(retryPlan, 'TEST@EXAMPLE.COM', delivered), ['a','b','c']);
delivered = v.markDelivered(delivered, 'test@example.com', ['a']);
assert.deepEqual(v.pendingSignalKeys(retryPlan, 'test@example.com', delivered), ['b','c']);
delivered = v.markDelivered(delivered, 'test@example.com', ['b','c']);
assert.deepEqual(v.pendingSignalKeys(retryPlan, 'test@example.com', delivered), []);

const graph = [[
  'Venue Key','Commercial Fit','DOHMH CAMIS'
],[
  '1 MAIN ST|10001','LOW','50100000'
]];
const predecessor = v.validatePredecessorScan(graph, {predecessor_conflicts:[{applicant:{camis:'50100000'}}]});
assert.equal(predecessor.passed, true);
assert.equal(predecessor.presentInGraph, 1);

const safeReceipt = v.validateSourceObservationReceipts([{
  observationId:'obs-1',
  sourceId:'nyc-dohmh',
  connectorConfigHash:'cfg-1',
  observedAt:'2026-09-21T13:30:00Z',
  sourceFresh:true,
  transportOk:true,
  intendedFullScope:true,
  publisherCount:2,
  fetchedCount:2,
  cursorClosed:true,
  schemaFingerprint:'schema-1',
  rawPageHashes:['page-a'],
  declaredState:'COMPLETE_NONEMPTY',
  absenceActionsAllowed:true
}]);
assert.equal(safeReceipt.passed, true);
assert.equal(safeReceipt.enforced, true);
assert.equal(safeReceipt.states.COMPLETE_NONEMPTY, 1);

const unsafeReceipt = v.validateSourceObservationReceipts([{
  observationId:'obs-2',
  sourceId:'nyc-dob',
  connectorConfigHash:'cfg-2',
  observedAt:'2026-09-21T13:30:00Z',
  sourceFresh:true,
  transportOk:true,
  intendedFullScope:true,
  fetchedCount:0,
  cursorClosed:false,
  schemaFingerprint:'schema-2',
  rawPageHashes:['page-b'],
  declaredState:'VERIFIED_EMPTY',
  absenceActionsAllowed:true
}]);
assert.equal(unsafeReceipt.passed, false);
assert(unsafeReceipt.failures.some((x) => x.includes('declared source state')));
assert(unsafeReceipt.failures.some((x) => x.includes('absence actions are enabled')));

const duplicateReceipt = v.validateSourceObservationReceipts([
  {observationId:'dup', sourceId:'a', transportOk:false},
  {observationId:'dup', sourceId:'b', transportOk:false}
]);
assert.equal(duplicateReceipt.passed, false);
assert(duplicateReceipt.failures.some((x) => x.includes('blank or duplicated')));

const noReceiptCanary = v.validateSourceObservationReceipts([]);
assert.equal(noReceiptCanary.passed, true);
assert.equal(noReceiptCanary.enforced, false);

console.log('PermitPlate delivery verifier unit tests passed.');
