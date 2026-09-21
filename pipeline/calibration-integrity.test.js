'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const c=require('./calibration-cohort');
const e=require('./calibration-evaluation');
const OBS='2026-09-20T12:00:00.000Z';

// Synthetic adapter inputs and declarations only. No reviewer labels or customer data.
function fixture(){
  const records=Array.from({length:104},(_,i)=>adapters.normalizeDohmhRow({
    camis:String(58810000+i),dba:'Synthetic Integrity Cafe '+i,building:String(i+1),street:'TEST AVE',
    boro:'Manhattan',zipcode:'10001',cuisine_description:'Coffee/Tea',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-20T00:00:00.000'
  },{observedAt:OBS}));
  const batch=records=>({records,observation:{state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
    supportsPositiveObservation:!!records.length,supportsAbsenceConclusion:true}});
  const batches={DOHMH:batch(records),SLA_PENDING:batch([]),DOB_NOW:batch([])};
  const graph=builder.buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW});
  return c.buildCohort({graph,batches,observedAt:OBS,sourceRevision:'a'.repeat(40),
    codeHashes:{'a.js':'a'.repeat(64),'b.js':'b'.repeat(64),'c.js':'c'.repeat(64)},
    isSynthetic:true,benchmarkSize:100,diagnosticSize:4});
}
function reseal(cohort){const {fingerprint,...body}=cohort;return c.sealed(body);}
const baseline=fixture();

