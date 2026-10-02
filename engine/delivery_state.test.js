'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  makeMessageId,planDelivery,beginSend,markProviderAccepted,reconcileUncertain,markDefiniteFailure
}=require('./delivery_state');

const NOW='2026-09-18T12:00:00Z';

test('delivery identity is deterministic and delivery-key specific',()=>{
  const a=makeMessageId('sub-1','feed:sub-1:sig-1:v1');
  const b=makeMessageId('sub-1','feed:sub-1:sig-1:v1');
  const c=makeMessageId('sub-1','snapshot:sub-1:sig-1:baseline');
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.match(a,/^<pp-[0-9a-f]{32}@permitplate\.invalid>$/);
});

test('normal successful send becomes terminal and cannot be resent',()=>{
  let r=planDelivery({subscriberId:'sub-1',deliveryKey:'feed:1',now:NOW});
  r=beginSend(r,NOW);
  assert.equal(r.shouldSend,true);
  r=markProviderAccepted(r,'gmail-123','2026-09-18T12:00:01Z');
  assert.equal(r.state,'SENT');
  assert.equal(r.providerMessageId,'gmail-123');
  const replay=beginSend(r,'2026-09-18T12:01:00Z');
  assert.equal(replay.shouldSend,false);
  assert.equal(replay.state,'SENT');
});

test('provider-success ledger-crash recovers from Sent mailbox without resend',()=>{
  let r=planDelivery({subscriberId:'sub-1',deliveryKey:'feed:2',now:NOW});
  r=beginSend(r,NOW);
  // Simulate provider accepted the MIME message, but process crashed before local finalization.
  const recovered=reconcileUncertain(r,{
    now:'2026-09-18T12:00:30Z',
    foundProviderMessageId:'gmail-recovered'
  });
  assert.equal(recovered.state,'SENT');
  assert.equal(recovered.shouldSend,false);
  assert.equal(recovered.providerMessageId,'gmail-recovered');
  assert.equal(recovered.recoveredBy,'SENT_MAIL_RECONCILIATION');
});

test('uncertain provider outcome does not permit immediate resend',()=>{
  let r=planDelivery({subscriberId:'sub-1',deliveryKey:'feed:3',now:NOW});
  r=beginSend(r,NOW);
  const pending=reconcileUncertain(r,{now:'2026-09-18T12:01:00Z',graceSeconds:120});
  assert.equal(pending.state,'SENDING');
  assert.equal(pending.shouldSend,false);
  assert.equal(pending.lastErrorCode,'provider_outcome_uncertain');
});

test('retry becomes eligible only after reconciliation grace and no Sent match',()=>{
  let r=planDelivery({subscriberId:'sub-1',deliveryKey:'feed:4',now:NOW});
  r=beginSend(r,NOW);
  r=reconcileUncertain(r,{now:'2026-09-18T12:02:01Z',graceSeconds:120});
  assert.equal(r.state,'RETRY_READY');
  assert.equal(r.shouldSend,false);
  const retry=beginSend(r,'2026-09-18T12:02:02Z');
  assert.equal(retry.shouldSend,true);
  assert.equal(retry.attemptCount,2);
});

test('definite retryable failure is bounded',()=>{
  let r=planDelivery({subscriberId:'sub-1',deliveryKey:'feed:5',now:NOW});
  r=beginSend(r,NOW);
  r=markDefiniteFailure(r,'gmail_rejected','2026-09-18T12:00:01Z',{retryable:true,maxAttempts:2});
  assert.equal(r.state,'RETRY_READY');
  r=beginSend(r,'2026-09-18T12:00:02Z');
  r=markDefiniteFailure(r,'gmail_rejected','2026-09-18T12:00:03Z',{retryable:true,maxAttempts:2});
  assert.equal(r.state,'FAILED');
  assert.equal(r.lastErrorCode,'retry_exhausted');
});
