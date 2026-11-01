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
  queryFingerprint:'query-1',
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
  queryFingerprint:'query-2',
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

{
  const base = {
    'Venue Key':'153 BOWERY|10002',
    'Latest Signal Date':'2026-09-18',
    'Stage':'BUILDOUT / LICENSING',
    'Sources':'DOHMH;DOB',
    'Why Now':'New buildout filing',
    'Purchase Window':'NOW',
    'Commercial Fit':'HIGH',
    'Best Score':90
  };
  const same = Object.assign({}, base);
  const later = Object.assign({}, base, {
    'Latest Signal Date':'2026-09-21',
    'Stage':'MULTI-SOURCE NEAR-OPENING',
    'Why Now':'New corroborating SLA evidence'
  });
  assert.equal(v.materialChangeFingerprint(base), v.materialChangeFingerprint(same));
  assert.notEqual(v.materialChangeFingerprint(base), v.materialChangeFingerprint(later));
  assert.notEqual(
    v.makeSignalKey('normal', '2026-09-18', base),
    v.makeSignalKey('normal', '2026-09-18', later)
  );
}

{
  const row = {
    'Venue Key':'A',
    'Change Fingerprint':'explicit-change-123'
  };
  assert.equal(v.materialChangeFingerprint(row), 'explicit-change-123');
  assert(v.makeSignalKey('normal', '2026-09-18', row).endsWith(':explicit-change-123'));
}


/**
 * Adversarial source-date regression. The same validated graph/queue/source
 * fixture must reject impossible days and inverted date bounds without relying
 * on a staging mismatch or unrelated missing data.
 */
function dateEvidenceFixture(firstDate, latestDate) {
  const venueKey = '153 BOWERY|10002';
  const graphColumns = [
    'Venue Key', 'Commercial Fit', 'First Signal Date', 'Latest Signal Date',
    'Source Count', 'Sources', 'POS Score', 'Insurance Score', 'Equipment Score',
    'Hood/Fire Score', 'Waste Score', 'Pest Score', 'Linen Score',
    'Distribution Score', 'Best Score'
  ];
  const graphRows = [graphColumns, [
    venueKey, 'HIGH', firstDate, latestDate, '1', 'DOB',
    90, 0, 0, 0, 0, 0, 0, 0, 90
  ]];
  const leads = [['Lead Key', 'Venue Key'], ['lead-1', venueKey]];
  return {
    graph: graphRows,
    graphStaging: graphRows,
    leads,
    leadsStaging: leads,
    sourceEvents: [['Event ID', 'Venue Key', 'Source'], ['event-1', venueKey, 'DOB']],
    deliveryState: [['Delivery ID']]
  };
}

for (const [firstDate, latestDate] of [
  ['2024-02-29', '2024-03-01'],
  ['2000-02-29', '2000-03-01'],
  ['2026-01-31', '2026-01-31']
]) {
  const result = v.validateSnapshot(dateEvidenceFixture(firstDate, latestDate));
  assert.equal(result.passed, true, 'valid dates rejected: ' + JSON.stringify(result.failures));
}

for (const invalidDate of [
  '2026-02-29', '2026-02-30', '1900-02-29', '2026-04-31',
  '2026-00-01', '2026-13-01', '2026-01-00'
]) {
  const result = v.validateSnapshot(dateEvidenceFixture(invalidDate, '2026-12-31'));
  assert.equal(result.passed, false, 'accepted impossible source date: ' + invalidDate);
  assert(result.failures.some((failure) => failure.includes('valid ISO calendar dates')),
    'invalid date was not rejected for its calendar validity: ' + invalidDate);
}

const backwardsDate = v.validateSnapshot(dateEvidenceFixture('2026-07-02', '2026-07-01'));
assert.equal(backwardsDate.passed, false, 'accepted a latest signal earlier than its first');
assert(backwardsDate.failures.some((failure) => failure.includes('precedes first signal date')),
  'failed to identify backwards date chronology');


// Source-integrity regression: an ambiguous sheet header cannot hide or
// overwrite contradictory evidence during delivery readiness checks.
{
  const clean=dateEvidenceFixture('2026-09-20','2026-09-21');
  assert.equal(v.validateSnapshot(clean).passed,true,'unmodified control must pass');
  assert.deepEqual(v.rowObjects([['Venue Key','Stage'],['key-1','BUILDOUT']]),
    [{'Venue Key':'key-1',Stage:'BUILDOUT'}]);

  for(const [table,staging,header,second] of [
    ['graph','graphStaging','Commercial Fit','LOW'],
    ['leads','leadsStaging','Lead Key','lead-overwrite'],
    ['sourceEvents',null,'Event ID','event-overwrite'],
    ['deliveryState',null,'Delivery ID',null]
  ]){
    const fixture=JSON.parse(JSON.stringify(clean));
    fixture[table][0].push(' '+header+' ');
    if(fixture[table].length>1)fixture[table][1].push(second);
    if(staging)fixture[staging]=fixture[table];
    const result=v.validateSnapshot(fixture);
    assert.equal(result.passed,false,table+' accepted a duplicate normalized header');
    assert(result.failures.some(message=>message.includes(table+': AMBIGUOUS_SHEET_HEADERS')),
      table+' did not explain the ambiguous header');
  }
  const blank=JSON.parse(JSON.stringify(clean));
  blank.graph[0].push('  ');
  blank.graph[1].push('ignored');
  blank.graphStaging=blank.graph;
  const blankResult=v.validateSnapshot(blank);
  assert.equal(blankResult.passed,false,'blank header must invalidate snapshot');
  assert(blankResult.failures.some(message=>message.includes('graph: AMBIGUOUS_SHEET_HEADERS')));

  assert.throws(()=>v.rowObjects([['Source','source'],['DOB','SLA']]),
    /AMBIGUOUS_SHEET_HEADERS/,'case-only duplicate headers must not be accepted');
  const duplicateReceiptColumns=v.validateSourceObservationReceipts([
    ['Observation ID',' Observation ID '],['obs-1','spoofed-id']
  ]);
  assert.equal(duplicateReceiptColumns.passed,false);
  assert.equal(duplicateReceiptColumns.enforced,true);
  assert(duplicateReceiptColumns.failures.some(message=>message.includes('AMBIGUOUS_SHEET_HEADERS')));
}

console.log('PermitPlate delivery verifier unit tests passed.');
