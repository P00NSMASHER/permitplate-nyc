'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./provider-reconciliation');

const NOW = '2026-09-21T18:00:00Z';
const attempt = () => ({
  state:'PLANNED',
  attemptId:'attempt-1',
  messageIdentity:'msg-1',
  recipient:'buyer@example.invalid',
  planFingerprint:'artifact-1',
  signalKeys:['normal:sub:a','starter:sub:b']
});
const observation = (changes={}) => ({
  status:'ACCEPTED',
  evidenceKind:'PROVIDER_READBACK',
  attemptId:'attempt-1',
  messageIdentity:'msg-1',
  recipient:'buyer@example.invalid',
  artifactFingerprint:'artifact-1',
  providerMessageId:'provider-1',
  acceptedAt:'2026-09-21T17:00:00Z',
  observedAt:'2026-09-21T17:01:00Z',
  ...changes
});
const run = (o, keys=[], extra={}) =>
  p.reconcileProviderEvidence(attempt(),o,keys,{now:NOW,...extra});

test('valid acceptance finalizes provider acceptance, not recipient delivery',()=>{
  const input=new Set();
  const result=run(observation(),input);
  assert.equal(result.state,'FINALIZED');
  assert.equal(result.deliveryConfirmed,false);
  assert.equal(result.retryAllowed,false);
  assert.equal(input.size,0);
  assert.equal(result.delivered.size,2);
  assert.equal(result.newlyAccepted.length,2);
  assert.equal(result.acceptedAt,'2026-09-21T17:00:00.000Z');
  assert.match(result.receipt.receiptFingerprint,/^[a-f0-9]{64}$/);
});

test('same acceptance replay does not add any signals twice',()=>{
  const first=run(observation());
  const second=run(observation(),first.delivered,{previousReceipt:first.receipt});
  assert.equal(second.state,'FINALIZED');
  assert.equal(second.reason,'IDEMPOTENT_REPLAY');
  assert.deepEqual(second.newlyAccepted,[]);
  assert.equal(second.delivered.size,2);
  assert.notEqual(second.delivered,first.delivered);
});

for(const o of [undefined,null,{status:'UNKNOWN'}]) {
  test('no acceptance evidence stays pending: '+JSON.stringify(o),()=>{
    const result=run(o);
    assert.equal(result.state,'PENDING');
    assert.equal(result.retryAllowed,false);
    assert.equal(result.delivered.size,0);
  });
}

for(const [name,changes,error] of [
  ['wrong message',{messageIdentity:'other'},'MESSAGE_IDENTITY_MISMATCH'],
  ['wrong attempt',{attemptId:'other'},'PROVIDER_ATTEMPT_MISMATCH'],
  ['wrong recipient',{recipient:'other@example.invalid'},'PROVIDER_RECIPIENT_MISMATCH'],
  ['extra recipient',{recipient:'buyer@example.invalid, other@example.invalid'},'PROVIDER_RECIPIENT_MISMATCH'],
  ['wrong artifact',{artifactFingerprint:'other'},'PROVIDER_ARTIFACT_MISMATCH'],
  ['missing provider message ID',{providerMessageId:''},'PROVIDER_MESSAGE_ID_MISSING'],
  ['missing source evidence kind',{evidenceKind:null},'PROVIDER_EVIDENCE_KIND_MISSING'],
  ['missing acceptance timestamp',{acceptedAt:null},'PROVIDER_ACCEPTED_AT_INVALID'],
  ['invalid date rollover',{acceptedAt:'2026-02-30T17:00:00Z'},'PROVIDER_ACCEPTED_AT_INVALID'],
  ['zone-less timestamp',{acceptedAt:'2026-09-21T17:00:00'},'PROVIDER_ACCEPTED_AT_INVALID'],
  ['unbounded timezone',{acceptedAt:'2026-09-21T17:00:00+18:00'},'PROVIDER_ACCEPTED_AT_INVALID'],
  ['future readback',{observedAt:'2026-09-22T17:00:00Z'},'PROVIDER_OBSERVATION_FROM_FUTURE'],
  ['event after readback',{acceptedAt:'2026-09-21T17:10:00Z'},'PROVIDER_EVENT_AFTER_OBSERVATION'],
  ['missing readback time',{observedAt:''},'PROVIDER_OBSERVED_AT_INVALID'],
  ['bogus status',{status:'SUCCEEDED'},'PROVIDER_STATUS_INVALID'],
  ['missing status',{status:undefined},'PROVIDER_STATUS_INVALID']
]) {
  test(name+' is not accepted',()=>{
    const original=new Set(['existing']);
    const result=run(observation(changes),original);
    assert.equal(result.state,'REVIEW');
    assert.ok(result.failures.includes(error));
    assert.deepEqual([...result.delivered],['existing']);
    assert.deepEqual([...original],['existing']);
    assert.equal(result.retryAllowed,false);
  });
}

