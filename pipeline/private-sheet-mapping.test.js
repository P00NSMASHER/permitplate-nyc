'use strict';

const assert=require('assert');
const mapping=require('./private-sheet-mapping');
const stripe=require('./stripe-subscriber');
const delivery=require('./delivery-plan');
const transport=require('./transport-authorization');

function adapterResult(){
  return stripe.profileFromCheckoutAndPreferences({
    session:{
      id:'cs_mapping_test',
      object:'checkout.session',
      payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
      mode:'subscription',
      status:'complete',
      payment_status:'paid',
      customer:'cus_mapping',
      customer_details:{email:'buyer@example.com'},
      metadata:{project:'permitplate_nyc'},
      subscription:'sub_mapping',
      custom_fields:[]
    },
    subscription:{
      id:'sub_mapping',
      object:'subscription',
      created:1790003600,
      status:'active',
      customer:'cus_mapping',
      metadata:{project:'permitplate_nyc'},
      items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
    },
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc',
    preferences:{
      category:'Equipment',
      boroughs:['Manhattan','Queens'],
      starterSnapshotEnabled:true,
      minimumScore:60,
      starterDays:7,
      starterLimit:10,
      maxSignals:25
    },
    preferenceSource:'NETLIFY_PRECHECKOUT_FORM',
    preferenceReceiptId:'submission_mapping'
  });
}

function artifact(){
  return {
    status:'READY',
    artifactFingerprint:'artifact-fp-1',
    signalKeys:['normal:sub_mapping:event-1','starter:sub_mapping:base:event-2'],
    csvRows:[
      {
        'Signal Key':'normal:sub_mapping:event-1',
        'Delivery Class':'NORMAL',
        'Package ID':'PKG:1'
      },
      {
        'Signal Key':'starter:sub_mapping:base:event-2',
        'Delivery Class':'STARTER',
        'Package ID':'PKG:2'
      }
    ]
  };
}

function attempt(a){
  return delivery.createDeliveryAttempt({
    status:'READY',
    planFingerprint:a.artifactFingerprint,
    signals:a.signalKeys.map(signalKey=>({signalKey}))
  },'buyer@example.com');
}

function message(a){
  return {
    status:'READY',
    messageFingerprint:'message-fp-1',
    signalKeys:a.signalKeys.slice()
  };
}

function authorization(a,att,msg){
  return transport.buildAuthorizationReceipt({
    approved:true,
    authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'OWNER_CHAT_EXPLICIT',
    approvalNonce:'mapping-nonce',
    approvedAt:'2026-09-21T16:59:00Z',
    expiresAt:'2026-09-21T17:30:00Z',
    attemptId:att.attemptId,
    messageIdentity:att.messageIdentity,
    artifactFingerprint:a.artifactFingerprint,
    messageFingerprint:msg.messageFingerprint,
    recipient:att.recipient,
    signalKeys:att.signalKeys
  });
}

function acceptedObservation(a,att){
  return {
    status:'ACCEPTED',
    evidenceKind:'PROVIDER_READBACK',
    attemptId:att.attemptId,
    messageIdentity:att.messageIdentity,
    recipient:att.recipient,
    artifactFingerprint:a.artifactFingerprint,
    providerMessageId:'gmail-message-1',
    acceptedAt:'2026-09-21T17:01:00Z',
    observedAt:'2026-09-21T17:02:00Z'
  };
}

