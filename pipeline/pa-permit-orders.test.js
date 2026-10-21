'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const core=require('./pa-permit-orders');
const poll=require('./pa-permit-stripe');
const runner=require('./run-pa-permit-intake');
const fulfil=require('./pa-permit-fulfillment');
const delivery=require('./pa-permit-delivery-readback');
const workbench=require('./run-pa-permit-workbench');
const recovery=require('./pa-permit-recovery');
const NOW='2026-10-19T14:00:00.000Z',LATER='2026-10-19T15:00:00.000Z';
const PAID='2026-10-19T13:00:00.000Z';
const SESSION='cs_live_pa_research1',INTENT='pi_live_pa_research1';
const project=[
  {key:'municipality',type:'text',text:{value:'Pottsville, Schuylkill County'}},
  {key:'projectaddress',type:'text',text:{value:'101 Main Street, Pottsville, PA'}},
  {key:'projectscope',type:'text',text:{value:'Replace commercial kitchen ventilation and counters'}}
];
const link={
  object:'payment_link',id:core.LINK,active:true,livemode:true,
  metadata:{project:'permitplate_pa',offer:'permit_pack_29',
    source:'direct_payment_link'},
  custom_fields:[
    {key:'municipality',type:'text',optional:false,text:{minimum_length:2,maximum_length:100}},
    {key:'projectaddress',type:'text',optional:false,text:{minimum_length:5,maximum_length:200}},
    {key:'projectscope',type:'text',optional:false,text:{minimum_length:5,maximum_length:255}}
  ]
};
const items={
  object:'list',data:[{quantity:1,amount_subtotal:2900,
    price:{id:core.PRICE,unit_amount:2900,currency:'usd',recurring:null}}],
  has_more:false
};
function session(overrides={}){
  return {
    id:SESSION,object:'checkout.session',livemode:true,mode:'payment',
    payment_link:core.LINK,status:'complete',payment_status:'paid',
    created:Date.parse(PAID)/1000,
    amount_subtotal:2900,amount_total:2900,currency:'usd',
    payment_intent:INTENT,subscription:null,
    customer:'cus_pa_research01',
    customer_details:{email:'buyer@example.org'},
    custom_fields:structuredClone(project),...overrides
  };
}
function snapshot(sessions=[]){
  return {complete:true,sessions,
    lineItemsBySession:Object.fromEntries(sessions.filter(s=>s.payment_status==='paid')
      .map(s=>[s.id,items]))};
}
function fakeProvider(sessions=[],linkInfo=link,priced=items,sessionPrice=items){
  let calls=0;
  const handler=async(url,params)=>{
    assert.equal(params.method,'GET');
    assert.equal(params.redirect,'error');
    assert.equal(params.headers.Authorization,'Bearer rk_live_fixture_secret_12345');
    calls++;
    const u=new URL(url);
    let payload;
    if(u.pathname==='/v1/payment_links/'+core.LINK)payload=linkInfo;
    else if(u.pathname==='/v1/payment_links/'+core.LINK+'/line_items')payload=priced;
    else if(u.pathname==='/v1/checkout/sessions'){
      assert.equal(u.searchParams.get('payment_link'),core.LINK);
      assert.equal(u.searchParams.get('status'),'complete');
      payload={object:'list',has_more:false,data:sessions};
    }else if(u.pathname.endsWith('/line_items')&&u.pathname.startsWith('/v1/checkout/sessions/')){
      payload=sessionPrice;
    }else throw Error('UNEXPECTED_PROVIDER_ENDPOINT');
    return {ok:true,json:async()=>structuredClone(payload)};
  };
  return {handler,count:()=>calls};
}
const first=core.evaluate({...snapshot([session()]),checkedAt:NOW});
assert.equal(first.status,'READY');
for(const providerPaymentStatus of [undefined,null,'pending','unknown','refunded']){
  const unrecognized=core.evaluate({
    ...snapshot([session({payment_status:providerPaymentStatus})]),
    checkedAt:NOW
  });
  assert.equal(unrecognized.status,'REVIEW');
  assert(unrecognized.failures.includes('PA_PROVIDER_PAYMENT_STATUS_INVALID'));
  assert.equal(unrecognized.ledger,undefined);
}
const knownUnpaid=core.evaluate({
  ...snapshot([session({payment_status:'unpaid'})]),checkedAt:NOW
});
assert.equal(knownUnpaid.status,'READY');
assert.equal(knownUnpaid.unpaid,1);
assert.equal(knownUnpaid.totalOrders,0);

