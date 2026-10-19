'use strict';

const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const research=require('./curated-research-ledger');
const customer=require('./curated-customer-brief');
const runner=require('./run-curated-research');
const fulfillment=require('./run-curated-fulfillment');
const queueMaker=require('./run-curated-review-queue');
const stripe=require('./stripe-subscriber');
const categoryEvidence=require('./category-evidence');

const OLD_AT='2026-10-16T08:00:00.000Z';
const CURRENT_AT='2026-10-18T10:00:00.000Z';
const PREPARED='2026-10-18T11:00:00.000Z';
const BASELINE='2026-10-18T09:00:00.000Z';

function candidate(camis,overrides={}) {
  return {
    entityId:'CAMIS:'+camis,camis,
    canonicalName:'Sample Restaurant '+camis,
    address:'276 Grand Street',borough:'Brooklyn',
    lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-10-18T08:00:00.000Z',
    sourceLatestEffectiveAt:'2026-10-18T08:00:00.000Z',
    deliverySuppressed:false,
    crossCamisOperationalConflicts:[],
    ...overrides
  };
}
function graph(at, candidates, options={}) {
  const sourceObservations={};
  for (const key of research.REQUIRED_SOURCES) {
    sourceObservations[key]={
      observationId:'OBS:'+key+':'+at,
      observedAt:at,
      state:'COMPLETE_NONEMPTY',
      supportsAbsenceConclusion:true,
      transportOk:true,
      sourceFresh:true,
      publisherCount:3,
      fetchedCount:3
    };
  }
  const result={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',
    observedAt:at,
    graphState:'COMPLETE',
    graphDigest:research.hash({at,ids:candidates.map(c=>c.entityId)}),
    sourceObservations,
    metrics:{candidateCount:candidates.length},
    knownRegressionChecks:{passed:true},
    candidates,
    passed:true,
    ...options
  };
  result.artifactFingerprint=research.graphFingerprint(result);
  return result;
}
function checkout(variant={}) {
  const session={
    id:'cs_live_curated_fixture',
    object:'checkout.session',
    payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',status:'complete',payment_status:'paid',
    customer:'cus_approved_fixture',
    customer_details:{email:'buyer@example.com'},
    subscription:'sub_curated_fixture',
    metadata:{project:'permitplate_nyc'},
    custom_fields:[
      {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
      {key:'territory',type:'dropdown',dropdown:{value:'Brooklyn'}},
      {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
    ]
  };
  const subscription={
    id:'sub_curated_fixture',
    created:Date.parse(BASELINE)/1000,
    customer:'cus_approved_fixture',
    status:'active',
    items:{data:[{price:{id:customer.EXPECTED_PRICE_ID}}]}
  };
  return {session,subscription,...variant};
}
function review(item,overrides={}) {
  return {
    entityId:item.entityId,category:'equipment',
    ownerReviewed:true,
    candidateFingerprint:customer.candidateIdentity(item),
    categoryReview:{
      approved:true,
      evidenceFingerprint:categoryEvidence.classify(item,'Equipment').evidenceFingerprint,
      sourceUrl:categoryEvidence.primaryUrl(item),
      rationale:'The verified restaurant applicant record provides a research starting point for an equipment vendor, without proving equipment demand.'
    },
    whyItMatters:'An official NYC applicant record makes this business worth researching.',
    reviewedAt:'2026-10-18T10:30:00.000Z',
    ...overrides
  };
}
const old=candidate('50193500',{
  sourceFirstEffectiveAt:'2026-10-16T05:00:00.000Z',
  sourceLatestEffectiveAt:'2026-10-17T05:00:00.000Z'
});
const fresh=candidate('50193805');
const g0=graph(OLD_AT,[old]);
const first=research.advance(null,g0);
assert.equal(first.status,'BASELINED');
assert.equal(first.newResearchCount,0);
assert(research.validate(first.ledger).valid);

const g1=graph(CURRENT_AT,[old,fresh]);
const next=research.advance(first.ledger,g1);
assert.equal(next.status,'ADVANCED');
assert.equal(next.newResearchCount,1);
assert.deepEqual(next.newResearchIds,['CAMIS:50193805']);
assert.equal(next.ledger.entries['CAMIS:50193500'].firstObservedAt,OLD_AT);
assert.equal(next.ledger.entries['CAMIS:50193805'].firstObservedAt,CURRENT_AT);

const replay=research.advance(next.ledger,g1);
assert.equal(replay.newResearchCount,0);
assert.equal(replay.ledger.entries['CAMIS:50193805'].firstObservedAt,CURRENT_AT);

const tampered=JSON.parse(JSON.stringify(next.ledger));
tampered.entries['CAMIS:50193805'].firstObservedAt=OLD_AT;
assert.equal(research.validate(tampered).valid,false);
assert.equal(research.advance(tampered,g1).status,'REVIEW');

// The complete source-bound graph receipt must bind every customer-visible
// field, not merely the list of candidate identifiers.
const tamperedName=JSON.parse(JSON.stringify(g1));
tamperedName.candidates[0].canonicalName='REWRITTEN UNVERIFIED NAME';
assert.equal(research.checkGraph(tamperedName).valid,false);
assert(research.checkGraph(tamperedName).failures.includes('CURATED_GRAPH_RECEIPT_INVALID'));
const tamperedAddress=JSON.parse(JSON.stringify(g1));
tamperedAddress.candidates[0].address='UNVERIFIED REPLACEMENT ADDRESS';
assert(research.checkGraph(tamperedAddress).failures.includes('CURATED_GRAPH_RECEIPT_INVALID'));
const backdated=JSON.parse(JSON.stringify(next.ledger));
backdated.entries['CAMIS:50193805'].firstObservedAt='2026-10-15T00:00:00.000Z';
const resealed=research.seal(backdated);
assert(research.validate(resealed).failures.includes('CURATED_LEDGER_ENTRY_TIMELINE_INVALID'));
const brokenGraph=graph(CURRENT_AT,[fresh],{graphState:'PARTIAL',passed:false});
assert.equal(research.advance(next.ledger,brokenGraph).status,'REVIEW');
const absent=graph('2026-10-18T10:30:00.000Z',[old]);
const missing=research.advance(next.ledger,absent);
assert.equal(missing.ledger.entries['CAMIS:50193805'].presenceState,'OUT_OF_CURRENT_WINDOW');
const back=research.advance(missing.ledger,graph('2026-10-18T10:45:00.000Z',[old,fresh]));
assert.equal(back.newResearchCount,0);
const suppressed=graph(CURRENT_AT,[old,candidate('50193806',{deliverySuppressed:true})]);
const held=research.advance(first.ledger,suppressed);
assert.equal(held.newResearchCount,0);
assert.equal(held.heldReviewCount,1);

// Source effective-date refresh is not first-observation proof.
const oldUpdated=candidate('50193500',{sourceLatestEffectiveAt:'2026-10-18T09:00:00.000Z'});
const gRefresh=graph(CURRENT_AT,[oldUpdated,fresh]);
const refreshed=research.advance(first.ledger,gRefresh);
assert.equal(refreshed.ledger.entries['CAMIS:50193500'].firstObservedAt,OLD_AT);

const b0=checkout();
function prepare(options={}) {
  const defaults={
    ...b0,graph:g1,ledger:next.ledger,reviews:[review(fresh)],
    reviewer:'OWNER',ownerReviewed:true,
    deliveredSignalKeys:[],preparedAt:PREPARED
  };
  return customer.prepare({...defaults,...options});
}
const ready=prepare();
assert.equal(ready.status,'READY_FOR_OWNER_REVIEW');
assert.equal(ready.signalCount,1);
assert.equal(ready.transportAllowed,false);
assert.equal(ready.externalSendCalls,0);
assert(ready.transportPreflight.failures.includes('OWNER_AUTHORIZATION_MISSING'));
assert.equal(ready.brief.signals[0].businessName,fresh.canonicalName);
assert.equal(ready.brief.signals[0].section,'NORMAL');
assert.equal(ready.brief.signals[0].categoryEvidenceBasis,'APPLICANT_CONTEXT_ONLY');
assert.match(ready.brief.html,/General restaurant applicant context/);
assert(ready.brief.csv.includes('Category Evidence Basis'));
assert(ready.brief.csv.includes('Category Fit Review'));
assert.equal(ready.brief.signals[0].firstObservedAt,CURRENT_AT);
assert.match(ready.brief.html,/New observation/);
assert.match(ready.brief.csv,/NORMAL/);
assert.match(ready.brief.html,/source record date/i);
assert(ready.brief.signals[0].sourceUrls[0].includes('camis=50193805'));
assert(ready.brief.html.includes('Research starting points'));
assert(ready.brief.html.includes('not purchase intent or guaranteed leads'));
assert(!ready.brief.csv.includes('Purchase Intent'));

// Owner approval is not a category-verification substitute.
const unreviewedFit=review(fresh);
delete unreviewedFit.categoryReview;
assert(prepare({reviews:[unreviewedFit]}).failures.some(f=>f.includes('CATEGORY_FIT_NOT_APPROVED')));
const staleCategory=review(fresh);
staleCategory.categoryReview.evidenceFingerprint='outdated';
assert(prepare({reviews:[staleCategory]}).failures.some(f=>f.includes('CATEGORY_EVIDENCE_STALE')));
const fakeWebsite=review(fresh);
fakeWebsite.categoryReview.sourceUrl='https://example.com/restaurant';
assert(prepare({reviews:[fakeWebsite]}).failures.some(f=>f.includes('CATEGORY_REVIEW_SOURCE_NOT_BOUND')));
const fakeNeed=review(fresh);
fakeNeed.categoryReview.rationale='Guaranteed lead ready to buy kitchen equipment';
assert(prepare({reviews:[fakeNeed]}).failures.some(f=>f.includes('CATEGORY_FIT_CLAIM_UNSUPPORTED')));
const replayDelivery=prepare({deliveredSignalKeys:ready.brief.signalKeys});
assert.equal(replayDelivery.status,'NO_MATCHES_REVIEW');
assert.equal(replayDelivery.signalCount,0);
assert.equal(replayDelivery.attempt.state,'PLANNED');
assert.equal(replayDelivery.transportAllowed,false);

// Initialization-baseline records are never subscriber-new or Starter signals.
const starter=prepare({reviews:[review(old)]});
assert.equal(starter.status,'NO_MATCHES_REVIEW');
assert.equal(starter.signalCount,0);
assert(starter.excluded.some(item=>item.reason==='BASELINE_EXISTING_NOT_A_NEW_OBSERVATION'));
// A verified record first observed on a later source run can be a clearly
// labeled Starter event when the customer subscribes afterward.
const laterCheckout=checkout();
laterCheckout.subscription.created=Date.parse('2026-10-18T10:40:00Z')/1000;
const genuineStarter=prepare({...laterCheckout,reviews:[review(fresh)]});
assert.equal(genuineStarter.status,'READY_FOR_OWNER_REVIEW');
assert.equal(genuineStarter.brief.signals[0].section,'STARTER');
assert.equal(genuineStarter.brief.signals[0].firstObservedAt,CURRENT_AT);
assert.match(genuineStarter.brief.html,/Starter Snapshot/);
assert.match(genuineStarter.brief.csv,/STARTER/);
assert.match(genuineStarter.brief.html,/first observed/i);
const noStarter=checkout();
noStarter.session.custom_fields[2].dropdown.value='no';
assert.equal(prepare({...noStarter,reviews:[review(old)]}).status,'NO_MATCHES_REVIEW');
assert.equal(prepare({reviews:[]}).status,'NO_MATCHES_REVIEW');

assert(prepare({reviews:[review(fresh,{ownerReviewed:false})]}).failures.some(
  f=>f.includes('OWNER_REVIEW_INCOMPLETE')
));
assert(prepare({reviews:[review(fresh,{category:'insurance'})]}).failures.some(
  f=>f.includes('CATEGORY_NOT_SUBSCRIBED')
));
assert(prepare({reviews:[review(fresh,{candidateFingerprint:'bad'})]}).failures.some(
  f=>f.includes('REVIEW_SOURCE_IDENTITY_DRIFT')
));
assert(prepare({reviews:[review(fresh,{reviewedAt:'2026-10-18T09:59:59Z'})]}).failures.some(
  f=>f.includes('REVIEW_TIME_INVALID')
));
assert(prepare({reviews:[review(fresh,{score:100})]}).failures.some(
  f=>f.includes('PROHIBITED_PAID_OFFER_CLAIM')
));
assert(prepare({reviews:[review(fresh),review(fresh)]}).failures.includes(
  'CURATED_DUPLICATE_OR_MISSING_REVIEW_ID'
));
assert(prepare({preparedAt:'2026-10-20T12:00:00Z'}).failures.includes(
  'CURATED_SOURCE_SNAPSHOT_STALE'
));
assert(prepare({graph:graph(CURRENT_AT,[fresh])}).failures.includes(
  'CURATED_LEDGER_GRAPH_MISMATCH'
));
const wrongPrice=checkout();
wrongPrice.subscription.items.data[0].price.id='price_wrong';
assert(prepare(wrongPrice).failures.includes('CUSTOMER_NOT_ACTIVE'));
const otherTerritory=checkout();
otherTerritory.session.custom_fields[1].dropdown.value='Manhattan';
assert(prepare(otherTerritory).failures.some(f=>f.includes('BOROUGH_NOT_SUBSCRIBED')));

const anchor=runner.baselineAnchor(first.ledger);
assert(runner.verifyBaselineAnchor(first.ledger,anchor).valid);
assert(!runner.verifyBaselineAnchor(null,anchor).valid);
assert(!runner.verifyBaselineAnchor(first.ledger,null).valid);
assert(!runner.verifyBaselineAnchor(first.ledger,{...anchor,initializedAt:CURRENT_AT}).valid);
const queue=queueMaker.makeQueue({
  ...b0,graph:g1,ledger:next.ledger,deliveredSignalKeys:[],
  preparedAt:PREPARED,limit:1
});
assert.equal(queue.status,'REVIEW_REQUIRED');
assert.equal(queue.candidateCount,1);
assert.equal(queue.shownCount,1);
assert.equal(queue.notShownCount,0);
assert.equal(queue.reviews[0].entityId,'CAMIS:50193805');
assert.equal(queue.reviews[0].ownerReviewed,false);
assert.equal(queue.reviews[0].categoryReview.approved,false);
assert.equal(queue.reviews[0].preview.categoryEvidenceBasis,'APPLICANT_CONTEXT_ONLY');
assert.equal(queue.categoryEvidenceCounts.APPLICANT_CONTEXT_ONLY,1);
assert.equal(queue.reviews[0].candidateFingerprint,customer.candidateIdentity(fresh));
assert.equal(queue.reviews[0].preview.officialUrl,customer.primaryUrl(fresh));
assert.equal(queueMaker.makeQueue({
  ...b0,graph:g1,ledger:next.ledger,
  deliveredSignalKeys:ready.brief.signalKeys,preparedAt:PREPARED
}).candidateCount,0);
const preview=runner.prepare(first.ledger,g1);
assert.equal(preview.ready,true);
assert.equal(preview.summary.externalSendCalls,0);
assert.equal(preview.summary.newlyObservedResearchCount,1);
assert.equal(runner.prepare(first.ledger,brokenGraph).ready,false);

// Customer information and rendered briefing artifacts are private only.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-curated-tests-'));
try {
  const dir=fulfillment.savePrivate(path.join(temp,'review'),ready);
  assert(fs.existsSync(path.join(dir,'message.html')));
  assert(fs.existsSync(path.join(dir,ready.brief.filename)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'owner-review.json'))).status,
    'OWNER_AUTHORIZATION_MISSING');
  assert.throws(()=>fulfillment.savePrivate(dir,ready),/PRIVATE_OUTPUT_DIRECTORY_NOT_EMPTY/);
  const ledgerFile=path.join(temp,'ledger.json');
  runner.atomicJson(ledgerFile,next.ledger);
  assert.equal(JSON.parse(fs.readFileSync(ledgerFile)).ledgerFingerprint,next.ledger.ledgerFingerprint);
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('Curated source ledger + paid-customer fulfillment regression passed.');
