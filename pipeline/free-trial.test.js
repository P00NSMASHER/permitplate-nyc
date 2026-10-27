'use strict';
// Synthetic customer/provider fixtures only. No real owner approval or delivery.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const trials=require('./free-trial');
const customer=require('./curated-customer-brief');
const research=require('./curated-research-ledger');
const category=require('./category-evidence');
const transport=require('./transport-authorization');
const cli=require('./run-free-trial');

const REQUESTED='2026-10-27T08:00:00.000Z',APPROVED='2026-10-27T09:00:00.000Z';
const OBSERVED='2026-10-27T10:00:00.000Z',PREPARED='2026-10-27T11:00:00.000Z';
function enrollment(environment='TEST'){
  return trials.enroll(trials.createRegistry(environment),{
    businessName:'Fixture Vendor',businessDomain:'www.fixture.example.com',recipientEmail:'buyer@example.com',
    category:'equipment',territory:'Brooklyn',requestedAt:REQUESTED
  },{ownerApproved:true,reference:'SYNTHETIC_OWNER_SCOPE_FIXTURE',approvedAt:APPROVED});
}
function candidate(id){return {
  entityId:'CAMIS:'+id,camis:id,canonicalName:'Synthetic Restaurant '+id,
  address:'10 TEST STREET',borough:'Brooklyn',lifecycleStage:'JUST FILED',
  sourceFirstEffectiveAt:OBSERVED,sourceLatestEffectiveAt:OBSERVED,
  deliverySuppressed:false,crossCamisOperationalConflicts:[]
};}
function graph(at,candidates){
  const sourceObservations=Object.fromEntries(research.REQUIRED_SOURCES.map(key=>[key,{
    observationId:'OBS:FIXTURE:'+key+':'+at,observedAt:at,state:'COMPLETE_NONEMPTY',
    supportsAbsenceConclusion:true,transportOk:true,sourceFresh:true,publisherCount:3,fetchedCount:3
  }]));
  const result={runnerVersion:'PermitPlate-current-graph-v1.0.0',observedAt:at,graphState:'COMPLETE',
    graphDigest:research.hash({at,ids:candidates.map(c=>c.entityId)}),sourceObservations,
    metrics:{candidateCount:candidates.length},knownRegressionChecks:{passed:true},candidates,passed:true};
  result.artifactFingerprint=research.graphFingerprint(result);return result;
}
function fixture(enrolled=enrollment(),count=1){
  const baseline=candidate('50000000');
  const fresh=Array.from({length:count},(_,i)=>candidate(String(50000001+i)));
  const initial=research.advance(null,graph('2026-10-25T10:00:00.000Z',[baseline]));
  const current=graph(OBSERVED,[baseline,...fresh]);
  const next=research.advance(initial.ledger,current);
  const reviews=fresh.map(item=>({entityId:item.entityId,category:'equipment',ownerReviewed:true,
    candidateFingerprint:customer.candidateIdentity(item),reviewedAt:'2026-10-27T10:30:00.000Z',
    categoryReview:{approved:true,evidenceFingerprint:category.classify(item,'Equipment').evidenceFingerprint,
      sourceUrl:category.primaryUrl(item),rationale:'Synthetic applicant context for testing evidence-bound research; no equipment need is established.'},
    whyItMatters:'Synthetic official-record fixture used to exercise the research workflow.'}));
  return {...enrolled,input:{trialRegistry:enrolled.registry,trialId:enrolled.trialId,
    graph:current,ledger:next.ledger,reviews,reviewEnvironment:'TEST',simulationOnly:true,
    reviewer:'SYNTHETIC_OWNER_FIXTURE',ownerReviewed:true,preparedAt:PREPARED}};
}
function evidence(prepared){
  const at=minutes=>new Date(Date.parse(prepared.brief.preparedAt)+minutes*60000).toISOString();
  const approval=transport.buildAuthorizationReceipt({approved:true,authorizationType:'OWNER_EXPLICIT_SEND',
    approvalSource:'TEST_ONLY',approvalNonce:'TEST_ONLY_NONCE',approvedAt:at(0),
    expiresAt:at(30),attemptId:prepared.attempt.attemptId,
    messageIdentity:prepared.attempt.messageIdentity,artifactFingerprint:prepared.brief.artifactFingerprint,
    messageFingerprint:prepared.brief.messageFingerprint,recipient:prepared.brief.recipientEmail,
    signalKeys:prepared.brief.signalKeys});
  return {transportAuthorization:approval,transportStartedAt:at(1),
    reconciledAt:at(3),providerObservation:{status:'ACCEPTED',
      evidenceKind:'PROVIDER_READBACK',attemptId:prepared.attempt.attemptId,
      messageIdentity:prepared.attempt.messageIdentity,recipient:prepared.brief.recipientEmail,
      artifactFingerprint:prepared.brief.artifactFingerprint,providerMessageId:'TEST_PROVIDER_1',
      acceptedAt:at(2),observedAt:at(3)}};
}
const attestation={operatorVerified:true,kind:'TEST_FIXTURE',reference:'SYNTHETIC_PROVIDER_FIXTURE'};