assert.equal(first.newOrders,1);
assert.equal(first.heldOrders,0);
assert.equal(first.totalOrders,1);
assert(core.validate(first.ledger).valid);
const order=first.ledger.orders[SESSION];
assert(order.verifiedPayment);
assert.equal(order.amountTotal,2900);
assert.equal(order.phase,'RESEARCH_QUEUE');
assert.equal(order.transportAllowed,false);
assert.equal(order.automaticDeliveryAllowed,false);
assert.deepEqual(order.project,{
  municipality:'Pottsville, Schuylkill County',
  projectAddress:'101 Main Street, Pottsville, PA',
  projectScope:'Replace commercial kitchen ventilation and counters'
});
const origin=core.empty(NOW), anchor=core.anchor(origin);
assert(core.verifyAnchor(first.ledger,anchor));
const fakeAnchor={...anchor,baselineFingerprint:'f'.repeat(64)};
fakeAnchor.anchorFingerprint=core.sha({
  version:fakeAnchor.version,initializedAt:fakeAnchor.initializedAt,
  baselineFingerprint:fakeAnchor.baselineFingerprint
});
assert.equal(core.verifyAnchor(first.ledger,fakeAnchor),false);
assert(core.validate(origin).valid);
const repeated=core.evaluate({...snapshot([session()]),checkedAt:LATER,
  previousLedger:first.ledger});
assert.equal(repeated.status,'READY');
assert.equal(repeated.newOrders,0);
assert.equal(repeated.totalOrders,1);
assert.deepEqual(repeated.ledger.orders[SESSION],order);
const changedStatus=core.evaluate({
  ...snapshot([session({payment_status:'unpaid'})]),
  checkedAt:'2026-10-19T15:01:00.000Z',
  previousLedger:first.ledger
});
assert.equal(changedStatus.status,'READY');
assert.equal(changedStatus.ledger.orders[SESSION].phase,'DELIVERY_RECONCILIATION_HOLD');
assert.equal(changedStatus.ledger.orders[SESSION].verifiedPayment,true);
assert(core.validate(changedStatus.ledger).valid);
const driftReplay=core.evaluate({
  ...snapshot([session({payment_status:'unpaid'})]),
  checkedAt:'2026-10-19T15:02:00.000Z',
  previousLedger:changedStatus.ledger
});
assert.equal(driftReplay.status,'READY');
assert.equal(driftReplay.ledger.orders[SESSION].history.length,
  changedStatus.ledger.orders[SESSION].history.length);
const revivedStatus=core.evaluate({
  ...snapshot([session()]),
  checkedAt:'2026-10-19T15:03:00.000Z',
  previousLedger:changedStatus.ledger
});
assert.equal(revivedStatus.status,'READY');
assert.equal(revivedStatus.ledger.orders[SESSION].phase,
  'DELIVERY_RECONCILIATION_HOLD');
const replacedPaymentIntent=core.evaluate({
  ...snapshot([session({payment_status:'unpaid',
    payment_intent:'pi_different_payment_123'})]),
  checkedAt:'2026-10-19T15:01:00.000Z',
  previousLedger:first.ledger
});
assert.equal(replacedPaymentIntent.status,'REVIEW');
assert(replacedPaymentIntent.failures.includes('PA_PREVIOUS_PAID_PAYMENT_ID_CHANGED'));
const second=session({id:'cs_live_pa_research2',payment_intent:'pi_live_pa_research2',
  created:Date.parse('2026-10-19T13:05:00Z')/1000});
const duplicates=core.evaluate({...snapshot([session(),second]),checkedAt:LATER,
  previousLedger:first.ledger});
