'use strict';

const assert=require('assert');
const mapping=require('./private-sheet-mapping');
const stripe=require('./stripe-subscriber');
const delivery=require('./delivery-plan');
const transport=require('./transport-authorization');

function session(){
  return {
    id:'cs_mapping_test',
    object:'checkout.session',
    payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',
    status:'complete',
    payment_status:'paid',
    customer:'cus_mapping',
    customer_details:{email:'buyer@example.com'},
    client_reference_id:null,
    metadata:{project:'permitplate_nyc'},
    subscription:'sub_mapping',
    custom_fields:[
      {key:'category',type:'dropdown',optional:false,dropdown:{value:'equipment'}},
      {key:'territory',type:'dropdown',optional:false,dropdown:{value:'ManhattanQueens'}},
      {key:'starter',type:'dropdown',optional:false,dropdown:{value:'yes'}}
    ]
  };
}
function subscription(){
  return {
    id:'sub_mapping',
    object:'subscription',
    created:1790003600,
    status:'active',
    customer:'cus_mapping',
    metadata:{project:'permitplate_nyc'},
    items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
  };
}
function activationResult(){
  return stripe.profileFromCheckout({
    session:session(),
    subscription:subscription(),
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc'
  });
}
function artifact(){
  return {
    status:'READY',
    artifactFingerprint:'artifact-fp-1',
    signalKeys:['normal:sub_mapping:event-1','starter:sub_mapping:base:event-2'],
    csvRows:[
      {'Signal Key':'normal:sub_mapping:event-1','Delivery Class':'NORMAL','Package ID':'PKG:1'},
      {'Signal Key':'starter:sub_mapping:base:event-2','Delivery Class':'STARTER','Package ID':'PKG:2'}
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
  const activated=activationResult();
  assert.equal(activated.status,'ACTIVE');
  const mapped=mapping.subscriberProfileRow(activated);
  assert.equal(mapped.sheet,'Subscriber Profiles');
  assert.equal(mapped.values.length,25);
  assert.deepEqual(Object.keys(mapped.row),mapping.SUBSCRIBER_PROFILE_HEADERS);
  assert.equal(mapped.row.Email,'buyer@example.com');
  assert.equal(mapped.row.Categories,'Equipment');
  assert.equal(mapped.row['Boroughs/Territory'],'Manhattan; Queens');
  assert.equal(mapped.row['Baseline At'],activated.profile.baselineAt);
  assert.equal(mapped.row['Starter Snapshot Enabled'],true);
  assert.equal(mapped.row['Stripe Subscription'],'sub_mapping');
  assert.equal(mapped.row['Profile Fingerprint'],activated.profileFingerprint);
  assert.equal(mapped.row['Delivery Policy Version'],delivery.DELIVERY_PLANNER_VERSION);
  assert.equal(mapped.row['Preference Receipt ID'],'cs_mapping_test');
  assert.equal(mapped.row['Preference Source'],'STRIPE_CUSTOM_FIELDS');
  assert.equal(
    mapped.row['Subscription Context Fingerprint'],
    activated.subscriptionContextFingerprint
  );
  assert.equal(mapped.row['Onboarding Match Fingerprint'],'');
  assert.equal(mapped.row['Activation Fingerprint'],'');
  assert.match(mapped.rowFingerprint,/^[0-9a-f]{64}$/);
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    profile:{
      profile:activated.profile,
      profileFingerprint:activated.profileFingerprint
    }
  });
  assert.equal(mapped.sheet,'Delivery State');
  assert.equal(mapped.deliveryStatus,'PLANNED');
  assert.equal(mapped.providerStatus,'NOT_SENT');
  assert.equal(mapped.deliveryConfirmed,false);
  assert.equal(mapped.retryAllowed,false);
  assert.equal(mapped.providerReceipt,null);
  assert.equal(mapped.rows.length,2);
  assert(mapped.rows.every(item=>item.values.length===19));
  assert(mapped.rows.every(item=>
    JSON.stringify(Object.keys(item.row))===JSON.stringify(mapping.DELIVERY_STATE_HEADERS)
  ));
  assert.deepEqual(mapped.rows.map(item=>item.row['Delivery Class']),['NORMAL','STARTER']);
  assert.deepEqual(mapped.rows.map(item=>item.row['Package ID']),['PKG:1','PKG:2']);
  assert(mapped.rows.every(item=>item.row['Delivery Status']==='PLANNED'));
  assert(mapped.rows.every(item=>item.row['Provider Status']==='NOT_SENT'));
  assert(mapped.rows.every(item=>item.row['Authorization ID']===''));
  assert(mapped.rows.every(item=>item.row['Provider Receipt Fingerprint']===''));
  assert(mapped.rows.every(item=>item.row['Provider Evidence Kind']===''));
  assert(mapped.rows.every(item=>item.row['Transport Started At']===''));
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  const auth=authorization(a,att,msg);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    message:msg,
    profile:{
      profile:activated.profile,
      profileFingerprint:activated.profileFingerprint
    },
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
  assert.match(mapped.providerReceipt.receiptFingerprint,/^[a-f0-9]{64}$/);
  assert(mapped.rows.every(item=>item.row['Gmail Message ID']==='gmail-message-1'));
  assert(mapped.rows.every(item=>item.row['Delivered At']==='2026-09-21T17:01:00.000Z'));
  assert(mapped.rows.every(item=>item.row['Last Reconciled At']==='2026-09-21T17:03:00.000Z'));
  assert(mapped.rows.every(item=>item.row['Authorization ID']===auth.authorizationId));
  assert(mapped.rows.every(item=>
    item.row['Provider Receipt Fingerprint']===mapped.providerReceipt.receiptFingerprint
  ));
  assert(mapped.rows.every(item=>item.row['Provider Evidence Kind']==='PROVIDER_READBACK'));
  assert(mapped.rows.every(item=>item.row['Transport Started At']==='2026-09-21T17:00:00.000Z'));
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  const auth=authorization(a,att,msg);
  const mapped=mapping.deliveryStateRows({
    artifact:a,
    attempt:att,
    message:msg,
    profile:{
      profile:activated.profile,
      profileFingerprint:activated.profileFingerprint
    },
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
  assert(mapped.rows.every(item=>item.row['Provider Evidence Kind']==='PROVIDER_SEND_RESPONSE'));
  assert(mapped.rows.every(item=>item.row['Transport Started At']==='2026-09-21T17:00:00.000Z'));
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:Object.assign({},att,{recipient:'other@example.com'}),
      profile:{
        profile:activated.profile,
        profileFingerprint:activated.profileFingerprint
      }
    }),
    /ATTEMPT_RECIPIENT_PROFILE_MISMATCH/
  );
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:Object.assign({},att,{planFingerprint:'wrong'}),
      profile:{
        profile:activated.profile,
        profileFingerprint:activated.profileFingerprint
      }
    }),
    /ATTEMPT_ARTIFACT_FINGERPRINT_MISMATCH/
  );
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:att,
      profile:{
        profile:activated.profile,
        profileFingerprint:activated.profileFingerprint
      },
      deliveryStatus:'FINALIZED'
    }),
    /DELIVERY_STATUS_EVIDENCE_CONFLICT/
  );
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  const msg=message(a);
  assert.throws(
    ()=>mapping.deliveryStateRows({
      artifact:a,
      attempt:att,
      message:msg,
      profile:{
        profile:activated.profile,
        profileFingerprint:activated.profileFingerprint
      },
      providerObservation:acceptedObservation(a,att),
      transportStartedAt:'2026-09-21T17:00:00Z',
      reconciledAt:'2026-09-21T17:03:00Z'
    }),
    /TRANSPORT_AUTHORIZATION_REQUIRED/
  );
}