test('unknown result still rejects an explicitly mismatched recipient',()=>{
  assert.equal(run({status:'UNKNOWN',recipient:'other@example.invalid'}).state,'REVIEW');
});

test('provider ID change against previous acceptance needs review',()=>{
  const first=run(observation());
  const second=run(
    observation({providerMessageId:'provider-2'}),
    first.delivered,
    {previousReceipt:first.receipt}
  );
  assert.equal(second.state,'REVIEW');
  assert.ok(second.failures.includes('PROVIDER_MESSAGE_ID_CHANGED'));
});

test('real request rejection is not delivery and not resend authorization',()=>{
  const result=run(observation({
    status:'REJECTED',
    providerRequestId:'request-1',
    providerMessageId:null,
    occurredAt:'2026-09-21T17:00:00Z'
  }));
  assert.equal(result.state,'REJECTED');
  assert.equal(result.reason,'PROVIDER_REJECTED');
  assert.equal(result.retryAllowed,false);
  assert.equal(result.delivered.size,0);
});

test('a bare rejected label is not evidence',()=>{
  const result=run(observation({
    status:'REJECTED',
    occurredAt:'2026-09-21T17:00:00Z'
  }));
  assert.equal(result.state,'REVIEW');
  assert.ok(result.failures.includes('PROVIDER_REQUEST_ID_MISSING'));
});

test('bounce preserves acceptance history without permitting a retry',()=>{
  const first=run(observation());
  const result=run(
    observation({status:'BOUNCED',occurredAt:'2026-09-21T17:00:30Z'}),
    first.delivered,
    {previousReceipt:first.receipt}
  );
  assert.equal(result.state,'REJECTED');
  assert.equal(result.reason,'PROVIDER_BOUNCED');
  assert.equal(result.delivered.size,2);
  assert.equal(result.retryAllowed,false);
});

test('stale acceptance does not erase a recorded bounce',()=>{
  const bounced=run(observation({
    status:'BOUNCED',
    occurredAt:'2026-09-21T17:00:30Z'
  }));
  assert.ok(
    run(observation(),[],{previousReceipt:bounced.receipt})
      .failures.includes('ACCEPTANCE_AFTER_BOUNCE_REVIEW')
  );
});

test('duplicate signal keys cannot finalize',()=>{
  const a=attempt();
  a.signalKeys=['duplicate','duplicate'];
  const r=p.reconcileProviderEvidence(a,observation(),[],{now:NOW});
  assert.equal(r.state,'REVIEW');
  assert.ok(r.failures.includes('SIGNAL_KEYS_INVALID'));
});

test('empty attempt cannot finalize',()=>{
  const a=attempt();
  a.signalKeys=[];
  assert.equal(
    p.reconcileProviderEvidence(a,observation(),[],{now:NOW}).state,
    'REVIEW'
  );
});

test('metadata and normalized recipient casing produce stable receipts',()=>{
  const a=run(observation());
  const b=run(observation({recipient:'BUYER@EXAMPLE.INVALID'}));
  assert.equal(a.receipt.receiptFingerprint,b.receipt.receiptFingerprint);
});

test('reconciliation clock must be explicit valid time when provided',()=>{
  assert.ok(
    run(observation(),[],{now:'invalid'})
      .failures.includes('RECONCILIATION_TIME_INVALID')
  );
});

test('reviewing one attempt never mutates a shared input set',()=>{
  const shared=new Set(['existing']);
  const result=run(observation(),shared);
  result.delivered.clear();
  assert.deepEqual([...shared],['existing']);
});
