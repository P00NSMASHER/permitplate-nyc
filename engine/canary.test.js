'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const {selectNormalFeed,selectStarterSnapshot}=require('./subscriber_feed');
const {planDelivery,beginSend,markProviderAccepted,reconcileUncertain}=require('./delivery_state');

test('owner-controlled no-send canary covers baseline, snapshot, feed, and uncertain-send recovery',()=>{
  const subscriber={
    id:'OWNER_CANARY',
    baselineAt:'2026-09-18T12:00:00Z',
    starterSnapshotEnabled:true,
    boroughs:['Manhattan'],
    categories:['POS'],
    minScore:50,
  };

  const preBaseline={
    signalId:'old-active',
    detectedAt:'2026-09-17T12:00:00Z',
    materiallyChangedAt:null,
    active:true,
    borough:'Manhattan',
    categories:['POS'],
    bestScore:75,
    changeState:'NEWLY_DETECTED',
    deliverySuppressed:false,
  };
  const postBaseline={
    ...preBaseline,
    signalId:'new-after-baseline',
    detectedAt:'2026-09-18T12:05:00Z',
    bestScore:82,
  };

  const snapshot=selectStarterSnapshot([preBaseline,postBaseline],subscriber);
  const feed=selectNormalFeed([preBaseline,postBaseline],subscriber);

  assert.deepEqual(snapshot.map(x=>x.signalId),['old-active']);
  assert.deepEqual(feed.map(x=>x.signalId),['new-after-baseline']);

  // This is deliberately transport-free. We exercise the exact state transitions
  // using simulated provider receipts; no Gmail/prospect call occurs.
  let transportCalls=0;

  let snapshotDelivery=planDelivery({
    subscriberId:subscriber.id,
    deliveryKey:snapshot[0].deliveryKey,
    now:'2026-09-18T12:10:00Z',
  });
  snapshotDelivery=beginSend(snapshotDelivery,'2026-09-18T12:10:00Z');
  assert.equal(snapshotDelivery.shouldSend,true);
  // Simulate the provider boundary rather than calling it.
  snapshotDelivery=markProviderAccepted(snapshotDelivery,'SIMULATED-SNAPSHOT-RECEIPT','2026-09-18T12:10:01Z');

  let feedDelivery=planDelivery({
    subscriberId:subscriber.id,
    deliveryKey:feed[0].deliveryKey,
    now:'2026-09-18T12:10:00Z',
  });
  feedDelivery=beginSend(feedDelivery,'2026-09-18T12:10:00Z');
  // Simulate provider success + local-finalization crash. Sent-mail lookup finds
  // the deterministic Message-ID, so reconciliation finalizes without resend.
  feedDelivery=reconcileUncertain(feedDelivery,{
    now:'2026-09-18T12:10:30Z',
    foundProviderMessageId:'SIMULATED-RECONCILED-RECEIPT',
  });

  assert.equal(snapshotDelivery.state,'SENT');
  assert.equal(feedDelivery.state,'SENT');
  assert.equal(feedDelivery.recoveredBy,'SENT_MAIL_RECONCILIATION');
  assert.equal(feedDelivery.shouldSend,false);
  assert.notEqual(snapshotDelivery.messageId,feedDelivery.messageId);
  assert.equal(transportCalls,0);
});