{
  const activated=activationResult();
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
      profile:{
        profile:activated.profile,
        profileFingerprint:activated.profileFingerprint
      },
      providerObservation:bad,
      transportAuthorization:auth,
      transportStartedAt:'2026-09-21T17:00:00Z',
      reconciledAt:'2026-09-21T17:03:00Z'
    }),
    /PROVIDER_EVIDENCE_INVALID:PROVIDER_RECIPIENT_MISMATCH/
  );
}

{
  const activated=activationResult();
  const a=artifact();
  const att=attempt(a);
  const first=mapping.deliveryStateRows({
    artifact:a,attempt:att,
    profile:{
      profile:activated.profile,
      profileFingerprint:activated.profileFingerprint
    }
  });
  const second=mapping.deliveryStateRows({
    artifact:JSON.parse(JSON.stringify(a)),
    attempt:JSON.parse(JSON.stringify(att)),
    profile:{
      profile:JSON.parse(JSON.stringify(activated.profile)),
      profileFingerprint:activated.profileFingerprint
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
  'Preference Receipt ID','Preference Source','Subscription Context Fingerprint',
  'Onboarding Match Fingerprint','Activation Fingerprint'
]);
assert.deepEqual(mapping.DELIVERY_STATE_HEADERS,[
  'Recipient Email','Lead Key','Delivered At','Stripe Customer','Stripe Subscription',
  'Gmail Message ID','Attempt ID','Delivery Status','Message Identity','Artifact Fingerprint',
  'Profile Fingerprint','Delivery Class','Provider Status','Last Reconciled At','Package ID',
  'Authorization ID','Provider Receipt Fingerprint','Provider Evidence Kind','Transport Started At'
]);

console.log('PermitPlate private sheet mapping tests passed.');