assert.equal(duplicates.status,'READY');
assert.equal(duplicates.totalOrders,2);
assert.equal(duplicates.ledger.orders[second.id].phase,'HOLD_POSSIBLE_DUPLICATE');
assert.equal(duplicates.ledger.orders[second.id].verifiedPayment,true);
assert(core.validate(duplicates.ledger).valid);
const incomplete=session({custom_fields:project.map(x=>
  x.key==='municipality'?{...x,text:{value:'Pottsville'}}:x)});
const hold=core.evaluate({...snapshot([incomplete]),checkedAt:NOW});
assert.equal(hold.status,'READY');
assert.equal(hold.ledger.orders[SESSION].phase,'HOLD_PROJECT_DETAILS');
assert(core.validate(hold.ledger).valid);
const corrupt=session({custom_fields:project.map(x=>
  x.key==='projectscope'?{...x,text:{value:'<script>malicious</script>'}}:x)});
const heldUnsafe=core.evaluate({...snapshot([corrupt]),checkedAt:NOW});
assert.equal(heldUnsafe.ledger.orders[SESSION].phase,'HOLD_PROJECT_DETAILS');
assert.equal(heldUnsafe.ledger.orders[SESSION].project,null);
assert(core.validate(heldUnsafe.ledger).valid);
for(const override of [
  {livemode:false},{amount_subtotal:1800},{amount_total:1},
  {payment_intent:null},{mode:'subscription'},{currency:'eur'},
  {customer_details:{email:'recipient\nbcc@example.com'}},
  {subscription:'sub_wrong'},{created:0},
  {payment_status:'paid',status:'expired'}
]){
  const x=core.evaluate({...snapshot([session(override)]),checkedAt:NOW});
  assert.equal(x.status,'REVIEW');
}
assert.equal(core.evaluate({...snapshot([session()]),checkedAt:LATER,
  previousLedger:core.seal({...first.ledger,
    checkedAt:'2026-10-21T20:00:00.000Z'})}).status,'REVIEW');
assert.equal(core.evaluate({...snapshot([]),checkedAt:LATER,
  previousLedger:first.ledger}).status,'REVIEW');
assert.equal(core.evaluate({...snapshot([session({custom_fields:[]})]),checkedAt:NOW}).status,'READY');
assert.equal(core.evaluate({...snapshot([session({custom_fields:[]})]),checkedAt:NOW})
  .ledger.orders[SESSION].phase,'HOLD_PROJECT_DETAILS');
const tampered=structuredClone(first.ledger);
tampered.orders[SESSION].project.projectScope='another scope';
assert(core.validate(tampered).failures.includes('PA_LEDGER_FINGERPRINT_INVALID'));
assert.equal(core.evaluate({...snapshot([session({custom_fields:project.map(x=>
  x.key==='projectscope'?{...x,text:{value:'Different scope'}}:x)})]),
  checkedAt:LATER,previousLedger:first.ledger}).status,'REVIEW');
assert.equal(core.evaluate({...snapshot([session(),session()]),checkedAt:NOW}).status,'REVIEW');
assert.equal(core.evaluate({...snapshot([session(),second]),checkedAt:NOW})
  .ledger.orders[second.id].phase,'HOLD_POSSIBLE_DUPLICATE');
assert.equal(core.verifiedLineItems({...items,has_more:true}),false);
assert.equal(core.verifiedLineItems({...items,data:[]}),false);
assert.equal(core.verifiedLineItems({...items,data:[...items.data,...items.data]}),false);
assert.equal(core.verifiedLineItems({...items,data:[{...items.data[0],
  price:{...items.data[0].price,id:'price_wrong'}}]}),false);
