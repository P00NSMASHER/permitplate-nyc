'use strict';
const assert=require('node:assert/strict');
const source=require('./source-adapters');
const research=require('./curated-research-ledger');
const review=require('./independent-source-review');
const NOW='2026-10-19T04:00:00.000Z';

const restaurant=source.normalizeDobNowRow({
  job_filing_number:'B00991888-I1',filing_status:'Approved',
  filing_date:'2026-10-15T00:00:00.000',
  house_no:'80',street_name:'WYTHE AVENUE',borough:'Brooklyn',
  building_type:'Commercial',job_description:'INTERIOR ALTERATION OF EXISTING RESTAURANT AND COMMERCIAL KITCHEN',
  owner_s_business_name:'EXAMPLE OWNER LLC'
},{observedAt:NOW});
const residential=source.normalizeDobNowRow({
  job_filing_number:'B00991889-I1',filing_date:'2026-10-15T00:00:00.000',
  house_no:'100',street_name:'RESIDENTIAL ST',borough:'Brooklyn',
  building_type:'1 Family',job_description:'Restaurant kitchen proposed'
},{observedAt:NOW});
const unrelated=source.normalizeDobNowRow({
  job_filing_number:'B00991890-I1',filing_date:'2026-10-15T00:00:00.000',
  house_no:'80',street_name:'SIDE ST',borough:'Brooklyn',
  building_type:'Commercial',job_description:'PLUMBING FOR OFFICE TENANT'
},{observedAt:NOW});
const oldDob=source.normalizeDobNowRow({
  job_filing_number:'B00991891-I1',filing_date:'2025-10-15T00:00:00.000',
  house_no:'80',street_name:'SIDE ST',borough:'Brooklyn',
  building_type:'Commercial',job_description:'NEW RESTAURANT ALTERATION'
},{observedAt:NOW});
const sla=source.normalizeSlaPendingRow({
  application_id:'NA-0240-26-113135',description:'Restaurant',
  legalname:'EXAMPLE RESTAURANT INC',actual_address_of_premises:'4510 46th St',
  premises_county:'Queens',city:'Sunnyside',state_name:'New York',
  zip_code:'11104',status:'Pending',received_date:'2026-10-14T09:00:00.000'
},{observedAt:NOW});
const westchester=source.normalizeSlaPendingRow({
  application_id:'NA-0340-26-127280',description:'Restaurant',
  legalname:'OUTSIDE NYC LLC',actual_address_of_premises:'1 VAN DER DONCK ST',
  premises_county:'Westchester',city:'Yonkers',state_name:'New York',
  status:'Pending',received_date:'2026-10-14T09:00:00.000'
},{observedAt:NOW});
const grocery=source.normalizeSlaPendingRow({
  application_id:'NA-0081-26-127825',description:'Grocery Store',
  actual_address_of_premises:'555 E 180th St',premises_county:'Bronx',
  city:'Bronx',state_name:'New York',received_date:'2026-10-14T09:00:00.000'
},{observedAt:NOW});
const stale=source.normalizeSlaPendingRow({
  application_id:'NA-0240-25-123',description:'Restaurant',
  actual_address_of_premises:'300 MAIN ST',premises_county:'Queens',
  city:'Queens',state_name:'New York',received_date:'2025-02-01T09:00:00.000'
},{observedAt:NOW});