{
  const adapted=adapterResult();
  assert.equal(adapted.status,'ACTIVE');
  const mapped=mapping.subscriberProfileRow(adapted);
  assert.equal(mapped.sheet,'Subscriber Profiles');
  assert.equal(mapped.values.length,21);
  assert.deepEqual(Object.keys(mapped.row),mapping.SUBSCRIBER_PROFILE_HEADERS);
  assert.equal(mapped.row.Email,'buyer@example.com');
  assert.equal(mapped.row.Categories,'Equipment');
  assert.equal(mapped.row['Boroughs/Territory'],'Manhattan; Queens');
  assert.equal(mapped.row['Baseline At'],adapted.profile.baselineAt);
  assert.equal(mapped.row['Starter Snapshot Enabled'],true);
  assert.equal(mapped.row['Stripe Subscription'],'sub_mapping');
  assert.equal(mapped.row['Profile Fingerprint'],adapted.profileFingerprint);
  assert.equal(mapped.row['Delivery Policy Version'],delivery.DELIVERY_PLANNER_VERSION);
  assert.equal(mapped.row['Preference Receipt ID'],'submission_mapping');
  assert.match(mapped.rowFingerprint,/^[0-9a-f]{64}$/);
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint}
  });
  assert.equal(mapped.sheet,'Delivery State');
  assert.equal(mapped.deliveryStatus,'PLANNED');
  assert.equal(mapped.providerStatus,'NOT_SENT');
  assert.equal(mapped.deliveryConfirmed,false);
  assert.equal(mapped.retryAllowed,false);
  assert.equal(mapped.providerReceipt,null);
  assert.equal(mapped.rows.length,2);
  assert(mapped.rows.every(item=>item.values.length===16));
  assert(mapped.rows.every(item=>
    JSON.stringify(Object.keys(item.row))===JSON.stringify(mapping.DELIVERY_STATE_HEADERS)
  ));
  assert.deepEqual(mapped.rows.map(item=>item.row['Delivery Class']),['NORMAL','STARTER']);
  assert.deepEqual(mapped.rows.map(item=>item.row['Package ID']),['PKG:1','PKG:2']);
  assert(mapped.rows.every(item=>item.row['Message Identity']===att.messageIdentity));
  assert(mapped.rows.every(item=>item.row['Artifact Fingerprint']==='artifact-fp-1'));
  assert(mapped.rows.every(item=>item.row['Delivery Status']==='PLANNED'));
  assert(mapped.rows.every(item=>item.row['Provider Status']==='NOT_SENT'));
  assert(mapped.rows.every(item=>item.row['Authorization ID']===''));
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  const auth=authorization(a,att,msg);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    message:msg,
    profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
    providerObservation:acceptedObservation(a,att),
    transportAuthorization:auth,
    transportStartedAt:'2026-09-21T17:00:00Z',
    reconciledAt:'2026-09-21T17:03:00Z'
  });
  assert.equal(mapped.deliveryStatus,'FINALIZED');
  assert.equal(mapped.providerStatus,'ACCEPTED');
  assert.equal(mapped.deliveryConfirmed,false);
  assert.equal(mapped.retryAllowed,false);
  assert(mapped.providerReceipt);
  assert.equal(mapped.providerReceipt.attemptId,att.attemptId);
  assert.equal(mapped.providerReceipt.messageIdentity,att.messageIdentity);
  assert(mapped.rows.every(item=>item.row['Gmail Message ID']==='gmail-message-1'));
  assert(mapped.rows.every(item=>item.row['Delivered At']==='2026-09-21T17:01:00.000Z'));
  assert(mapped.rows.every(item=>item.row['Last Reconciled At']==='2026-09-21T17:03:00.000Z'));
  assert(mapped.rows.every(item=>item.row['Authorization ID']===auth.authorizationId));
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  const auth=authorization(a,att,msg);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    message:msg,
    profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
    providerObservation:{
      status:'REJECTED',
      evidenceKind:'PROVIDER_SEND_RESPONSE',
      attemptId:att.attemptId,
      messageIdentity:att.messageIdentity,
      recipient:att.recipient,
      artifactFingerprint:a.artifactFingerprint,
      providerRequestId:'request-rejected-1',
      occurredAt:'2026-09-21T17:00:30Z',
      observedAt:'2026-09-21T17:00:40Z'
    },
    transportAuthorization:auth,
    transportStartedAt:'2026-09-21T17:00:00Z',
    reconciledAt:'2026-09-21T17:03:00Z'
  });
  assert.equal(mapped.deliveryStatus,'REJECTED');
  assert.equal(mapped.providerStatus,'REJECTED');
  assert(mapped.rows.every(item=>item.row['Delivered At']===''));
  assert(mapped.rows.every(item=>item.row['Authorization ID']===auth.authorizationId));
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:Object.assign({},att,{recipient:'other@example.com'}),
      profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint}
    }),
    /ATTEMPT_RECIPIENT_PROFILE_MISMATCH/
  );
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:Object.assign({},att,{planFingerprint:'wrong'}),
      profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint}
    }),
    /ATTEMPT_ARTIFACT_FINGERPRINT_MISMATCH/
  );
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:att,
      profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
      deliveryStatus:'FINALIZED'
    }),
    /DELIVERY_STATUS_EVIDENCE_CONFLICT/
  );
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:att,
      message:msg,
      profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
      providerObservation:acceptedObservation(a,att),
      transportStartedAt:'2026-09-21T17:00:00Z',
      reconciledAt:'2026-09-21T17:03:00Z'
    }),
    /TRANSPORT_AUTHORIZATION_REQUIRED/
  );
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  const auth=authorization(a,att,msg);
  const bad=acceptedObservation(a,att);
  bad.recipient='other@example.com';
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:att,
      message:msg,
      profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint},
      providerObservation:bad,
      transportAuthorization:auth,
      transportStartedAt:'2026-09-21T17:00:00Z',
      reconciledAt:'2026-09-21T17:03:00Z'
    }),
    /PROVIDER_EVIDENCE_INVALID:PROVIDER_RECIPIENT_MISMATCH/
  );
}

{
  const adapted=adapterResult();
  const a=artifact();
  const att=attempt(a);
  const first=mapping.deliveryStateRows({
    artifact:a,attempt:att,
    profile:{profile:adapted.profile,profileFingerprint:adapted.profileFingerprint}
  });
  const second=mapping.deliveryStateRows({
    artifact:JSON.parse(JSON.stringify(a)),
    attempt:JSON.parse(JSON.stringify(att)),
    profile:{
      profile:JSON.parse(JSON.stringify(adapted.profile)),
      profileFingerprint:adapted.profileFingerprint
    }
  });
  assert.equal(first.batchFingerprint,second.batchFingerprint);
  assert.deepEqual(first.rows,second.rows);
}

assert.deepEqual(mapping.SUBSCRIBER_PROFILE_HEADERS,[
  'Email','Categories','Boroughs/Territory','Minimum Score','Updated At','Notes',
  'Baseline At','Starter Snapshot Sent At','Starter Snapshot Through','Delivery Policy Version',
  'Starter Snapshot Enabled','Starter Days','Starter Limit','Max Signals','Status',
  'Stripe Customer','Stripe Subscription','Price ID','Profile Fingerprint','Checkout Session',
  'Preference Receipt ID'
]);
assert.deepEqual(mapping.DELIVERY_STATE_HEADERS,[
  'Recipient Email','Lead Key','Delivered At','Stripe Customer','Stripe Subscription',
  'Gmail Message ID','Attempt ID','Delivery Status','Message Identity','Artifact Fingerprint',
  'Profile Fingerprint','Delivery Class','Provider Status','Last Reconciled At','Package ID',
  'Authorization ID'
]);

console.log('PermitPlate private sheet mapping tests passed.');