assert.equal(core.verifiedLineItems({...items,data:[{...items.data[0],quantity:2}]}),false);
assert.equal(core.verifiedLineItems(items),true);
assert(poll.linkFields(link.custom_fields));
assert(poll.priceItems(items));
for(const fields of [
  link.custom_fields.slice(0,2),
  [...link.custom_fields,link.custom_fields[0]],
  link.custom_fields.map(x=>x.key==='municipality'?{...x,optional:true}:x),
  link.custom_fields.map(x=>x.key==='projectscope'?{...x,
    text:{minimum_length:0,maximum_length:255}}:x)
]){
  assert.equal(poll.linkFields(fields),false);
}
const research={
  researcherId:'research-reviewer-one',
  preparedAt:'2026-10-19T14:10:00.000Z',
  projectSummary:'A requested kitchen remodel requires independent local permitting review.',
  jurisdiction:'Pottsville and Schuylkill County local building authority',
  authorityName:'Local municipal permitting office to confirm current responsibility',
  publicFeeNotes:'The applicable fee schedule requires verification with the office.',
  sources:[
    {sourceId:'PA-DLI-UCC-PAGE',url:'https://www.pa.gov/agencies/dli.html',
      claim:'State UCC administration may be local, subject to current agency records.',
      observedAt:'2026-10-19T14:01:00.000Z',verifiedByHuman:true},
    {sourceId:'PA-MUNICIPAL-CONTACT',url:'https://www.pa.gov/agencies/dli/resources.html',
      claim:'Check current municipal contacts, authority and applicability before filing.',
      observedAt:'2026-10-19T14:02:00.000Z',verifiedByHuman:true}
  ],
  filingSteps:[
    {action:'Contact the relevant authority about project classification and forms.',
      sourceUrl:'https://www.pa.gov/agencies/dli.html'},
    {action:'Independently verify any applicable permit fee and submittal steps.',
      sourceUrl:'https://www.pa.gov/agencies/dli/resources.html'}
  ],
  unresolvedQuestions:['Confirm whether kitchen hood changes require specialized approvals.'],
  claimsGovernmentApproval:false,claimsLegalAdvice:false,
  claimsNoFurtherVerification:false
};
assert.deepEqual(fulfil.researchErrors(research,PAID),[]);
// Test first: do not accept a source observation recorded AFTER the
// researcher claims their packet was prepared (including future dates).
const impossibleSource={
  ...research,
  sources:research.sources.map((source,index)=>index===0?
    {...source,observedAt:'2026-10-20T14:01:00.000Z'}:source)
};
assert(fulfil.researchErrors(impossibleSource,PAID)
  .includes('PA_RESEARCH_SOURCE_AFTER_PREPARATION'));
const impossibleResearch=fulfil.submitResearch({
  ledger:first.ledger,anchor,sessionId:SESSION,research:impossibleSource,
  now:'2026-10-19T14:20:00.000Z'
});
assert.equal(impossibleResearch.status,'REVIEW');
assert(impossibleResearch.failures.includes('PA_RESEARCH_SOURCE_AFTER_PREPARATION'));
assert.equal(impossibleResearch.ledger,undefined);
assert(fulfil.govUrl('https://www.pa.gov/agencies/dli.html'));
assert(!fulfil.validUrl('http://localhost/secret'));
assert(!fulfil.validUrl('https://127.0.0.1/password'));
assert(!fulfil.validUrl('https://user:pass@www.pa.gov/'));
assert(fulfil.researchErrors({...research,sources:[]},PAID)
  .includes('PA_RESEARCH_SOURCES_INCOMPLETE'));
assert(fulfil.researchErrors({...research,claimsGovernmentApproval:true},PAID)
  .includes('PA_FORBIDDEN_SERVICE_CLAIM'));