function fixture(linked=false){
  const sourceObservations={}, batches={};
  const cases={
    DOHMH:[],
    DOB_NOW:[restaurant,residential,unrelated,oldDob],
    SLA_PENDING:[sla,westchester,grocery,stale]
  };
  for(const k of research.REQUIRED_SOURCES){
    const o={
      observationId:'OBS:'+k,observedAt:NOW,
      state:'COMPLETE_NONEMPTY',sourceFresh:true,
      transportOk:true,supportsAbsenceConclusion:true,
      fetchedCount:cases[k].length,publisherCount:cases[k].length
    };
    sourceObservations[k]=o;
    batches[k]={observation:o,records:cases[k]};
  }
  const candidate={
    entityId:'CAMIS:50119999',camis:'50119999',
    address:'80 WYTHE AVENUE',borough:'Brooklyn',canonicalName:'UNRELATED OPERATOR',
    acceptedCorroboration:linked?[{
      sourceRecordId:restaurant.sourceRecordId,sourceSystem:'DOB_NOW',
      sourceUrl:restaurant.sourceUrl
    }]:[]
  };
  const graph={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',observedAt:NOW,
    graphState:'COMPLETE',graphDigest:'b'.repeat(64),passed:true,
    knownRegressionChecks:{passed:true},sourceObservations,
    metrics:{candidateCount:1},candidates:[candidate]
  };
  graph.artifactFingerprint=research.graphFingerprint(graph);
  return {graph,batches,observedAt:NOW};
}
const clean=review.inspect(fixture());
assert.equal(clean.status,'REVIEW_ONLY');
assert.equal(clean.customerDeliveryAllowed,false);
assert.equal(clean.externalSendCalls,0);
assert.equal(clean.totalResearchMatches,2);
assert.equal(clean.items.length,2);
assert.deepEqual(clean.sourceCounts,{DOB_NOW:1,SLA_PENDING:1});
assert(clean.items.every(item=>item.reviewStatus==='REVIEW_ONLY_UNLINKED'));
assert(clean.items.every(item=>item.customerDeliveryAllowed===false));
assert.equal(clean.items.find(item=>item.sourceSystem==='DOB_NOW').needsIdentityReview,true);
assert.deepEqual(clean.items.find(item=>item.sourceSystem==='DOB_NOW').possibleRelatedCamis,['CAMIS:50119999']);
assert.equal(clean.items.find(item=>item.sourceSystem==='SLA_PENDING').borough,'Queens');
assert(clean.items.find(item=>item.sourceSystem==='SLA_PENDING').officialUrl.includes('application_id=NA-0240-26-113135'));
assert(clean.items.find(item=>item.sourceSystem==='DOB_NOW').officialUrl.includes('job_filing_number=B00991888-I1'));
assert(!JSON.stringify(clean).includes('SAMPLE LEAD SCORE'));
assert(!JSON.stringify(clean).includes('OUTSIDE NYC LLC'));
assert.equal(clean.artifactFingerprint,review.inspect(fixture()).artifactFingerprint);

const linked=review.inspect(fixture(true));
assert.equal(linked.totalResearchMatches,1);
assert.equal(linked.ignored.alreadyLinked,1);
const limit=review.inspect({...fixture(),limit:1});
assert.equal(limit.storedCount,1);
assert.equal(limit.omittedByLimit,1);
assert.equal(limit.totalResearchMatches,2);

const partial=fixture();
partial.batches.SLA_PENDING.observation={...partial.batches.SLA_PENDING.observation,
  state:'PARTIAL',supportsAbsenceConclusion:false};
const held=review.inspect(partial);
assert.equal(held.status,'REVIEW');
assert(held.failures.includes('SOURCE_REVIEW_OBSERVATION_INVALID:SLA_PENDING'));
assert.equal(held.customerDeliveryAllowed,false);
const graphTampered=fixture();
graphTampered.graph.candidates[0].address='CHANGED UNVERIFIED PROPERTY';
assert.equal(review.inspect(graphTampered).status,'REVIEW');
const staleDate=review.inspect({...fixture(),observedAt:'2026-10-18T04:00:00.000Z'});
assert.equal(staleDate.status,'REVIEW');
assert.equal(review.inspect({graph:{},batches:{}}).status,'REVIEW');
assert.equal(review.within('2025-01-01',NOW,30),false);
assert.equal(review.within('2026-10-20',NOW,30),false);
console.log('Unlinked DOB/SLA early-stage review-only discovery tests passed.');
