'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectNormalFeed, selectStarterSnapshot } = require('./subscriber_feed');

const subscriber = {
  id: 'sub-1',
  baselineAt: '2026-09-18T12:00:00Z',
  starterSnapshotEnabled: true,
  boroughs: ['Manhattan'],
  categories: ['POS'],
  minScore: 50,
};

function signal(id, detectedAt, overrides = {}) {
  return {
    signalId: id,
    detectedAt,
    materiallyChangedAt: null,
    active: true,
    borough: 'Manhattan',
    categories: ['POS'],
    bestScore: 70,
    changeState: 'NEWLY_DETECTED',
    deliverySuppressed: false,
    ...overrides,
  };
}

test('normal feed excludes pre-baseline unchanged signals', () => {
  const rows = selectNormalFeed([signal('old','2026-09-17T12:00:00Z')], subscriber);
  assert.equal(rows.length, 0);
});

test('post-baseline new signal enters normal feed', () => {
  const rows = selectNormalFeed([signal('new','2026-09-18T12:01:00Z')], subscriber);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deliveryClass, 'NORMAL_FEED');
});

test('pre-baseline signal with material post-baseline change enters normal feed', () => {
  const rows = selectNormalFeed([
    signal('advanced','2026-09-16T12:00:00Z',{ materiallyChangedAt:'2026-09-18T13:00:00Z', changeState:'STAGE_ADVANCED' })
  ], subscriber);
  assert.equal(rows.length, 1);
});

test('starter snapshot is limited to active prior-seven-day items and capped at ten', () => {
  const signals = Array.from({length:15}, (_,i) =>
    signal(`s${i}`, new Date(Date.parse('2026-09-18T11:00:00Z') - i*60_000).toISOString(), {bestScore:100-i})
  );
  const rows = selectStarterSnapshot(signals, subscriber);
  assert.equal(rows.length, 10);
  assert.ok(rows.every(r => r.deliveryClass === 'STARTER_SNAPSHOT'));
  assert.ok(rows.every(r => r.originalDetectedAt));
});

test('starter snapshot never includes signals older than seven days or inactive', () => {
  const rows = selectStarterSnapshot([
    signal('too-old','2026-09-10T11:59:59Z'),
    signal('inactive','2026-09-17T12:00:00Z',{active:false}),
    signal('good','2026-09-17T12:00:00Z'),
  ], subscriber);
  assert.deepEqual(rows.map(r=>r.signalId), ['good']);
});

test('snapshot and normal-feed exactly-once keys are separate namespaces', () => {
  const old = signal('same','2026-09-17T12:00:00Z');
  const changed = {...old, materiallyChangedAt:'2026-09-18T13:00:00Z', changeState:'STAGE_ADVANCED', changeVersion:'v2'};
  const snap = selectStarterSnapshot([old], subscriber)[0];
  const feed = selectNormalFeed([changed], subscriber)[0];
  assert.notEqual(snap.deliveryKey, feed.deliveryKey);
  assert.match(snap.deliveryKey, /^snapshot:/);
  assert.match(feed.deliveryKey, /^feed:/);
});

test('profile filters and suppressions apply to both feed classes', () => {
  const wrongBorough=signal('b','2026-09-18T13:00:00Z',{borough:'Queens'});
  const low=signal('l','2026-09-18T13:00:00Z',{bestScore:49});
  const suppressed=signal('x','2026-09-18T13:00:00Z',{deliverySuppressed:true});
  assert.equal(selectNormalFeed([wrongBorough,low,suppressed],subscriber).length,0);
  assert.equal(selectStarterSnapshot([
    {...wrongBorough,detectedAt:'2026-09-17T13:00:00Z'},
    {...low,detectedAt:'2026-09-17T13:00:00Z'},
    {...suppressed,detectedAt:'2026-09-17T13:00:00Z'},
  ],subscriber).length,0);
});

test('no meaningful change is suppressed', () => {
  const s=signal('n','2026-09-18T13:00:00Z',{changeState:'NO_MEANINGFUL_CHANGE'});
  assert.equal(selectNormalFeed([s],subscriber).length,0);
});