assert.equal(fulfil.submitResearch({
  ledger:first.ledger,anchor,sessionId:SESSION,research,
  now:'2026-10-19T14:05:00.000Z'
}).status,'REVIEW');
const researchRecorded=fulfil.submitResearch({
  ledger:first.ledger,anchor,sessionId:SESSION,research,now:'2026-10-19T14:20:00.000Z'
});
assert.equal(researchRecorded.status,'RESEARCH_RECORDED_NO_SEND');
assert.equal(researchRecorded.ledger.orders[SESSION].phase,'RESEARCH_SUBMITTED');
assert.equal(fulfil.submitResearch({
  ledger:researchRecorded.ledger,anchor,sessionId:SESSION,research,
  now:'2026-10-19T14:20:00.000Z'
}).status,'UNCHANGED');
const review={
  reviewerId:'qc-other-human',reviewedAt:'2026-10-19T14:22:00.000Z',
  expectedResearchFingerprint:core.sha(research),
  limitations:'This is general public-record guidance, not legal or government approval.',
  sourceUrlsIndependentlyChecked:true,projectAddressIndependentlyChecked:true,
  authorityJurisdictionConfirmed:true,restrictionsAcknowledged:true,approve:true
};
assert.equal(fulfil.qc({
  ledger:researchRecorded.ledger,anchor,sessionId:SESSION,
  review:{...review,reviewerId:research.researcherId},
  now:'2026-10-19T14:23:00.000Z'
}).status,'REVIEW');
assert.equal(fulfil.qc({
  ledger:researchRecorded.ledger,anchor,sessionId:SESSION,
  review:{...review,reviewedAt:'2026-10-19T14:30:00.000Z'},
  now:'2026-10-19T14:23:00.000Z'
}).status,'REVIEW');
const checked=fulfil.qc({
  ledger:researchRecorded.ledger,anchor,sessionId:SESSION,
  review,now:'2026-10-19T14:23:00.000Z'
});
assert.equal(checked.status,'QC_ATTESTED_MANUAL_SEND_ONLY');
assert.equal(checked.independentReviewerAuthenticationProven,false);
assert.equal(checked.ledger.orders[SESSION].phase,'READY_FOR_MANUAL_DELIVERY');
const md=fulfil.reportDraft(checked.ledger.orders[SESSION]);
assert(md.includes('Not a government permit decision'));
assert(!md.includes('guarantee of approval'));
assert(fulfil.reportDraft(checked.ledger.orders[SESSION]).length>500);
const declared={
  provider:'RESEND',messageId:'123e4567-e89b-12d3-a456-426614174000',
  sentAt:'2026-10-19T14:25:00.000Z',recipient:order.email,
  expectedResearchFingerprint:core.sha(research),
  expectedReportFingerprint:core.sha(md),
  sentSubject:'PA Permit Pack | Public-Source Research',
  expectedSender:'PermitPlate <research@example.org>',
  ownerManuallyAuthorized:true
};
assert.equal(fulfil.recordSendReceipt({
  ledger:checked.ledger,anchor,sessionId:SESSION,
  receipt:{...declared,sentAt:'2026-10-19T14:27:00.000Z'},
  now:'2026-10-19T14:26:00.000Z'
}).status,'REVIEW');
assert.equal(fulfil.recordSendReceipt({
  ledger:checked.ledger,anchor,sessionId:SESSION,
  receipt:{...declared,expectedSender:'injected\\nX-Header: bad'},
  now:'2026-10-19T14:26:00.000Z'
}).status,'REVIEW');
const receipt=fulfil.recordSendReceipt({
  ledger:checked.ledger,anchor,sessionId:SESSION,
  receipt:declared,now:'2026-10-19T14:26:00.000Z'
});
assert.equal(receipt.status,'PROVIDER_READBACK_REQUIRED');
assert.equal(receipt.ledger.orders[SESSION].delivery.sender,declared.expectedSender);
assert.equal(receipt.ledger.orders[SESSION].phase,'PROVIDER_DELIVERY_PENDING');
assert.equal(receipt.ledger.orders[SESSION].delivery.verification,'PENDING_PROVIDER_READBACK');
assert.equal(fulfil.verifiedDelivery({
  ledger:receipt.ledger,anchor,sessionId:SESSION,
  providerResponse:{id:declared.messageId,to:[order.email],last_event:'bounced',
    created_at:'2026-10-19T14:25:00.000Z',subject:declared.sentSubject,
    from:declared.expectedSender,text:md},
  now:'2026-10-19T14:28:00.000Z'
}).status,'REVIEW');
assert.equal(fulfil.verifiedDelivery({
  ledger:receipt.ledger,anchor,sessionId:SESSION,
  providerResponse:{id:declared.messageId,to:[order.email],last_event:'delivered',
    created_at:'2026-10-19T14:26:00.000Z',subject:declared.sentSubject,
    from:declared.expectedSender,
    text:'A different message not matching the approved report'},
  now:'2026-10-19T14:28:00.000Z'
}).status,'REVIEW');
assert.equal(fulfil.providerCreatedAt('2026-10-19 14:24:59.994981+00'),
  '2026-10-19T14:24:59.994Z');
