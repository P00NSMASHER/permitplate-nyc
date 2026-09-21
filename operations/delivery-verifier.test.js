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

console.log('PermitPlate delivery verifier unit tests passed.');