for(const status of ['Approved','Disapproved','Withdrawn'])test('DOB source card retains real filing_status: '+status,()=>{
  const source=adapters.normalizeDobNowRow({job_filing_number:'SYNTHETIC-FILING',filing_status:status,
    filing_date:'2026-09-19T10:00:00.000',work_on_floor:'001',initial_cost:'$175,000',
    job_description:'Synthetic restaurant kitchen work',owner_s_business_name:'NOT_FOR_REVIEW_CARD'},
    {observedAt:OBS});
  const card=c.sourceCard(source);
  assert.equal(card.facts.filing_status,status);
  assert.equal(card.facts.work_on_floor,'001');
  assert.equal(card.facts.initial_cost_number,175000);
  assert.equal(card.facts.owner_s_business_name,undefined);
  assert.equal(card.facts.job_status,undefined);
});
for(const action of ['Establishment Closed by DOHMH.','Establishment re-opened by DOHMH.'])test('inspection action survives the reviewer boundary: '+action,()=>{
  const source=adapters.normalizeDohmhRow({camis:'58819999',inspection_date:'2026-09-19T00:00:00.000',
    inspection_type:'Cycle Inspection / Initial Inspection',action,phone:'DO_NOT_COPY',
    cuisine_description:'Coffee/Tea',record_date:'2026-09-20T00:00:00.000'},{observedAt:OBS});
  const card=c.sourceCard(source);
  assert.equal(card.facts.action,action);assert.equal(card.facts.phone,undefined);
  assert.equal(card.facts.record_date,undefined);
});
test('missing source status is not synthesized or renamed from job_status',()=>{
  const card=c.sourceCard({sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:missing',facts:{job_status:'Unverified alias'}});
  assert.equal(card.facts.filing_status,undefined);assert.equal(card.facts.job_status,undefined);
});
test('source card projection never mutates raw source facts',()=>{
  const source={sourceSystem:'DOB_NOW',sourceRecordId:'synthetic',facts:{filing_status:'Approved',work_on_floor:'1',job_description:'x'.repeat(3000),phone:'PRIVATE'}};
  const before=structuredClone(source),card=c.sourceCard(source);
  assert.deepEqual(source,before);assert.equal(card.facts.job_description.length,2400);assert.equal(card.facts.phone,undefined);
});
test('the corrected status changes evidence identity without changing scores',()=>{
  const source={sourceSystem:'DOB_NOW',sourceRecordId:'same-filing',facts:{filing_status:'Approved'}};
  const revised={...source,facts:{filing_status:'Disapproved'}};
  assert.notEqual(c.hash(c.sourceCard(source)),c.hash(c.sourceCard(revised)));
});
for(const url of ['https://data.cityofnewyork.us:8443/a','https://example.invalid/a','http://data.ny.gov/a'])test('noncanonical public source URL is not offered to reviewers: '+url,()=>{
  assert.equal(c.sourceCard({sourceSystem:'DOB_NOW',sourceUrl:url,facts:{}}).sourceUrl,null);
});
test('ordinary official source links still work',()=>{
  for(const url of ['https://data.ny.gov/resource/f8i8-k2gm.json','https://data.cityofnewyork.us/d/w9ak-ipjd']){
    assert.equal(c.sourceCard({sourceSystem:'DOB_NOW',sourceUrl:url,facts:{}}).sourceUrl,url);
  }
});
for(const [name,mutate,error] of [
  ['same-site repetition in tuning',v=>{const r=v.rows.filter(x=>x.split==='TUNING');r[1].groupId=r[0].groupId;},'DUPLICATE_SITE_GROUP'],
  ['same-site repetition in holdout',v=>{const r=v.rows.filter(x=>x.split==='HOLDOUT');r[1].groupId=r[0].groupId;},'DUPLICATE_SITE_GROUP'],
  ['same-site repetition in diagnostics',v=>{const r=v.rows.filter(x=>x.split==='DIAGNOSTIC');r[1].groupId=r[0].groupId;},'DUPLICATE_SITE_GROUP'],
  ['entity copied under another case ID',v=>{v.rows[1].entityId=v.rows[0].entityId;},'DUPLICATE_ENTITY'],
  ['group ID inconsistent with premises',v=>{v.rows[0].groupId='b'.repeat(64);},'SITE_GROUP_BINDING_INVALID'],
  ['holdout count inflation',v=>{v.counts.holdout++;},'COHORT_COUNTS_INVALID'],
  ['benchmark count inflation',v=>{v.counts.benchmark++;},'COHORT_COUNTS_INVALID'],
  ['population count below sampled support',v=>{v.counts.graphCandidates=1;},'COHORT_COUNTS_INVALID'],
  ['count disguised as a number string',v=>{v.counts.tuning=String(v.counts.tuning);},'COHORT_COUNTS_INVALID'],
  ['missing prediction',v=>{delete v.rows.find(x=>x.eligible).predictions.v4.POS;},'BENCHMARK_PREDICTION_INVALID'],
  ['null prediction',v=>{v.rows.find(x=>x.eligible).predictions.v4.POS=null;},'BENCHMARK_PREDICTION_INVALID'],
  ['out-of-range prediction',v=>{v.rows.find(x=>x.eligible).predictions.v3.Equipment=101;},'BENCHMARK_PREDICTION_INVALID'],
  ['duplicated category',v=>{v.categories.push(v.categories[0]);},'COHORT_CATEGORIES_INVALID'],
  ['unknown category',v=>{v.categories=['UNSUPPORTED'];},'COHORT_CATEGORIES_INVALID'],
  ['transport flag changed',v=>{v.transportMode='PROVIDER_SEND';},'COHORT_INTEGRITY_INVALID']
])test(name+' refuses a rehashed but inconsistent input',()=>{
  const input=structuredClone(baseline);mutate(input);
  assert.throws(()=>c.validateCohort(reseal(input)),new RegExp(error));
});
test('valid cohort still passes all structural and scope checks',()=>{
  assert.equal(c.validateCohort(baseline),baseline);
});
test('blind packet rejects duplicate premises before showing a false larger panel',()=>{
  const v=structuredClone(baseline),t=v.rows.filter(r=>r.split==='TUNING');t[1].groupId=t[0].groupId;
  assert.throws(()=>c.blindPacket(reseal(v)),/DUPLICATE_SITE_GROUP/);
});
test('no reviews still produces no thresholds and no production authorization',()=>{
  const result=e.lockThresholds(baseline,[],'2026-09-20T13:00:00.000Z');
  assert.equal(result.status,'BLOCKED');assert.equal(result.productionAuthorized,false);
  assert.ok(Object.values(result.categories).every(v=>v.threshold===null));
});