assert.equal(fulfil.providerCreatedAt('2026-10-19T14:24:59.994981+00:00'),
  '2026-10-19T14:24:59.994Z');
assert.equal(fulfil.providerCreatedAt('2026-10-19T14:24:59.994981Z'),
  '2026-10-19T14:24:59.994Z');
assert.equal(fulfil.providerCreatedAt('2026-10-19T14:24:59.994Z'),
  '2026-10-19T14:24:59.994Z');
assert.equal(fulfil.providerCreatedAt('2026-10-19T14:24:59'),null);
assert.equal(fulfil.providerCreatedAt('2026-10-19T14:24:59+25:00'),null);
assert.equal(fulfil.providerCreatedAt('not a provider timestamp'),null);
assert(fulfil.expectedSender('PermitPlate <research@example.org>'));
assert(!fulfil.expectedSender('bad\\nX-Injected: yes'));
const providerBase={
  id:declared.messageId,to:[order.email],from:declared.expectedSender,
  last_event:'delivered',created_at:'2026-10-19 14:24:59.994981+00',
  subject:declared.sentSubject,text:md,html:null,cc:[],bcc:[]
};
const verifyWith=providerResponse=>fulfil.verifiedDelivery({
  ledger:receipt.ledger,anchor,sessionId:SESSION,
  providerResponse,now:'2026-10-19T14:28:00.000Z'
});
assert.equal(verifyWith(providerBase).status,'DELIVERED_PROVIDER_VERIFIED');
assert.equal(verifyWith({...providerBase,last_event:'opened'}).status,
  'DELIVERED_PROVIDER_VERIFIED');
assert.equal(verifyWith({...providerBase,last_event:'clicked'}).status,
  'DELIVERED_PROVIDER_VERIFIED');
for(const bad of [
  {...providerBase,last_event:'sent'},
  {...providerBase,last_event:'bounced'},
  {...providerBase,last_event:'complained'},
  {...providerBase,from:'Wrong Sender <wrong@example.org>'},
  {...providerBase,to:[order.email,'another@example.org']},
  {...providerBase,bcc:['hidden@example.org']},
  {...providerBase,html:'<p>Different material</p>'},
  {...providerBase,created_at:'2026-10-19 12:10:00.000000+00'},
  {...providerBase,created_at:'2026-10-19 15:25:00.000000+00'},
  {...providerBase,created_at:'2026-10-19T14:25:00'},
  {...providerBase,subject:'PA permit spoofed subject'},
  {...providerBase,text:md+'This changes the contract.'}
]){
  assert.equal(verifyWith(bad).status,'REVIEW');
}
const verified=fulfil.verifiedDelivery({
  ledger:receipt.ledger,anchor,sessionId:SESSION,
  providerResponse:{id:declared.messageId,to:[order.email],last_event:'delivered',
    created_at:'2026-10-19T14:26:00.000Z',subject:declared.sentSubject,
    from:declared.expectedSender,text:md},
  now:'2026-10-19T14:28:00.000Z'
});
assert.equal(verified.status,'DELIVERED_PROVIDER_VERIFIED');
assert.equal(verified.ledger.orders[SESSION].transportAllowed,false);
assert(core.validate(verified.ledger).valid);
assert.equal(core.evaluate({...snapshot([session()]),checkedAt:'2026-10-19T15:10:00.000Z',
  previousLedger:verified.ledger}).ledger.orders[SESSION].phase,'DELIVERED_PROVIDER_VERIFIED');