test('free trial admits one reviewed business without fabricating a Stripe subscription',()=>{
  const f=fixture(),ready=customer.prepareTrial(f.input);
  assert.equal(ready.status,'READY_FOR_OWNER_REVIEW');
  assert.equal(ready.signalCount,1);assert.equal(ready.automaticBilling,false);
  assert.equal(ready.paymentRequired,false);assert.equal(ready.externalSendCalls,0);
  assert.equal(ready.transportAllowed,false);
  assert.match(ready.brief.subject,/^\[TEST SIMULATION\]/);
  assert.match(ready.brief.html,/TEST SIMULATION — not a real customer report/);
  assert.match(ready.brief.html,/No card, automatic charge or automatic paid upgrade/);
  assert.match(ready.brief.html,/\$79\/month membership/);
  const access=trials.access(f.registry,f.trialId,PREPARED);
  assert.equal(access.profile.stripeSubscriptionId,null);
  assert.equal(access.profile.priceId,null);assert.equal(access.profile.maxSignals,5);
  assert.equal(access.trialStatus,'WAITING_FIRST_REPORT');
  assert.equal(f.registry.trials[0].firstAcceptedAt,null);
  assert.equal(f.registry.trials[0].expiresAt,null);
  assert.equal(customer.prepare(f.input).status,'REVIEW','free input must not satisfy paid Stripe gate');
});
test('business duplicate checks survive changed email, casing and www aliases',()=>{
  const f=enrollment();
  for(const domain of ['FIXTURE.EXAMPLE.COM','www.fixture.example.com','fixture.example.com.']){
    assert.throws(()=>trials.enroll(f.registry,{businessName:'Other label',businessDomain:domain,
      recipientEmail:'someone-else@example.com',category:'equipment',territory:'Brooklyn',requestedAt:REQUESTED},
    {ownerApproved:true,reference:'FIXTURE',approvedAt:APPROVED}),/TRIAL_BUSINESS_ALREADY_ENROLLED/);
  }
  assert.throws(()=>trials.enroll(f.registry,{businessName:'  fixture   vendor ',businessDomain:'another.example.com',
    recipientEmail:'someone@example.com',category:'equipment',territory:'Brooklyn',requestedAt:REQUESTED},
  {ownerApproved:true,reference:'FIXTURE',approvedAt:APPROVED}),/TRIAL_BUSINESS_ALREADY_ENROLLED/);
});
test('trial report inherits graph, category, freshness, owner-review and five-signal limits',()=>{
  const f=fixture();
  assert.equal(customer.prepareTrial(fixture(enrollment(),6).input).status,'REVIEW');
  for(const override of [{ownerReviewed:false},{preparedAt:'2026-10-29T11:00:00Z'},
    {graph:{...f.input.graph,graphState:'PARTIAL'}},
    {reviews:[{...f.input.reviews[0],categoryReview:null}]},
    {reviews:[{...f.input.reviews[0],candidateFingerprint:'changed'}]}]){
    assert.equal(customer.prepareTrial({...f.input,...override}).status,'REVIEW');
  }
  const noMatches=customer.prepareTrial({...f.input,reviews:[]});
  assert.equal(noMatches.status,'NO_MATCHES_REVIEW');
  assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,noMatches,{},attestation),/NONEMPTY/);
  assert.equal(f.registry.trials[0].firstAcceptedAt,null);
});
test('14-day clock starts at exact authorized provider-accepted nonempty send, not signup or preparation',()=>{
  const f=fixture(),ready=customer.prepareTrial(f.input),ev=evidence(ready);
  assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,ready,{},attestation),/TRIAL_TIME_INVALID/);
  assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,ready,
    {...ev,transportAuthorization:null},attestation),/TRANSPORT_AUTHORIZATION_REQUIRED/);
  const result=trials.recordDelivery(f.registry,f.trialId,ready,ev,attestation);
  assert.equal(result.firstAcceptedAt,'2026-10-27T11:02:00.000Z');
  assert.equal(result.expiresAt,'2026-11-10T11:02:00.000Z');
  assert.equal(result.inboxDeliveryConfirmed,false);
  assert.equal(result.automaticBilling,false);
  assert.throws(()=>trials.access(result.registry,f.trialId,'2026-10-28T11:02:00Z'),/UPDATE_NOT_DUE/);
  assert.equal(trials.access(result.registry,f.trialId,'2026-11-03T11:02:00Z').trialStatus,'ACTIVE');
  assert.throws(()=>trials.access(result.registry,f.trialId,result.expiresAt),/TRIAL_EXPIRED/);
  assert.equal(trials.recordDelivery(result.registry,f.trialId,ready,ev,attestation).status,'ALREADY_RECORDED');
});
test('mismatched recipient, source artifact, chronology and TEST provider proof cannot activate LIVE trials',()=>{
  const f=fixture(),ready=customer.prepareTrial(f.input),ev=evidence(ready);
  for(const mutation of [{recipient:'another@example.com'},{artifactFingerprint:'0'.repeat(64)},
    {acceptedAt:'2026-10-27T10:59:00Z'},{observedAt:'2099-01-01T00:00:00Z'}]){
    assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,ready,
      {...ev,providerObservation:{...ev.providerObservation,...mutation}},attestation));
  }
  const live=fixture(enrollment('LIVE')),liveReady=customer.prepareTrial(live.input);
  assert.equal(liveReady.status,'REVIEW');
  assert(liveReady.failures.includes('TRIAL_SIMULATED_REVIEW_NOT_LIVE'));
  assert.throws(()=>trials.recordDelivery(live.registry,live.trialId,ready,ev,attestation),
    /TRIAL_PROVIDER_PROVENANCE_REQUIRED/);
  const altered=structuredClone(ready);altered.brief.html+='<p>Unreviewed claim</p>';
  // HTML is hashed separately in the accepted artifact; text mutation must fail.
  assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,altered,ev,attestation));
});
test('explicit TEST source and persona markers are rejected before LIVE brief preparation',()=>{
  const live=fixture(enrollment('LIVE'));
  const base={...live.input,reviewEnvironment:undefined,simulationOnly:undefined,reviewer:'Owner'};
  for(const marker of [{reviewEnvironment:'TEST'},{simulationOnly:true},
    {sourceProvenance:{environment:'TEST'}},{graph:{...base.graph,simulationOnly:true}},
    {reviews:base.reviews.map(r=>({...r,reviewEnvironment:'TEST'}))},
    {reviews:base.reviews.map(r=>({...r,categoryReview:{...r.categoryReview,simulationOnly:true}}))},
    {reviewer:'SYNTHETIC_OWNER_FIXTURE'}]){
    const result=customer.prepareTrial({...base,...marker});
    assert.equal(result.status,'REVIEW');
    assert(result.failures.includes('TRIAL_SIMULATED_REVIEW_NOT_LIVE'));
  }
  const testPrepared=customer.prepareTrial(fixture().input);
  assert.equal(testPrepared.reviewEnvironment,'TEST');assert.equal(testPrepared.simulationOnly,true);
});
test('tampered state and cancellation fail closed; source references cannot create a clock',()=>{
  const f=enrollment(),tampered=structuredClone(f.registry);
  tampered.trials[0].expiresAt='2099-01-01T00:00:00.000Z';
  assert.throws(()=>trials.validate(tampered),/FINGERPRINT/);
  const extra=structuredClone(f.registry);extra.claimOfPayment=true;
  assert.throws(()=>trials.validate(extra),/SHAPE/);
  const cancelled=trials.cancel(f.registry,f.trialId,PREPARED);
  assert.throws(()=>trials.access(cancelled,f.trialId,PREPARED),/TRIAL_CANCELLED/);
});
test('first report cannot sit for days before send, and a later bounce holds the trial',()=>{
  const f=fixture(),ready=customer.prepareTrial(f.input),ev=evidence(ready);
  const stale={...ev,transportStartedAt:'2026-10-29T11:01:00.000Z',
    reconciledAt:'2026-10-29T11:03:00.000Z'};
  assert.throws(()=>trials.recordDelivery(f.registry,f.trialId,ready,stale,attestation),/SOURCE_STALE_AT_SEND/);
  const sent=trials.recordDelivery(f.registry,f.trialId,ready,ev,attestation);
  const bounced={...ev,reconciledAt:'2026-10-27T12:01:00.000Z',providerObservation:{
    ...ev.providerObservation,status:'BOUNCED',occurredAt:'2026-10-27T12:00:00.000Z',
    observedAt:'2026-10-27T12:01:00.000Z'}};
  const held=trials.recordDelivery(sent.registry,f.trialId,ready,bounced,attestation);
  assert.equal(held.status,'DELIVERY_HOLD');
  assert.throws(()=>trials.access(held.registry,f.trialId,'2026-11-03T12:00:00Z'),/TRIAL_CANCELLED/);
  assert.throws(()=>trials.recordDelivery(sent.registry,f.trialId,ready,
    {...ev,providerObservation:{...ev.providerObservation,recipient:'wrong@example.com'}},attestation),
  /PROVIDER_RECIPIENT_MISMATCH/);
});
test('weekly update uses fresh evidence and then stops at the two-report limit',()=>{
  const f=fixture(),ready=customer.prepareTrial(f.input);
  const activated=trials.recordDelivery(f.registry,f.trialId,ready,evidence(ready),attestation);
  const fresh=candidate('50000002');
  fresh.sourceFirstEffectiveAt=fresh.sourceLatestEffectiveAt='2026-11-03T12:00:00.000Z';
  const later=graph('2026-11-03T12:00:00.000Z',[...f.input.graph.candidates,fresh]);
  const ledger=research.advance(f.input.ledger,later).ledger;
  const review={...f.input.reviews[0],entityId:fresh.entityId,
    candidateFingerprint:customer.candidateIdentity(fresh),reviewedAt:'2026-11-03T12:30:00.000Z',
    categoryReview:{...f.input.reviews[0].categoryReview,
      evidenceFingerprint:category.classify(fresh,'Equipment').evidenceFingerprint,
      sourceUrl:category.primaryUrl(fresh)}};
  const second=customer.prepareTrial({...f.input,trialRegistry:activated.registry,graph:later,ledger,
    reviews:[review],preparedAt:'2026-11-03T13:00:00.000Z'});
  assert.equal(second.status,'READY_FOR_OWNER_REVIEW');
  assert.notEqual(second.brief.signalKeys[0],ready.brief.signalKeys[0]);
  const secondEvidence=evidence(second);secondEvidence.providerObservation.providerMessageId='TEST_PROVIDER_2';
  const completed=trials.recordDelivery(activated.registry,f.trialId,second,secondEvidence,attestation);
  assert.equal(completed.registry.trials[0].deliveries.length,2);
  assert.equal(completed.expiresAt,activated.expiresAt,'second report must not extend the trial');
  assert.throws(()=>trials.access(completed.registry,f.trialId,'2026-11-04T13:00:00Z'),/REPORT_LIMIT_REACHED/);
});
test('cohort admits at most ten businesses even when old trials are cancelled',()=>{
  let registry=trials.createRegistry();
  for(let i=0;i<10;i++){
    registry=trials.enroll(registry,{businessName:'Fixture '+i,businessDomain:'vendor'+i+'.example.com',
      recipientEmail:'buyer'+i+'@example.com',category:'equipment',territory:'Brooklyn',requestedAt:REQUESTED},
    {ownerApproved:true,reference:'FIXTURE',approvedAt:APPROVED}).registry;
  }
  registry=trials.cancel(registry,registry.trials[0].trialId,PREPARED);
  assert.throws(()=>trials.enroll(registry,{},{}),/OWNER_SCOPE_APPROVAL/);
  assert.throws(()=>trials.enroll(registry,{},
    {ownerApproved:true,reference:'FIXTURE',approvedAt:APPROVED}),/TRIAL_COHORT_FULL/);
});
test('private operator CLI writes no public customer files, never overwrites, and rejects public symlinks',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-trial-test-'));
  try{
    const target=path.join(tmp,'registry.json');
    assert.equal(cli.run({action:'init',environment:'TEST',output:target}).status,'EMPTY_REGISTRY_CREATED');
    assert.throws(()=>cli.run({action:'init',environment:'TEST',output:target}),/EEXIST/);
    assert.throws(()=>cli.run({action:'init',environment:'TEST',output:path.join(__dirname,'public-trial.json')}),
      /PRIVATE_MATERIAL_PATH_REQUIRED/);
    const symlink=path.join(tmp,'public-link');fs.symlinkSync(path.resolve(__dirname,'..'),symlink);
    assert.throws(()=>cli.writeNew(path.join(symlink,'public-trial.json'),{}),/PRIVATE_MATERIAL_PATH_REQUIRED/);
    assert.equal(fs.statSync(target).mode&0o777,0o600);
    const initial=cli.read(target),input=path.join(tmp,'request.json');
    cli.writeNew(input,{request:{businessName:'CLI Fixture',businessDomain:'cli.example.com',
      recipientEmail:'buyer@example.com',category:'equipment',territory:'Brooklyn',requestedAt:REQUESTED},
    approval:{ownerApproved:true,reference:'TEST_ONLY',approvedAt:APPROVED}});
    const options={action:'enroll',registry:target,input,'expected-fingerprint':initial.registryFingerprint};
    assert.equal(cli.run(options).status,'WAITING_FIRST_REPORT');
    assert.throws(()=>cli.run(options),/TRIAL_STALE_REVISION/);
    assert.throws(()=>cli.run({...options,output:path.join(tmp,'fork.json')}),/CANONICAL_REGISTRY/);
    fs.writeFileSync(target+'.lock','');
    assert.throws(()=>cli.run(options),/EEXIST/);fs.unlinkSync(target+'.lock');
    assert.equal(cli.read(target).trials.length,1);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
