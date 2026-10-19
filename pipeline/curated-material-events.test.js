'use strict';

const assert=require('node:assert/strict');
const material=require('./material-change');
const ledger=require('./curated-research-ledger');
const curated=require('./curated-customer-brief');
const queue=require('./run-curated-review-queue');
const stripe=require('./stripe-subscriber');
const categoryEvidence=require('./category-evidence');

const INIT='2026-10-18T12:00:00.000Z';
const NEXT='2026-10-18T14:00:00.000Z';
const LATER='2026-10-18T15:00:00.000Z';
const REPORT='2026-10-18T16:00:00.000Z';

function candidate(status='FILED',overrides={}) {
  const c={
    entityId:'CAMIS:50110001',camis:'50110001',
    canonicalName:'Example Restaurant',address:'200 Grand Street',
    borough:'Brooklyn',lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-10-17T08:00:00.000Z',
    sourceLatestEffectiveAt:'2026-10-18T08:00:00.000Z',
    deliverySuppressed:false,crossCamisOperationalConflicts:[],
    sourceSystems:['DOHMH','DOB_NOW'],commercialEvidence:[],
    ...overrides
  };
  const source=[
    {system:'DOHMH',key:'DOHMH:50110001',eventType:'DOHMH_APPLICANT_RECORD',
      eventDate:null,details:{inspectionType:'',action:''}},
    {system:'DOB_NOW',key:'DOB_NOW:B12345678-I1',eventType:'DOB_NOW_JOB_FILING',
      eventDate:'2026-10-17',details:{status,scope:'RESTAURANT BUILDOUT',
        cost:125000,workTypes:'',floor:'1'}}
  ];
  c.materiality=material.describe({
    ...c,
    projectSignal:{materialEvidence:source}
  });
  return c;
}
function graph(at,candidates){
  const observations={};
  for(const key of ledger.REQUIRED_SOURCES){
    observations[key]={
      observationId:'OBS:'+key+':'+at,
      observedAt:at,state:'COMPLETE_NONEMPTY',transportOk:true,
      supportsAbsenceConclusion:true,sourceFresh:true,publisherCount:1,fetchedCount:1
    };
  }
  const g={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',graphState:'COMPLETE',
    graphDigest:ledger.hash({at,ids:candidates.map(c=>c.entityId),fingerprints:candidates.map(c=>c.materiality.fingerprint)}),
    observedAt:at,sourceObservations:observations,
    metrics:{candidateCount:candidates.length},
    knownRegressionChecks:{passed:true},passed:true,candidates
  };
  g.artifactFingerprint=ledger.graphFingerprint(g);
  return g;
}
function checkout(){
  const session={
    id:'cs_live_material_test',object:'checkout.session',
    payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',status:'complete',payment_status:'paid',
    customer:'cus_material_test',customer_details:{email:'buyer@example.com'},
    metadata:{project:'permitplate_nyc'},subscription:'sub_material_test',
    custom_fields:[
      {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
      {key:'territory',type:'dropdown',dropdown:{value:'Brooklyn'}},
      {key:'starter',type:'dropdown',dropdown:{value:'no'}}
    ]
  };
  const subscription={
    id:'sub_material_test',created:Date.parse('2026-10-18T13:00:00Z')/1000,
    customer:'cus_material_test',status:'active',
    items:{data:[{price:{id:curated.EXPECTED_PRICE_ID}}]}
  };
  return {session,subscription};
}
function input(g,l,reviews,deliveredSignalKeys=[]){
  return {
    ...checkout(),graph:g,ledger:l,reviews,
    deliveredSignalKeys,reviewer:'OWNER',ownerReviewed:true,preparedAt:REPORT
  };
}
function ownerReview(c,e) {
  return {
    entityId:c.entityId,category:'equipment',
    candidateFingerprint:curated.candidateIdentity(c),
    eventId:e.eventId,eventKind:e.kind,
    ownerReviewed:true,reviewedAt:'2026-10-18T15:30:00Z',
    whyItMatters:'The verified updated construction status merits equipment vendor research.',
    whatChanged:'Official construction filing status changed from FILED to APPROVED.'
  };
}

// The first scan establishes history, not a customer lead.
const before=candidate('FILED');
const first=ledger.advance(null,graph(INIT,[before]));
assert.equal(first.status,'BASELINED');
assert.equal(first.newResearchCount,0);
assert.equal(first.newMaterialEventCount,0);
assert(material.valid(first.ledger.entries[before.entityId].materiality));

// A true source-semantic change on a stable, accepted DOB filing is a
// candidate for HUMAN REVIEW, not an automatically sent lead.
const after=candidate('APPROVED');
const g2=graph(NEXT,[after]);
const second=ledger.advance(first.ledger,g2);
assert.equal(second.status,'ADVANCED');
assert.equal(second.newResearchCount,0);
assert.equal(second.newMaterialEventCount,1);
const event=second.ledger.entries[after.entityId].lastMaterialEvent;
assert.equal(event.kind,'MATERIAL_CHANGE');
assert(event.changeReasons.includes('EVIDENCE_CHANGED'));
assert.equal(event.observedAt,NEXT);
assert(/^MAT:/.test(event.eventId));
assert.equal(ledger.validate(second.ledger).valid,true);

const customerQueue=queue.makeQueue({
  ...checkout(),graph:g2,ledger:second.ledger,
  deliveredSignalKeys:[],preparedAt:REPORT
});
assert.equal(customerQueue.status,'REVIEW_REQUIRED');
assert.equal(customerQueue.candidateCount,1);
assert.equal(customerQueue.reviews[0].eventKind,'MATERIAL_CHANGE');
assert.equal(customerQueue.reviews[0].eventId,event.eventId);
assert.equal(customerQueue.reviews[0].ownerReviewed,false);
assert.equal(customerQueue.reviews[0].preview.changeReasons.includes('EVIDENCE_CHANGED'),true);

const result=curated.prepare(input(g2,second.ledger,[ownerReview(after,event)]));
assert.equal(result.status,'READY_FOR_OWNER_REVIEW');
assert.equal(result.signalCount,1);
assert.equal(result.brief.signals[0].eventKind,'MATERIAL_CHANGE');
assert.equal(result.brief.signals[0].firstObservedAt,NEXT);
assert.match(result.brief.html,/Material change/);
assert.match(result.brief.html,/FILED to APPROVED/);
assert.match(result.brief.csv,/MATERIAL_CHANGE/);
assert.equal(result.transportAllowed,false);
assert(result.transportPreflight.failures.includes('OWNER_AUTHORIZATION_MISSING'));
const duplicate=curated.prepare(input(g2,second.ledger,[ownerReview(after,event)],result.brief.signalKeys));
assert.equal(duplicate.status,'NO_MATCHES_REVIEW');
assert.equal(duplicate.signalCount,0);
assert.equal(queue.makeQueue({
  ...checkout(),graph:g2,ledger:second.ledger,
  deliveredSignalKeys:result.brief.signalKeys,preparedAt:REPORT
}).candidateCount,0);

// A changed semantic descriptor must be treated as a new material event once,
// and the unchanged follow-up must not repeat it.
const replay=ledger.advance(second.ledger,graph(LATER,[after]));
assert.equal(replay.newMaterialEventCount,0);
assert.equal(replay.ledger.entries[after.entityId].lastMaterialEvent.eventId,event.eventId);

// Changing extraction/source-effective time only is not a semantic event.
const refresh=candidate('APPROVED',{sourceLatestEffectiveAt:LATER});
const refreshRun=ledger.advance(second.ledger,graph(LATER,[refresh]));
assert.equal(refreshRun.newMaterialEventCount,0);

// Identity edit, suppression or insufficient evidence are not new leads.
const renamed=candidate('APPROVED',{canonicalName:'A different operator'});
assert.equal(ledger.advance(first.ledger,graph(NEXT,[renamed])).newMaterialEventCount,0);
const suppressed=candidate('APPROVED',{deliverySuppressed:true});
assert.equal(ledger.advance(first.ledger,graph(NEXT,[suppressed])).newMaterialEventCount,0);

// Migration from production v1 entries has no semantic baseline: do not
// backfill fictional changes; the NEXT genuine delta is the first eligible one.
const legacy=JSON.parse(JSON.stringify(first.ledger));
delete legacy.entries[before.entityId].materiality;
const migrated=ledger.advance(ledger.seal(legacy),graph(NEXT,[after]));
assert.equal(migrated.newMaterialEventCount,0);
assert.equal(migrated.ledger.entries[before.entityId].materialityMigrationAt,NEXT);
const changedAfterMigration=ledger.advance(migrated.ledger,graph(LATER,[candidate('CLOSED')]));
assert.equal(changedAfterMigration.newMaterialEventCount,1);

// Invalid payload, mismatched event identity and missing reason all fail closed.
const missing=curated.prepare(input(g2,second.ledger,[ownerReview(after,event)].
  map(x=>({...x,eventId:'MAT:OTHER'}))));
assert.equal(missing.status,'REVIEW');
const noReview=ownerReview(after,event);
delete noReview.whatChanged;
assert.equal(curated.prepare(input(g2,second.ledger,[noReview])).status,'REVIEW');

// Existing baseline entity remains absent from new-observation queue
// without a verified material event.
assert.equal(queue.makeQueue({
  ...checkout(),graph:graph(INIT,[before]),ledger:first.ledger,
  deliveredSignalKeys:[],preparedAt:'2026-10-18T13:00:00Z'
}).candidateCount,0);
console.log('PermitPlate material-change events and paid-brief gate passed.');