assert.throws(()=>fulfil.recordSendReceipt({
  ledger:verified.ledger,anchor,sessionId:SESSION,
  receipt:declared,now:'2026-10-19T16:00:00.000Z'
}),/PA_SEND_RECEIPT_CASE_NOT_READY/);
assert.deepEqual(workbench.renderQueue(verified.ledger).phases,
  {DELIVERED_PROVIDER_VERIFIED:1});
assert(workbench.createDraft(order).neverAutoSend);
const fakeGet=fakeProvider([session()]);
const recoveryStatus=recovery.plan(first.ledger,anchor,LATER);
assert.equal(recoveryStatus.totalPaidOrders,1);
assert.equal(recoveryStatus.providerReadbackStale,false);
assert.equal(recoveryStatus.automaticResendAllowed,false);
assert.equal(recoveryStatus.automaticRefundAllowed,false);
const holdRejected=recovery.resolveHold({
  ledger:hold.ledger,anchor,sessionId:SESSION,
  now:LATER,evidence:{operatorId:'operator1',reviewedAt:'2026-10-19T14:12:00.000Z'}
});
assert.equal(holdRejected.status,'REVIEW');
const correctedProject={
  municipality:'Pottsville, Schuylkill County',
  projectAddress:'101 Main Street, Pottsville, PA',
  projectScope:'Replace restaurant hood and associated ventilation'
};
const clarification={
  operatorId:'operator1',reviewedAt:'2026-10-19T14:12:00.000Z',
  supportEvidenceReference:'Verified customer support conversation 2026-10-19',
  originalCustomerEvidenceInspected:true,ownerAttestation:true,
  projectOverride:correctedProject
};
const recovered=recovery.resolveHold({
  ledger:hold.ledger,anchor,sessionId:SESSION,
  now:LATER,evidence:clarification
});
assert.equal(recovered.status,'RESEARCH_QUEUE_AFTER_MANUAL_ATTESTATION');
assert.equal(recovered.independentCustomerVerificationProven,false);
assert.equal(recovered.ledger.orders[SESSION].phase,'RESEARCH_QUEUE');
assert.equal(recovered.ledger.orders[SESSION].project.municipality,'Pottsville');
assert.equal(recovered.ledger.orders[SESSION].projectOverride.municipality,correctedProject.municipality);
assert(core.validate(recovered.ledger).valid);
const duplicateHold=recovery.resolveHold({
  ledger:duplicates.ledger,anchor,sessionId:second.id,now:LATER,
  evidence:clarification
});
assert.equal(duplicateHold.status,'REVIEW');
const separate=recovery.resolveHold({
  ledger:duplicates.ledger,anchor,sessionId:second.id,now:LATER,
  evidence:{...clarification,separatePurchaseConfirmedByCustomer:true}
});
assert.equal(separate.status,'RESEARCH_QUEUE_AFTER_MANUAL_ATTESTATION');
assert.equal(separate.ledger.orders[second.id].phase,'RESEARCH_QUEUE');
assert.equal(separate.ledger.orders[second.id].transportAllowed,false);

