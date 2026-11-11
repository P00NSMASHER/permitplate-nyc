'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const evidence=require('./dob-equipment-evidence');
const clock=require('./event-time');
const OBSERVED='2026-11-10T18:00:00Z';
const observation=(sourceKey,records,state='COMPLETE_NONEMPTY')=>({
  records,observation:{sourceId:adapters.SOURCE_CONFIGS[sourceKey].sourceId,
    observationId:'OBS:source-bound-fixture-'+sourceKey,
    queryScopeHash:'fixture-full-scope-'+sourceKey,
    state,supportsAbsenceConclusion:true,fetchedCount:records.length,rawPageHashes:['raw-fixture-page']}
});
const dohmh=(camis='51000001',extra={})=>adapters.normalizeDohmhRow({
  camis,dba:'Example Diner',building:'101',street:'MAIN STREET',boro:'Manhattan',
  bin:'1000001',bbl:'1000010001',inspection_date:'2026-11-03T00:00:00.000',
  inspection_type:'Pre-permit (Operational) / Initial Inspection',
  cuisine_description:'American',...extra
},{observedAt:OBSERVED});
const dob=(id='M12345678-I1',extra={})=>adapters.normalizeDobNowRow({
  job_filing_number:id,filing_status:'Approved',
  house_no:'101',street_name:'MAIN STREET',borough:'Manhattan',
  bin:'1000001',block:'10',lot:'1',
  filing_date:'2026-11-01T00:00:00.000',
  job_description:'PROPOSED INSTALLATION OF NEW COMMERCIAL KITCHEN EQUIPMENT AND TYPE I HOOD',
  initial_cost:'$70,000',...extra
},{observedAt:OBSERVED});
const mark=record=>({...record,sourceObservationId:'OBS:real-source-fingerprint-fixture'});
const run=(dohmhRows,dobRows,opts={})=>evidence.audit({dohmhBatch:observation('DOHMH',dohmhRows.map(mark),opts.dohmhState),
  dobBatch:observation('DOB_NOW',dobRows.map(mark),opts.dobState),
  observedAt:OBSERVED});

test('explicit approved DOB equipment installation scope is real source evidence, not a purchase',()=>{
  const r=run([dohmh()],[dob()]);
  assert.equal(r.status,'SOURCE_BOUNDED_RESEARCH_ONLY');
  assert.equal(r.counts.recentDatedPrepermitCandidates,1);
  assert.equal(r.counts.qualifyingDirectScopeFilings,1);
  assert.equal(r.counts.siteMatchedFilings,1);
  assert.equal(r.findings.length,1);
  const f=r.findings[0];
  assert.equal(f.scope,'EXPLICIT_KITCHEN_EQUIPMENT_OR_HOOD_SCOPE');
  assert.equal(f.sourceRecordId,'DOB_NOW:M12345678-I1');
  assert.equal(f.rawFactFingerprint,mark(dob()).rawFactFingerprint);
  assert.equal(f.association,'SAME_EXACT_ADDRESS_BOROUGH_AND_BIN');
  assert.equal(f.operatorIdentityProven,false);
  assert.equal(f.purchaseProven,false);
  assert.equal(f.installationCompletedProven,false);
  assert.equal(f.site.consumerIdentityProven,false);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.customerDeliveryAllowed,false);
  assert.equal(r.externalSendCalls,0);
  assert.equal(r.holdoutReleased,false);
  assert(!JSON.stringify(f).includes('ownerBusinessName'));
});

test('specific submitted kitchen fitout is classified as construction only',()=>{
  const r=run([dohmh()],[dob('M200-I1',{job_description:'PROPOSED RENOVATION OF RESTAURANT KITCHEN INCLUDING INTERIOR ALTERATION'})]);
  assert.equal(r.counts.qualifyingDirectScopeFilings,0);
  assert.equal(r.counts.qualifyingKitchenConstructionFilings,1);
  assert.equal(r.findings[0].scope,'RESTAURANT_KITCHEN_CONSTRUCTION_SCOPE_ONLY');
});

for(const description of [
  'PROPOSED GENERAL INTERIOR RENOVATION OF APARTMENT',
  'INSTALLATION OF HVAC UNIT ON OFFICE BUILDING',
  'NEW RESTROOM PLUMBING IN COMMERCIAL OFFICE',
  'EXISTING KITCHEN EQUIPMENT TO REMAIN; NO NEW WORK',
  'REMOVE ONLY OLD KITCHEN EQUIPMENT',
  'INSTALLATION OF NEW ELEVATOR AND EQUIPMENT',
  'NO CHANGE TO KITCHEN EQUIPMENT',
  'PROPOSED EQUIPMENT ROOM FOR CELLULAR TELECOM'
])test('unsupported or negated DOB work never proves Equipment demand: '+description,()=>{
  const r=run([dohmh()],[dob('M-GENERIC',{job_description:description})]);
  assert.equal(r.findings.length,0);
  assert.equal(r.counts.qualifyingDirectScopeFilings,0);
});

