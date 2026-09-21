'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const a=require('./source-adapters');
const b=require('./candidate-builder');
const p=require('./project-signal');
const e=require('./event-time');
const v3=require('./shadow-scoring-v3');
const v4=require('./shadow-scoring-v4');
const pack=require('./candidate-package');
const artifact=require('./subscriber-artifact');
const message=require('./customer-message');
const delivery=require('./delivery-plan');
const NOW='2026-09-21T16:00:00Z';
function fixture(changes={},extras=[],reviewed=false){
  const primary=a.normalizeDohmhRow({camis:'59970002',dba:'Synthetic Clock Cafe',boro:'Manhattan',building:'12',street:'EXAMPLE AVE',zipcode:'10001',phone:'555-0101',cuisine_description:'Coffee/Tea',inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T00:00:00.000',...changes},{observedAt:NOW});
  const batch=records=>({observation:{supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true},records});
  const graph=b.buildCurrentGraph({dohmhBatch:batch([primary]),slaBatch:batch(extras.filter(r=>r.sourceSystem==='SLA_PENDING')),dobBatch:batch(extras.filter(r=>r.sourceSystem==='DOB_NOW')),reviewedIdentityBridges:reviewed?extras.map(r=>p.reviewedBridgeKey(primary,r)):[]});
  return {graph,candidate:graph.candidates[0],records:v3.sourceMap([primary,...extras])};
}
function sla(date,changes={}){return a.normalizeSlaPendingRow({application_id:'SYNTHETIC-TIME',dba:'Synthetic Clock Cafe',actual_address_of_premises:'12 EXAMPLE AVE',city:'MANHATTAN',state_name:'NY',zip_code:'10001',description:'Food & Beverage Business',received_date:date,status:'Pending',...changes},{observedAt:NOW});}
function dob(date,changes={}){return a.normalizeDobNowRow({job_filing_number:'M-SYNTHETIC-TIME',house_no:'12',street_name:'EXAMPLE AVE',borough:'Manhattan',filing_date:date,filing_status:'Filed',job_description:'Restaurant commercial kitchen mechanical buildout',initial_cost:'$900,000',...changes},{observedAt:NOW});}
function describe(f,now=NOW,opts={}){return e.describe(f.candidate,f.records,now,opts);}
function score(f,now=NOW){return v4.computeShadowScores(f.candidate,f.records,now);}

test('unknown date is null age and zero recency, never day zero',()=>{
  const c=describe(fixture(),NOW,{firstObservedAt:NOW,detectedAt:NOW});
  assert.equal(c.status,'UNKNOWN');assert.equal(c.latestKnownEventDate,null);
  assert.equal(c.businessEventAgeCalendarDays,null);assert.equal(c.recencyPoints,0);
  assert.equal(c.sourcePullDate,'2026-09-21');assert.equal(c.permitplateFirstObservedAt,NOW.replace('Z','.000Z'));
  assert.equal(c.eventDateBasis,'UNPROVEN');assert.equal(e.valid(c),true);
});
// New boundary fixtures, unrelated to the unchanged 47-record V3 historical target.
for(const [date,age,points] of [['2026-09-21',0,15],['2026-09-18',3,15],['2026-09-17',4,10],['2026-09-14',7,10],['2026-09-13',8,5],['2026-08-22',30,5],['2026-08-21',31,0]]){
  test('dated inspection '+date+' gives age '+age+' and '+points+' points',()=>{
    const f=fixture({inspection_date:date,inspection_type:'Pre-permit (Operational) / Initial Inspection'});
    const c=describe(f);assert.equal(c.status,'KNOWN');assert.equal(c.eventDateBasis,'DOHMH_INSPECTION_DATE');
    assert.equal(c.businessEventAgeCalendarDays,age);assert.equal(c.recencyPoints,points);assert.equal(e.valid(c),true);
  });
}
test('accepted SLA uses received date rather than applicant extraction date',()=>{
  const c=describe(fixture({},[sla('2026-09-14T00:00:00.000')]));
  assert.equal(c.status,'KNOWN');assert.equal(c.latestKnownEventDate,'2026-09-14');assert.equal(c.recencyPoints,10);
  assert.equal(c.eventDateBasis,'SLA_APPLICATION_RECEIVED_DATE');
});
test('reviewed DOB keeps old filing time when its scope changes today',()=>{
  const c=describe(fixture({},[dob('2026-07-01T00:00:00.000')],true));
  assert.equal(c.eventDateBasis,'DOB_INITIAL_FILING_DATE');assert.equal(c.businessEventAgeCalendarDays,82);assert.equal(c.recencyPoints,0);
});
test('rejected co-located fresh DOB cannot improve recency',()=>{
  const f=fixture({},[dob('2026-09-21T00:00:00.000')]);
  assert.equal(describe(f).status,'UNKNOWN');assert.equal(describe(f).recencyPoints,0);
  assert.deepEqual(score(f).scores,score(fixture()).scores);
});
test('accepted SLA status update does not turn received_date into status-update time',()=>{
  const f=fixture({},[sla('2026-07-01T00:00:00.000',{status:'Under review'})]);
  assert.equal(describe(f).recencyPoints,0);assert.equal(describe(f).latestKnownEventDate,'2026-07-01');
});
for(const [name,date] of [['invalid day','2026-02-30T00:00:00.000'],['future','2026-09-22T00:00:00.000'],['malformed','soon'],['numeric',1790000000]]){
  test(name+' source event date requires review',()=>{
    const f=fixture({inspection_date:date,inspection_type:'Pre-permit (Operational) / Initial Inspection'});
    assert.equal(describe(f).status,'REVIEW');assert.equal(describe(f).recencyPoints,null);
    assert.equal(score(f).status,'REVIEW');assert.equal(score(f).productionAuthorized,false);
  });
}
test('bad date cannot be hidden by a second valid accepted source',()=>{
  assert.equal(describe(fixture({},[sla('2026-02-30'),dob('2026-09-21')],true)).status,'REVIEW');
});
test('missing accepted source lookup is review, not optimistic fallback',()=>{
  const f=fixture({},[sla('2026-09-21')]);f.records.clear();
  assert.ok(describe(f).failures.includes('ACCEPTED_SOURCE_RECORD_MISSING'));
});
test('accepted record source mismatch is review',()=>{
  const f=fixture({},[sla('2026-09-21')]);const id=f.candidate.projectSignal.corroboration.accepted[0].sourceRecordId;
  f.records.set(id,{...f.records.get(id),sourceSystem:'DOB_NOW'});
  assert.ok(describe(f).failures.includes('ACCEPTED_SOURCE_RECORD_MISMATCH'));
});
test('NY local day prevents a UTC-midnight threshold shift',()=>{
  const f=fixture({inspection_date:'2026-09-18T00:00:00.000',inspection_type:'Pre-permit / Initial Inspection'});
  const c=describe(f,'2026-09-22T02:00:00Z');assert.equal(c.asOfDate,'2026-09-21');assert.equal(c.businessEventAgeCalendarDays,3);
  assert.equal(c.recencyPoints,15);
});
test('equivalent source date forms keep calendar semantics',()=>{
  for(const raw of ['2026-09-18','2026-09-18T00:00:00.000','2026-09-18T00:00:00-04:00']){
    assert.equal(describe(fixture({inspection_date:raw,inspection_type:'Pre-permit / Initial Inspection'})).businessEventAgeCalendarDays,3);
  }
});
test('timezone-less observation time is not accepted',()=>{
  assert.equal(describe(fixture(),'2026-09-21T12:00:00').status,'REVIEW');
});
test('calendar parser rejects rollover, bad clock, and impossible offset',()=>{
  for(const raw of ['2026-02-29','2026-04-31','2026-09-21T24:00:00Z','2026-09-21T12:60:00Z','2026-09-21T12:00:00+18:00',null,{}]) assert.equal(e.calendarDate(raw),null);
  assert.equal(e.calendarDate('2024-02-29'),'2024-02-29');
});
test('untimed pull and legacy sourceEffectiveAt are never substituted as event time',()=>{
  const f=fixture({record_date:'2026-09-22T00:00:00.000'});f.candidate.sourceLatestEffectiveAt=NOW;
  const c=describe(f);assert.equal(c.status,'UNKNOWN');assert.equal(c.recencyPoints,0);
  assert.equal(c.sourcePullDate,null);assert.ok(c.warnings.includes('SOURCE_PULL_DATE_IN_FUTURE'));
});
test('known event recency decays rather than rejuvenates on later evaluation',()=>{
  const f=fixture({inspection_date:'2026-09-18T00:00:00.000',inspection_type:'Pre-permit / Initial Inspection'});
  const early=score(f),later=score(f,'2026-10-25T16:00:00Z');
  for(const cat of v4.CATEGORIES) assert.ok(later.scores[cat]<=early.scores[cat]);
});
test('V4 agrees with frozen V3 when source date and recency bucket already agree',()=>{
  const f=fixture({inspection_date:'2026-09-20T00:00:00.000',inspection_type:'Pre-permit / Initial Inspection'});
  const old=v3.computeShadowScores(f.candidate,f.records,NOW);assert.deepEqual(score(f).scores,old.scores);
  assert.equal(score(f).bestVendorFit,old.bestVendorFit);
});
test('unknown coffee scores match separately hand-calculated non-recency formula',()=>{
  const result=score(fixture());
  assert.deepEqual(result.scores,{POS:53,Insurance:50,Equipment:40,'Hood/Fire':21,Waste:37,Pest:35,Linen:25,Distribution:43});
});
test('unknown business-event date cannot cross the 60-point POS threshold from a refresh',()=>{
  assert.ok(score(fixture({record_date:'2026-07-01T00:00:00.000'})).scores.POS<60);
  assert.ok(score(fixture()).scores.POS<60);
});
test('recency is recomputed before saturation, not subtracted from clamped scores',()=>{
  const f=fixture({dba:'Synthetic Pizza',cuisine_description:'Pizza'},[dob('2026-07-01')],true);
  f.candidate.lifecycleStage='BUILDOUT / LICENSING';
  const result=score(f);assert.equal(result.input.recencyPoints,0);
  assert.equal(result.scores.Equipment,100);assert.equal(result.productionAuthorized,false);
});
test('excluded institutional contexts remain zero',()=>{
  const result=score(fixture({dba:'THE SYNTHETIC RESIDENCE'}));
  assert.equal(result.bestVendorFit,'SUPPRESSED');assert.ok(Object.values(result.scores).every(v=>v===0));
});
test('chronology evaluation never mutates source or candidate evidence',()=>{
  const f=fixture({},[sla('2026-09-20')]);const before=JSON.stringify(f.candidate);
  describe(f);score(f);assert.equal(JSON.stringify(f.candidate),before);
});
test('unknown legacy package is displayed as unknown, not inferred from saved effectiveAt',()=>{
  const fields=e.displayFields({lifecycleStage:'JUST FILED',sourceLatestEffectiveAt:NOW});
  assert.equal(fields.Stage,'APPLICANT — NOT YET INSPECTED');assert.equal(fields['Business Event Date'],'');
  assert.equal(fields['Business Event Basis'],'UNPROVEN');
});
test('invalid saved chronology does not produce a customer-facing date claim',()=>{
  const c=describe(fixture());c.latestKnownEventDate='2026-09-21';
  assert.equal(e.displayFields({eventChronology:c})['Business Event Date'],'');
});
test('package, report/CSV and digest preserve three distinct clocks without silently promoting V4',()=>{
  const f=fixture(),c=f.candidate;
  const detection={receiptId:'DET:TIME-FIXTURE',entityId:c.entityId,changeFingerprint:delivery.candidateChangeFingerprint(c),detectionClass:'NEW_ENTITY',customerEligible:true,firstDetectedAt:'2026-09-21T15:00:00Z'};
  const promotionEvidence={graphState:'COMPLETE',shadowCoverageRate:1,currentOverlap:13,currentExactAllCategoryRate:1,currentBestFitAgreementRate:1,historicalRecordCount:47,historicalExactRowRate:1,historicalFitAgreementRate:1,historicalBestFitAgreementRate:1,documentedLegacyAnomalyIds:['50192386','50192550'],transportMode:'NO_SEND'};
  const result=pack.buildCandidatePackage({graph:f.graph,candidate:c,recordsById:f.records,observedAt:NOW,detectionReceipt:detection,promotionEvidence});
  assert.equal(result.status,'READY_FOR_PROFILE_MATCHING');assert.equal(result.eventChronology.status,'UNKNOWN');
  assert.equal(result.scorerVersion,v3.SHADOW_SCORING_VERSION,'display rollout must not promote the shadow scorer');
  const row=artifact.rowFromSelection({package:result,signalKey:'normal:test',deliveryClass:'NORMAL',detectedAt:detection.firstDetectedAt,selectedCategory:'POS',selectedScore:result.scores.POS});
  assert.equal(row.Stage,'APPLICANT — NOT YET INSPECTED');assert.equal(row['Business Event Date'],'');
  assert.equal(row['Dataset Pull Date'],'2026-09-21');assert.equal(row['Detected At'],detection.firstDetectedAt);
  assert.equal(row['PermitPlate Observed At'],'2026-09-21T16:00:00.000Z');
  const rendered=message.renderCustomerMessage({artifact:{status:'READY',artifactFingerprint:'fixture',csvRows:[row],csv:artifact.toCsv([row]),filename:'synthetic.csv'},reportDate:'2026-09-21'});
  assert.ok(!rendered.text.includes('JUST FILED'));assert.ok(!rendered.html.includes('JUST FILED'));
  assert.ok(rendered.text.includes('not proven'));assert.ok(rendered.text.includes('(not a filing date)'));
  assert.ok(rendered.attachment.content.includes('Business Event Basis'));
});
test('new scorer is never production authority',()=>{
  for(const f of [fixture(),fixture({},[sla('2026-09-20')]),fixture({dba:'THE SYNTHETIC RESIDENCE'})]) assert.equal(score(f).productionAuthorized,false);
});