async function main(){
  const emptyProvider=fakeProvider([]);
  const checkedLink=await poll.verifyLink('rk_live_fixture_secret_12345',emptyProvider.handler);
  assert.equal(checkedLink.providerVerified,true);
  const scan=await poll.snapshot('rk_live_fixture_secret_12345',fakeGet.handler);
  assert.equal(scan.paidSessionCount,1);
  assert.equal(scan.sessions.length,1);
  assert.equal(scan.complete,true);
  assert.equal(core.evaluate({...scan,checkedAt:NOW}).status,'READY');
  assert.equal(fakeGet.count(),4);
  for(const [bad,reason] of [
    [{...link,active:false},'PA_STRIPE_PAYMENT_LINK_CONTRACT_INVALID'],
    [{...link,custom_fields:[]},'PA_STRIPE_PAYMENT_LINK_CONTRACT_INVALID']
  ]){
    await assert.rejects(poll.snapshot('rk_live_fixture_secret_12345',
      fakeProvider([],bad).handler),new RegExp(reason));
  }
  await assert.rejects(poll.snapshot('rk_live_fixture_secret_12345',
    fakeProvider([] ,link,{...items,has_more:true}).handler),
    /PA_STRIPE_PAYMENT_LINK_PRICE_DRIFT/);
  await assert.rejects(poll.snapshot('rk_live_fixture_secret_12345',
    fakeProvider([session()],link,items,{...items,data:[]}).handler),
    /PA_STRIPE_PAID_LINE_ITEM_INVALID/);
  await assert.rejects(poll.snapshot('rk_live_fixture_secret_12345',
    fakeProvider([session(),session()]).handler),
    /PA_STRIPE_PROVIDER_SESSION_INVALID/);
  await assert.rejects(poll.snapshot('sk_live_wrong',fakeGet.handler),
    /PA_STRIPE_RESTRICTED_LIVE_CREDENTIAL_REQUIRED/);
  await assert.rejects(poll.get('https://not-stripe.example/v1/checkout/sessions',
      'rk_live_fixture_secret_12345',fakeGet.handler),/PA_STRIPE_ENDPOINT_NOT_ALLOWED/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-pa-safety-'));
  try{
    const ledgerFile=path.join(dir,'pa-orders.json');
    const anchorFile=path.join(dir,'pa-anchor.json');
    const firstRun=await runner.run({
      key:'rk_live_fixture_secret_12345',fetchImpl:fakeProvider([]).handler,
      ledgerPath:ledgerFile,anchorPath:anchorFile,now:NOW
    });
    assert.equal(firstRun.ready,true);
    assert.equal(firstRun.totalOrders,0);
    assert.equal(firstRun.externalSendCalls,0);
    const oldLedger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    const oldAnchor=JSON.parse(fs.readFileSync(anchorFile,'utf8'));
    assert(runner.priorHealth(oldLedger,oldAnchor).valid);
    const newRun=await runner.run({
      key:'rk_live_fixture_secret_12345',fetchImpl:fakeProvider([session()]).handler,
      ledgerPath:ledgerFile,anchorPath:anchorFile,now:LATER
    });
    assert.equal(newRun.ready,true);
    assert.equal(newRun.newOrders,1);
    assert(!JSON.stringify(newRun).includes('buyer@example.org'));
    const repeat=await runner.run({
      key:'rk_live_fixture_secret_12345',fetchImpl:fakeProvider([session()]).handler,
      ledgerPath:ledgerFile,anchorPath:anchorFile,
      now:'2026-10-19T16:00:00.000Z'
    });
    assert.equal(repeat.newOrders,0);
    assert.equal(repeat.totalOrders,1);
    assert.equal(runner.priorHealth(null,oldAnchor).valid,false);
    assert.equal(runner.priorHealth(oldLedger,null).valid,false);
    assert.throws(()=>fulfil.submitResearch({
      ledger:verified.ledger,anchor,sessionId:SESSION,research,
      now:'2026-10-19T18:00:00.000Z'
    }),/PA_RESEARCH_CASE_NOT_ELIGIBLE/);
    const readback={
      id:declared.messageId,to:[order.email],last_event:'delivered',
      created_at:'2026-10-19T14:26:00.000Z',subject:declared.sentSubject,
      from:declared.expectedSender,text:md
    };
    const get=async(url,opts)=>{
      assert.equal(opts.method,'GET');
      assert(url.startsWith('https://api.resend.com/emails/'));
      return {ok:true,json:async()=>readback};
    };
    const result=await delivery.verify({
      ledger:receipt.ledger,anchor,sessionId:SESSION,
      now:'2026-10-19T14:28:00.000Z',
      key:'re_unit_test_read_token_12345',fetchImpl:get
    });
    assert.equal(result.status,'DELIVERED_PROVIDER_VERIFIED');
    await assert.rejects(delivery.verify({
      ledger:receipt.ledger,anchor,sessionId:SESSION,
      now:'2026-10-19T14:28:00.000Z',
      key:'missing',fetchImpl:get
    }),/PA_DELIVERY_PROVIDER_READ_KEY_REQUIRED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
  console.log('PA Permit Pack: Stripe contract, paid intake, private QA, delivery readback, recovery and dedupe checks passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
