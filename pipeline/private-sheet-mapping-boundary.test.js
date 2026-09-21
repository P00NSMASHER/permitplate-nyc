'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const mapping=require('./private-sheet-mapping');
const stripe=require('./stripe-subscriber');
const delivery=require('./delivery-plan');
const auth=require('./transport-authorization');

// All approvals, provider observations and identities below are synthetic fixtures.
function adapterResult(){
  return stripe.profileFromCheckout({
    session:{
      id:'cs_mapping_test',object:'checkout.session',payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
      mode:'subscription',status:'complete',payment_status:'paid',customer:'cus_mapping',
      customer_details:{email:'buyer@example.com'},metadata:{project:'permitplate_nyc'},subscription:'sub_mapping',
      custom_fields:[
        {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
        {key:'territory',type:'text',text:{value:'Manhattan, Queens'}},
        {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
      ]
    },
    subscription:{
      id:'sub_mapping',object:'subscription',created:1790003600,status:'active',customer:'cus_mapping',
      metadata:{project:'permitplate_nyc'},items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
    }
  });
}
function fixture(){
  const adapted=adapterResult();
  const artifact={
    status:'READY',artifactFingerprint:'artifact-fp-1',
    signalKeys:['normal:sub_mapping:event-1','starter:sub_mapping:base:event-2'],
    csvRows:[
      {'Signal Key':'normal:sub_mapping:event-1','Delivery Class':'NORMAL','Package ID':'PKG:1'},
      {'Signal Key':'starter:sub_mapping:base:event-2','Delivery Class':'STARTER','Package ID':'PKG:2'}
    ]
  };
  const attempt=delivery.createDeliveryAttempt({
    status:'READY',planFingerprint:artifact.artifactFingerprint,
    signals:artifact.signalKeys.map(signalKey=>({signalKey}))
  },'buyer@example.com');
  const message={status:'READY',messageFingerprint:'message-content-fixture',signalKeys:artifact.signalKeys};
  const transportAuthorization=auth.buildAuthorizationReceipt({
    approved:true,authorizationType:'OWNER_EXPLICIT_SEND',approvalSource:'SYNTHETIC_TEST_ONLY',approvalNonce:'mapping-fixture',
    approvedAt:'2026-09-21T17:45:00Z',expiresAt:'2026-09-21T18:15:00Z',
    attemptId:attempt.attemptId,messageIdentity:attempt.messageIdentity,recipient:attempt.recipient,
    artifactFingerprint:artifact.artifactFingerprint,messageFingerprint:message.messageFingerprint,signalKeys:attempt.signalKeys
  });
  return {
    artifact,attempt,message,transportAuthorization,
    profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
    transportStartedAt:'2026-09-21T17:59:30Z',reconciledAt:'2026-09-21T20:00:00Z',
    providerObservation:{
      status:'ACCEPTED',evidenceKind:'PROVIDER_READBACK',attemptId:attempt.attemptId,
      messageIdentity:attempt.messageIdentity,recipient:attempt.recipient,artifactFingerprint:artifact.artifactFingerprint,
      providerMessageId:'gmail-message-1',acceptedAt:'2026-09-21T18:00:00Z',observedAt:'2026-09-21T18:01:00Z'
    }
  };
}
function planned(){
  const f=fixture();
  delete f.providerObservation; delete f.transportStartedAt;
  delete f.transportAuthorization; delete f.message;
  return f;
}

test('subscriber mapping preserves all 21 existing private columns',()=>{
  const adapted=adapterResult(); const mapped=mapping.subscriberProfileRow(adapted);
  assert.equal(adapted.status,'ACTIVE'); assert.equal(mapped.sheet,'Subscriber Profiles');
  assert.equal(mapped.values.length,21); assert.deepEqual(Object.keys(mapped.row),mapping.SUBSCRIBER_PROFILE_HEADERS);
  assert.equal(mapped.row.Email,'buyer@example.com'); assert.equal(mapped.row.Categories,'Equipment');
  assert.equal(mapped.row['Boroughs/Territory'],'Manhattan; Queens');
  assert.equal(mapped.row['Baseline At'],adapted.profile.baselineAt);
  assert.equal(mapped.row['Starter Snapshot Enabled'],true);
  assert.equal(mapped.row['Stripe Subscription'],'sub_mapping');
  assert.equal(mapped.row['Profile Fingerprint'],adapted.profileFingerprint);
  assert.equal(mapped.row['Delivery Policy Version'],delivery.DELIVERY_PLANNER_VERSION);
  assert.equal(mapped.row['Preference Receipt ID'],adapted.preferenceReceiptId||'');
  assert.match(mapped.rowFingerprint,/^[0-9a-f]{64}$/);
});
test('no-send plans preserve the private schema without inventing provider state',()=>{
  const f=planned(); const mapped=mapping.deliveryStateRows(f);
  assert.equal(mapped.sheet,'Delivery State'); assert.equal(mapped.deliveryStatus,'PLANNED');
  assert.equal(mapped.providerStatus,'NOT_SENT'); assert.equal(mapped.rows.length,2);
  assert.ok(mapped.rows.every(item=>item.values.length===16));
  for(const item of mapped.rows){
    assert.deepEqual(Object.keys(item.row),mapping.DELIVERY_STATE_HEADERS);
    assert.equal(item.row['Message Identity'],f.attempt.messageIdentity);
    assert.equal(item.row['Artifact Fingerprint'],'artifact-fp-1');
    assert.equal(item.row['Delivery Status'],'PLANNED'); assert.equal(item.row['Provider Status'],'NOT_SENT');
    assert.equal(item.row['Delivered At'],''); assert.equal(item.row['Gmail Message ID'],'');
  }
  assert.deepEqual(mapped.rows.map(item=>item.row['Delivery Class']),['NORMAL','STARTER']);
  assert.deepEqual(mapped.rows.map(item=>item.row['Package ID']),['PKG:1','PKG:2']);
});
test('matching readback produces finalized provider-acceptance rows',()=>{
  const f=fixture(); const result=mapping.deliveryStateRows(f);
  assert.equal(result.deliveryStatus,'FINALIZED'); assert.equal(result.providerStatus,'ACCEPTED');
  assert.equal(result.deliveryConfirmed,false); assert.equal(result.retryAllowed,false);
  for(const {row} of result.rows){
    assert.equal(row['Gmail Message ID'],'gmail-message-1');
    assert.equal(row['Delivered At'],'2026-09-21T18:00:00.000Z');
    assert.equal(row['Last Reconciled At'],'2026-09-21T20:00:00.000Z');
    assert.equal(row['Authorization ID'],f.transportAuthorization.authorizationId);
  }
  assert.ok(result.providerReceipt.receiptFingerprint);
});
test('late reconciliation checks approval expiry at original transport time',()=>{
  const result=mapping.deliveryStateRows(fixture()); assert.equal(result.deliveryStatus,'FINALIZED');
});
test('explicit request rejection has no accepted timestamp',()=>{
  const f=fixture(); f.providerObservation={...f.providerObservation,status:'REJECTED',providerMessageId:null,providerRequestId:'request-1',occurredAt:'2026-09-21T18:00:00Z'};
  const result=mapping.deliveryStateRows(f);
  assert.equal(result.deliveryStatus,'REJECTED'); assert.equal(result.providerStatus,'REJECTED');
  assert.ok(result.rows.every(item=>item.row['Delivered At']===''));
});
test('unknown outcome stays pending and cannot authorize resend',()=>{
  const f=fixture(); f.providerObservation={status:'UNKNOWN'};
  const result=mapping.deliveryStateRows(f);
  assert.equal(result.deliveryStatus,'PENDING'); assert.equal(result.providerStatus,'UNKNOWN');
  assert.equal(result.retryAllowed,false); assert.ok(result.rows.every(item=>item.row['Delivered At']===''));
});
for(const [name,change,error] of [
  ['attempt recipient mismatch',f=>{f.attempt={...f.attempt,recipient:'other@example.com'};},/ATTEMPT_RECIPIENT_PROFILE_MISMATCH/],
  ['attempt artifact mismatch',f=>{f.attempt={...f.attempt,planFingerprint:'other'};},/ATTEMPT_ARTIFACT_FINGERPRINT_MISMATCH/],
  ['provider recipient mismatch',f=>{f.providerObservation.recipient='other@example.com';},/PROVIDER_RECIPIENT_MISMATCH/],
  ['provider message identity mismatch',f=>{f.providerObservation.messageIdentity='other';},/MESSAGE_IDENTITY_MISMATCH/],
  ['provider attempt mismatch',f=>{f.providerObservation.attemptId='other';},/PROVIDER_ATTEMPT_MISMATCH/],
  ['provider artifact mismatch',f=>{f.providerObservation.artifactFingerprint='other';},/PROVIDER_ARTIFACT_MISMATCH/],
  ['acceptance time missing',f=>{delete f.providerObservation.acceptedAt;},/PROVIDER_ACCEPTED_AT_INVALID/],
  ['message ID missing',f=>{delete f.providerObservation.providerMessageId;},/PROVIDER_MESSAGE_ID_MISSING/],
  ['authorization missing',f=>{delete f.transportAuthorization;},/TRANSPORT_AUTHORIZATION_REQUIRED/],
  ['bare authorization ID',f=>{f.transportAuthorization={authorizationId:'AUTH:invented'};},/TRANSPORT_AUTHORIZATION_INVALID/],
  ['authorization wrong message',f=>{f.message.messageFingerprint='other';},/MESSAGE_FINGERPRINT_MISMATCH/],
  ['send after approval expired',f=>{f.transportStartedAt='2026-09-21T18:30:00Z';},/AUTHORIZATION_EXPIRED/],
  ['send time missing',f=>{delete f.transportStartedAt;},/TRANSPORT_STARTED_AT_REQUIRED/],
  ['caller cannot override pending to final',f=>{f.providerObservation={status:'UNKNOWN'};f.deliveryStatus='FINALIZED';},/DELIVERY_STATUS_EVIDENCE_CONFLICT/],
  ['unsupported provider status',f=>{f.providerObservation.status='SUCCESS';},/PROVIDER_STATUS_INVALID/],
  ['unsupported local status',f=>{f.deliveryStatus='DELIVERED';},/DELIVERY_STATUS_INVALID/],
  ['caller supplied delivered time conflicts',f=>{f.deliveredAt='2026-09-21T19:00:00Z';},/DELIVERED_AT_EVIDENCE_CONFLICT/],
  ['caller supplied provider ID conflicts',f=>{f.gmailMessageId='other';},/PROVIDER_MESSAGE_ID_EVIDENCE_CONFLICT/],
  ['receipt predates send',f=>{f.providerObservation.acceptedAt='2026-09-21T17:59:00Z';},/PROVIDER_EVENT_BEFORE_TRANSPORT/],
  ['missing CSV signal row',f=>{f.artifact.csvRows.pop();},/ARTIFACT_ROW_SIGNAL_SET_MISMATCH/]
]) test(name+' refuses delivery-state rows',()=>{
  const f=fixture(); change(f); assert.throws(()=>mapping.deliveryStateRows(f),error);
});
test('caller cannot finalize a plan without any provider observation',()=>{
  const f=planned(); f.deliveryStatus='FINALIZED'; f.deliveredAt='2026-09-21T18:00:00Z';
  assert.throws(()=>mapping.deliveryStateRows(f),/DELIVERY_STATUS_EVIDENCE_CONFLICT/);
});
test('row planning is deterministic for the same evidence',()=>{
  const f=fixture(); const a=mapping.deliveryStateRows(f); const b=mapping.deliveryStateRows(JSON.parse(JSON.stringify(f)));
  assert.equal(a.batchFingerprint,b.batchFingerprint); assert.deepEqual(a.rows,b.rows);
});
test('original schema order stays intact',()=>{
  assert.deepEqual(mapping.SUBSCRIBER_PROFILE_HEADERS,[
    'Email','Categories','Boroughs/Territory','Minimum Score','Updated At','Notes','Baseline At',
    'Starter Snapshot Sent At','Starter Snapshot Through','Delivery Policy Version','Starter Snapshot Enabled',
    'Starter Days','Starter Limit','Max Signals','Status','Stripe Customer','Stripe Subscription','Price ID',
    'Profile Fingerprint','Checkout Session','Preference Receipt ID'
  ]);
  assert.deepEqual(mapping.DELIVERY_STATE_HEADERS,[
    'Recipient Email','Lead Key','Delivered At','Stripe Customer','Stripe Subscription','Gmail Message ID',
    'Attempt ID','Delivery Status','Message Identity','Artifact Fingerprint','Profile Fingerprint','Delivery Class',
    'Provider Status','Last Reconciled At','Package ID','Authorization ID'
  ]);
});
