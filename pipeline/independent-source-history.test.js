'use strict';
const assert=require('node:assert/strict');
const h=require('./independent-source-history');
const START='2026-10-19T04:59:48.307Z';
const FOLLOW='2026-10-19T16:00:00.000Z';
const THIRD='2026-10-20T04:59:48.307Z';
function item(id,details={}){
  return {
    sourceSystem:'SLA_PENDING',sourceRecordId:'SLA_PENDING:'+id,
    officialUrl:'https://data.ny.gov/resource/f8i8-k2gm.json?application_id='+id,
    officialSourceObservationId:'OBS:trusted',
    sourceEffectiveAt:'2026-10-17T09:15:00.000Z',
    firstObservedByThisReviewAt:START,borough:'Queens',
    address:'1 SAMPLE ST',matchedResearchTerms:['RESTAURANT'],
    sourceExcerpt:'Restaurant',sourceStatus:'Pending',
    possibleRelatedCamis:[],needsIdentityReview:false,
    reviewStatus:'REVIEW_ONLY_UNLINKED',
    customerDeliveryAllowed:false,
    ...details
  };
}
function reviewed(now,items,omitted=0){
  const receipt={
    version:h.SOURCE_VERSION,status:'REVIEW_ONLY',observedAt:now,
    sourceGraphDigest:'a'.repeat(64),sourceArtifactFingerprint:'b'.repeat(64),
    sourceObservationIds:{DOB_NOW:'OBS:dob',SLA_PENDING:'OBS:sla'},
    totalResearchMatches:items.length+omitted,
    storedCount:items.length,omittedByLimit:omitted,
    sourceCounts:{DOB_NOW:0,SLA_PENDING:items.length+omitted},
    ignored:{oldOrFuture:0,unrelated:0,nonNyc:0,alreadyLinked:0,incomplete:0},
    items,customerDeliveryAllowed:false,externalSendCalls:0,
    notices:['Review-only research']
  };
  return {...receipt,artifactFingerprint:h.hash(receipt)};
}
const historical=reviewed(START,[item('NA-123'),item('NA-124')]);
const base=h.bootstrap(historical);
assert.equal(base.status,'BASELINED');
assert.equal(base.newObservationIds.length,0);
assert.equal(h.validate(base.ledger).valid,true);
const repeated=reviewed(FOLLOW,[item('NA-123',{firstObservedByThisReviewAt:FOLLOW}),
  item('NA-124',{firstObservedByThisReviewAt:FOLLOW})]);
const unchanged=h.advance(base.ledger,repeated);
assert.equal(unchanged.status,'NO_NEW_REVIEW_EVENTS');
assert.deepEqual(unchanged.newObservationIds,[]);
assert.deepEqual(unchanged.contextChangeIds,[]);
assert.equal(unchanged.ledger.entries['SLA_PENDING:NA-123'].firstObservedAt,START);
let shown=h.annotate(repeated,unchanged.ledger,unchanged.newObservationIds,unchanged.contextChangeIds);
assert.equal(shown.items[0].firstObservedByPermitPlateAt,START);
assert.equal(shown.items[0].monitoringStatus,'ALREADY_OBSERVED');
assert.equal(shown.items[0].customerDeliveryAllowed,false);
assert.equal(h.verifyReview(shown).valid,true);

const added=reviewed(THIRD,[item('NA-123'),item('NA-124'),item('NA-125')]);
const next=h.advance(unchanged.ledger,added);
assert.equal(next.status,'ADVANCED');
assert.deepEqual(next.newObservationIds,['SLA_PENDING:NA-125']);
assert.equal(next.contextChangeIds.length,0);
shown=h.annotate(added,next.ledger,next.newObservationIds,next.contextChangeIds);
assert.equal(shown.items[2].monitoringStatus,'NEW_TO_PERMITPLATE');
assert.equal(shown.items[2].firstObservedByPermitPlateAt,THIRD);
assert(!JSON.stringify(shown).includes('purchaseIntent'));
assert.equal(shown.customerDeliveryAllowed,false);

const changedReview=reviewed('2026-10-20T12:00:00.000Z',[
  item('NA-123',{sourceStatus:'Approved'}),
  item('NA-124'),item('NA-125')
]);
const changed=h.advance(next.ledger,changedReview);
assert.deepEqual(changed.newObservationIds,[]);
assert.deepEqual(changed.contextChangeIds,['SLA_PENDING:NA-123']);
assert(/^CTX:/.test(changed.ledger.entries['SLA_PENDING:NA-123'].latestContextChange.eventId));
const again=h.advance(changed.ledger,reviewed('2026-10-20T13:00:00.000Z',[
  item('NA-123',{sourceStatus:'Approved'}),item('NA-124'),item('NA-125')
]));
assert.equal(again.contextChangeIds.length,0);
assert.equal(again.ledger.entries['SLA_PENDING:NA-123'].firstObservedAt,START);

const tampered=structuredClone(again.ledger);
tampered.entries['SLA_PENDING:NA-123'].firstObservedAt=THIRD;
assert.equal(h.validate(tampered).valid,false);
const forgedFirst=h.seal(tampered);
assert.equal(h.validate(forgedFirst).valid,true); // hash is tamper evidence, not cryptographic signer
assert.equal(h.advance(again.ledger,reviewed(START,[item('NA-123')])).status,'REVIEW');
const corrupt=structuredClone(repeated);
corrupt.items[0].sourceStatus='Approval invented';
assert(h.verifyReview(corrupt).failures.includes('INDEPENDENT_REVIEW_FINGERPRINT_INVALID'));
const duplicate=reviewed(THIRD,[item('NA-123'),item('NA-123')]);
assert(h.verifyReview(duplicate).failures.includes('INDEPENDENT_REVIEW_ITEM_INVALID'));
assert.equal(h.bootstrap(reviewed(START,[item('NA-123')],1)).status,'REVIEW');
const overflow=reviewed('2026-10-21T12:00:00.000Z',[item('NA-123')],2);
const keep=h.advance(again.ledger,overflow);
assert.equal(keep.ledger.entries['SLA_PENDING:NA-124'].presenceState,'IN_CURRENT_REVIEW');
const complete=reviewed('2026-10-21T13:00:00.000Z',[item('NA-123')]);
const absent=h.advance(keep.ledger,complete);
assert.equal(absent.ledger.entries['SLA_PENDING:NA-124'].presenceState,'OUT_OF_CURRENT_REVIEW_WINDOW');
assert.equal(absent.ledger.entries['SLA_PENDING:NA-124'].firstObservedAt,START);
const returned=h.advance(absent.ledger,reviewed('2026-10-21T14:00:00.000Z',[item('NA-123'),item('NA-124')]));
assert.deepEqual(returned.newObservationIds,[]);
assert.equal(returned.ledger.entries['SLA_PENDING:NA-124'].presenceState,'IN_CURRENT_REVIEW');
console.log('Private independent research history and repeated-scan dedupe passed.');
