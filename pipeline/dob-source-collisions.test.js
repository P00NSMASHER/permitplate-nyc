'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const research=require('./curated-research-ledger');
const collisions=require('./dob-source-collisions');
const materialChange=require('./material-change');

const NOW='2026-10-27T14:00:00.000Z';
const ID='DOB_NOW:B00772431-A5';
function row(overrides={}){
  // Synthetic reproduction of the public collision shape, not a claim that
  // these fixture facts or judgments are authenticated publisher evidence.
  return adapters.normalizeDobNowRow({job_filing_number:'B00772431-A5',
    filing_date:'2026-10-23T00:00:00.000',filing_status:'Approved',
    house_no:'100',street_name:'TEST STREET',borough:'Brooklyn',
    job_description:'Mechanical work in conjunction with a new building filing.',
    initial_cost:'300',building_type:'Commercial',...overrides},{observedAt:NOW});
}
function input(rows=[row(),row({filing_status:'Pending Plan Examiner Assignment',initial_cost:'100'})]){
  const observation={observationId:'OBS:synthetic-duplicate',observedAt:NOW,
    state:'COMPLETE_NONEMPTY',transportOk:true,sourceFresh:true,supportsAbsenceConclusion:true,
    publisherCount:rows.length,fetchedCount:rows.length,cursorClosed:true,
    rawPageHashes:[research.hash(rows)]};
  return {batch:{observation,records:rows.map(r=>({...r,sourceObservationId:observation.observationId}))},
    graph:{candidates:[]},independent:{items:[],omittedByLimit:0},
    identities:{proposals:[],omittedByLimit:0,reviewQueueComplete:true,skippedWithoutDohmhProvenance:0},
    protectedReferences:{}};
}
function rejectedCandidate(){
  const source=adapters.normalizeDohmhRow({camis:'50000001',dba:'Synthetic Restaurant',
    building:'100',street:'TEST STREET',boro:'Brooklyn',inspection_date:'1900-01-01T00:00:00.000',
    record_date:NOW},{observedAt:NOW});
  const c={entityId:'CAMIS:50000001',sourceSystems:['DOHMH'],primaryRecord:source,
    acceptedCorroboration:[],commercialEvidence:[],rejectedCorroboration:[{
      sourceRecordId:ID,sourceSystem:'DOB_NOW',sourceUrl:adapters.SOURCE_CONFIGS.DOB_NOW.landingUrl,
      result:{corroborates:false,coLocated:true,confidence:'LOW',conflict:null,
        reasons:['COLOCATED_ONLY','NO_ENTITY_NAME_BRIDGE']}}]};
  c.materiality=materialChange.describe(c);return c;
}
test('out-of-scope conflict retains all publisher rows, counts, receipts and variants',()=>{
  const data=input(),before=structuredClone(data),result=collisions.assess(data);
  assert.equal(result.status,'QUARANTINED_OUTSIDE_RESEARCH_SCOPE');
  assert.deepEqual(data,before,'assessment cannot edit the raw batch or references');
  assert.equal(result.byId.has(ID),false,'no arbitrary variant becomes authoritative');
  const r=result.receipt;
  assert.equal(r.publisherRowCount,2);assert.equal(r.fetchedRowCount,2);
  assert.equal(r.quarantinedIdCount,1);assert.equal(r.quarantinedRowCount,2);
  assert.equal(r.rawRowsRemoved,0);assert.equal(r.sourceCountsModified,false);
  assert.equal(r.sourceRecordSequenceFingerprint,research.hash(data.batch.records));
  assert.deepEqual(r.sourceObservation,data.batch.observation);
  assert.equal(r.collisions[0].variants.length,2);
  assert.deepEqual(r.collisions[0].variants.map(v=>v.record.facts.filing_status).sort(),
    ['Approved','Pending Plan Examiner Assignment']);
  assert(r.collisions[0].variants.every(v=>v.rawFactFingerprint===v.record.rawFactFingerprint));
  assert.equal(r.authoritativeVariantSelected,false);assert.equal(r.customerDeliveryAllowed,false);
  assert.equal(r.productionAuthorized,false);
  const reversed=structuredClone(data);reversed.batch.records.reverse();
  const rerun=collisions.assess(reversed).receipt;
  assert.equal(r.decisionFingerprint,rerun.decisionFingerprint);
  assert.notEqual(r.sourceRecordSequenceFingerprint,rerun.sourceRecordSequenceFingerprint);
});
test('a restaurant-related variant holds the entire collision in either publisher order',()=>{
  for(const rows of [[row(),row({job_description:'New restaurant kitchen equipment installation.'})],
    [row({job_description:'New restaurant kitchen equipment installation.'}),row()]]){
    const result=collisions.assess(input(rows));
    assert.equal(result.status,'REVIEW');
    assert(result.failures.includes('DOB_COLLISION_RESTAURANT_SCOPE'));
    assert.equal(result.receipt.quarantinedIdCount,0);
    assert.equal(result.byId.has(ID),false);
  }
});
test('current, rejected, historical, frozen and encoded references all prevent quarantine',()=>{
  const paths=[
    {graph:{candidates:[{acceptedCorroboration:[{sourceRecordId:ID}]}]}},
    {graph:{candidates:[{rejectedCorroboration:[{sourceRecordId:ID}]}]}},
    {graph:{candidates:[{commercialEvidence:[{sourceRecordId:ID}]}]}},
    {graph:{candidates:[{materiality:{sourceKeys:[ID]}}]}},
    {graph:{candidates:[{projectSignal:{primarySourceRecordId:ID}}]}},
    {graph:{candidates:[{projectSignal:{sourceRecordIds:[ID]}}]}},
    {graph:{candidates:[{projectSignal:{corroboration:{rejectedBySourceState:[{sourceRecordId:ID}]}}}]}},
    {graph:{candidates:[{projectSignal:{materialEvidence:[{key:ID}]}}]}},
    {independent:{items:[{sourceRecordId:ID}]}},
    {identities:{proposals:[{sourceRecordIds:[ID]}]}},
    {protectedReferences:{previousIndependentHistory:{entries:{[ID]:{presenceState:'OUT_OF_CURRENT_WINDOW'}}}}},
    {protectedReferences:{frozenSourceCases:[{sourceRecordId:ID}]}},
    {protectedReferences:{previousIdentityReview:{proposals:[{sourceRecordId:ID}]}}},
    {protectedReferences:{reviewedIdentityBridges:['CAMIS:50000001|'+ID] }},
    {graph:{url:'https://data.cityofnewyork.us/resource/w9ak-ipjd.json?job_filing_number=B00772431%2DA5'}},
    {protectedReferences:{sameJobFamily:['DOB_NOW:B00772431-I1']}}
  ];
  for(const reference of paths){
    const result=collisions.assess({...input(),...reference});
    assert.equal(result.status,'REVIEW',JSON.stringify(reference));
    assert(result.failures.includes('DOB_COLLISION_REFERENCED'));
    assert.equal(result.receipt.quarantinedIdCount,0);
    assert(result.receipt.collisions[0].referencePaths.length>0);
  }
});
test('unknown scope, invalid identity, changed facts and incomplete counts remain held',()=>{
  for(const override of [{job_description:''},{filing_date:null},{borough:'Unknown'}]){
    assert(collisions.assess(input([row(),row(override)])).failures.includes('DOB_COLLISION_SCOPE_UNKNOWN'));
  }
  const wrongId=input();wrongId.batch.records[1].entityKeys.jobFilingNumber='B00000001-I1';
  assert(collisions.assess(wrongId).failures.includes('DOB_COLLISION_SOURCE_ROW_INVALID'));
  const changed=input();changed.batch.records[1].facts.filing_status='Edited status';
  assert(collisions.assess(changed).failures.includes('DOB_COLLISION_SOURCE_ROW_INVALID'));
  const partial=input();partial.batch.observation.publisherCount++;
  assert(collisions.assess(partial).failures.includes('DOB_COLLISION_SOURCE_NOT_COMPLETE'));
  for(const change of [data=>{data.independent.omittedByLimit=1;},
    data=>{data.identities.reviewQueueComplete=false;},data=>{data.identities.omittedByLimit=1;},
    data=>{data.identities.skippedWithoutDohmhProvenance=1;}]){
    const data=input();change(data);
    assert(collisions.assess(data).failures.includes('DOB_COLLISION_REFERENCE_SCOPE_INCOMPLETE'));
  }
});
test('typed rejected-only co-location proves non-use while preserving its complete negative evidence',()=>{
  const data=input();data.graph.candidates=[rejectedCandidate()];
  const before=structuredClone(data),result=collisions.assess(data);
  assert.equal(result.status,'QUARANTINED_OUTSIDE_RESEARCH_SCOPE');
  assert.deepEqual(data,before);
  const group=result.receipt.collisions[0];
  assert.deepEqual(group.referencePaths,[]);
  assert.equal(group.negativeReferences.length,1);
  assert.deepEqual(group.negativeReferences[0].rejection,data.graph.candidates[0].rejectedCorroboration[0]);
  const reversed=structuredClone(data);reversed.batch.records.reverse();
  assert.equal(collisions.assess(reversed).receipt.decisionFingerprint,result.receipt.decisionFingerprint);
  data.protectedReferences={priorHistory:{entries:{[ID]:{}}}};
  assert.equal(collisions.assess(data).status,'REVIEW','negative current context cannot erase historical references');
});
test('every missing or contradictory non-use proof remains a referenced collision hold',()=>{
  const mutations=[
    c=>{delete c.sourceSystems;},c=>{c.sourceSystems.push('DOB_NOW');},
    c=>{delete c.acceptedCorroboration;},c=>{c.acceptedCorroboration.push({sourceRecordId:'DOB_NOW:B00000001-I1'});},
    c=>{delete c.commercialEvidence;},c=>{c.commercialEvidence.push({sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:B00000001-I1'});},
    c=>{delete c.materiality;},c=>{c.materiality.sourceKeys.push(ID);},
    c=>{c.rejectedCorroboration[0].sourceUrl='https://example.com/';},
    c=>{c.rejectedCorroboration[0].result.corroborates=true;},
    c=>{delete c.rejectedCorroboration[0].result.corroborates;},
    c=>{c.rejectedCorroboration[0].result.coLocated=false;},
    c=>{c.rejectedCorroboration[0].result.conflict={reason:'IDENTITY_CONFLICT'};},
    c=>{delete c.rejectedCorroboration[0].result.conflict;},
    c=>{c.rejectedCorroboration[0].result.confidence='HIGH';},
    c=>{c.rejectedCorroboration[0].result.reasons.pop();},
    c=>{c.rejectedCorroboration[0].result.reasons.push('UNRECOGNIZED_REASON');},
    c=>{c.rejectedCorroboration[0].result.unrecognizedProof=true;}
  ];
  for(const change of mutations){
    const data=input();data.graph.candidates=[rejectedCandidate()];change(data.graph.candidates[0]);
    const result=collisions.assess(data);
    assert.equal(result.status,'REVIEW');assert(result.failures.includes('DOB_COLLISION_REFERENCED'));
  }
});
test('identical duplicates still require exclusion proof and never amplify evidence',()=>{
  const result=collisions.assess(input([row(),row()]));
  assert.equal(result.receipt.collisions[0].distinctVariantCount,1);
  assert.equal(result.receipt.collisions[0].variants[0].occurrences,2);
  assert.equal(result.receipt.quarantinedRowCount,2);
  assert.equal(result.byId.size,0);
  const relevant=row({job_description:'Restaurant renovation'});
  assert.equal(collisions.assess(input([relevant,relevant])).status,'REVIEW');
  const single=collisions.assess(input([row()]));
  assert.equal(single.status,'NO_COLLISIONS');assert.equal(single.byId.size,1);
  assert.equal(collisions.assess(input([row({job_filing_number:'B00989327-AR01'})])).status,'NO_COLLISIONS');
});