test('missing or withdrawn filing is not positive',()=>{
  for(const status of ['Withdrawn','Disapproved','Cancelled','', 'Expired']){
    const r=run([dohmh()],[dob('M-BAD',{filing_status:status})]);
    assert.equal(r.findings.length,0,status);
    assert.equal(r.counts.qualifyingDirectScopeFilings,0,status);
  }
});
test('future and stale DOB dates refuse to count as current',()=>{
  for(const date of ['2026-11-11T00:00:00.000','2026-06-01T00:00:00.000',null]){
    const r=run([dohmh()],[dob('M-DATE',{filing_date:date})]);
    assert.equal(r.findings.length,0,String(date));
  }
});
test('same address with contradictory BIN or BBL is quarantined',()=>{
  for(const field of [{bin:'1000099'},{block:'12',lot:'1'}]){
    const r=run([dohmh()],[dob('M-MISMATCH',field)]);
    assert.equal(r.findings.length,0);
    assert.equal(r.counts.binOrBblConflict,1);
  }
});
test('same address alone is premises evidence, never same restaurant identity',()=>{
  const r=run([dohmh('51000001',{bin:null,bbl:null})],[dob('M-ADDR',{bin:null,block:null,lot:null})]);
  assert.equal(r.findings[0].association,'SAME_EXACT_ADDRESS_AND_BOROUGH_ONLY');
  assert.equal(r.findings[0].operatorIdentityProven,false);
  assert.equal(r.findings[0].site.consumerIdentityProven,false);
});
test('multiple CAMIS at same address never allow attaching project to either tenant',()=>{
  const r=run([dohmh('51000001'),dohmh('51000002')],[dob()]);
  assert.equal(r.counts.ambiguousMultiOccupant,1);
  assert.equal(r.counts.siteMatchedFilings,0);
  assert.equal(r.findings.length,0);
});
test('borough and street address both need exact match',()=>{
  const r=run([dohmh()],[dob('M-OTHERBORO',{borough:'Brooklyn'}),
    dob('M-OTHERSTREET',{street_name:'BROADWAY'})]);
  assert.equal(r.counts.unmatchedRelevantFilings,2);
  assert.equal(r.findings.length,0);
});
test('ineligible suppressed or undated DOHMH candidate cannot receive DOB corroboration',()=>{
  for(const x of [{boro:''},{inspection_date:'1900-01-01T00:00:00.000'},
    {inspection_date:'2026-10-01T00:00:00.000'},{inspection_type:'Cycle Inspection'}]){
    const r=run([dohmh('51000001',x)],[dob()]);
    assert.equal(r.findings.length,0);
  }
});
test('duplicate stable filing IDs with different source fingerprints are never accepted',()=>{
  const a=dob('M-DUPLICATE'),b=dob('M-DUPLICATE',{job_description:'NEW COMMERCIAL REFRIGERATION EQUIPMENT'});
  const r=run([dohmh()],[a,b,a]);
  assert.equal(r.counts.duplicateFilingConflicts,1);
  assert.equal(r.counts.qualifyingDirectScopeFilings,0);
  assert.equal(r.findings.length,0);
});
test('incomplete DOB or DOHMH source fails closed, without partial positive inventory',()=>{
  for(const which of ['DOHMH','DOB_NOW']){
    const opts=which==='DOHMH'?{dohmhState:'SOURCE_UNAVAILABLE'}:{dobState:'SOURCE_UNAVAILABLE'};
    const r=run([dohmh()],[dob()],opts);
    assert.equal(r.status,'SOURCE_INCOMPLETE_REVIEW');
    assert.equal(r.findings.length,0);
    assert.equal(r.productionAuthorized,false);
  }
});
test('there is no scoring, transport or private-state import in the independent research module',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const code=fs.readFileSync(path.join(__dirname,'dob-equipment-evidence.js'),'utf8');
  for(const bad of ["require('./scoring-policy')","require('./delivery-plan')",
    "require('stripe')","send_email","scoreCandidateWithPolicy",
    "productionAuthorized:true","customerDeliveryAllowed:true"]){
    assert(!code.includes(bad),bad);
  }
  assert.equal(clock.nycDate(OBSERVED),'2026-11-10');
});
