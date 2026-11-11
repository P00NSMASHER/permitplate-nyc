'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const cohort=require('./calibration-cohort');
const evaluation=require('./calibration-evaluation');
const runner=require('./calibration-runner');

const OBS='2026-11-10T16:00:00.000Z';
const HASHES={'a.js':'a'.repeat(64),'b.js':'b'.repeat(64),'c.js':'c'.repeat(64)};
function sourceInput(dated=130,unknown=25,stale=10){
  const records=Array.from({length:dated+unknown+stale},(_,i)=>{
    const hasDate=i<dated||i>=dated+unknown;
    const date=!hasDate?'1900-01-01T00:00:00.000':
      i<dated?'2026-11-06T00:00:00.000':'2026-08-15T00:00:00.000';
    return adapters.normalizeDohmhRow({
      camis:String(68100000+i),dba:'Synthetic Dated Cafe '+i,
      building:String(1000+i),street:'SYNTHETIC AVE',
      boro:'Manhattan',zipcode:'10001',cuisine_description:'Coffee/Tea',
      inspection_type:hasDate?'Pre-permit Inspection':'',
      inspection_date:date,record_date:'2026-11-10T00:00:00.000'
    },{observedAt:OBS});
  });
  const batch=rs=>({records:rs,observation:{
    state:rs.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
    supportsPositiveObservation:!!rs.length,supportsAbsenceConclusion:true
  }});
  const batches={DOHMH:batch(records),SLA_PENDING:batch([]),DOB_NOW:batch([])};
  const graph=builder.buildCurrentGraph({
    dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW
  });
  return {graph,batches,observedAt:OBS,sourceRevision:'a'.repeat(40),
    codeHashes:HASHES,isSynthetic:true,categories:['Equipment'],
    benchmarkSize:100,diagnosticSize:0,populationScope:cohort.DATED_SCOPE};
}
function reseal(x){const {fingerprint,...body}=x;return cohort.sealed(body);}

test('dated research mode is distinct, has unchanged numeric gates, and cannot promote itself',()=>{
  const s=runner.calibrationScope('Equipment',cohort.DATED_SCOPE);
  assert.equal(s.scope,'SOURCE_DATED_EQUIPMENT_REVIEW');
  assert.equal(s.populationScope,cohort.DATED_SCOPE);
  for(const key of ['thresholds','minimumTuningCases','minimumHoldoutCases',
    'minimumSelected','minimumPrecision','minimumWilsonLower95',
    'minimumReviewerAgreement','currentDefaultThreshold']){
    assert.deepEqual(cohort.DATED_PROTOCOL[key],cohort.PROTOCOL[key],key);
  }
  assert.equal(cohort.DATED_PROTOCOL.automaticPromotion,false);
  assert.equal(cohort.PROTOCOL.automaticPromotion,false);
  assert.notEqual(cohort.DATED_PROTOCOL.id,cohort.PROTOCOL.id);
  assert.throws(()=>runner.calibrationScope('POS',cohort.DATED_SCOPE),/DATED_EQUIPMENT_ONLY/);
  assert.throws(()=>runner.calibrationScope('Equipment','IMPLIED_APPROVAL'),/CALIBRATION_POPULATION_NOT_AUTHORIZED/);
});

test('100 source-dated unique sites produce exactly 70 tuning and 30 sealed holdout cases',()=>{
  const input=sourceInput();
  const c=cohort.buildCohort(input);
  assert.equal(c.populationScope,cohort.DATED_SCOPE);
  assert.equal(c.protocol.id,cohort.DATED_PROTOCOL.id);
  assert.equal(c.counts.eligibleCandidates,130);
  assert.equal(c.counts.eligibleSiteGroups,130);
  assert.equal(c.counts.benchmark,100);
  assert.equal(c.counts.tuning,70);
  assert.equal(c.counts.holdout,30);
  assert.equal(c.counts.diagnostic,0);
  assert.equal(c.productionAuthorized,false);
  assert.equal(c.transportMode,'NO_SEND');
  assert.equal(c.rows.length,100);
  assert.equal(new Set(c.rows.map(r=>r.groupId)).size,100);
  assert.equal(cohort.validateCohort(c),c);
  for(const r of c.rows){
    assert.equal(r.card.stage,'HEALTH PRE-PERMIT');
    assert.equal(r.card.eventDateBasis,'DOHMH_INSPECTION_DATE');
    assert.equal(r.card.eventTimeStatus,'KNOWN');
    assert.equal(r.card.businessEventDate,'2026-11-06');
    assert(r.card.evidence.some(e=>e.recordId===r.card.eventSourceRecordId));
  }
  const packet=cohort.blindPacket(c);
  assert.equal(packet.cards.length,70);
  assert(packet.cards.every(card=>!('predictions' in card)&&!('scores' in card)&&
    !('split' in card)&&!('panel' in card)));
  assert.throws(()=>cohort.blindPacket(c,'HOLDOUT'),/HOLDOUT_REQUIRES_THRESHOLD_LOCK/);
  const result=evaluation.lockThresholds(c,[],OBS);
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.productionAuthorized,false);
});

test('insufficient dated official evidence fails closed instead of reusing undated cases',()=>{
  const input=sourceInput(99,100,0);
  assert.throws(()=>cohort.buildCohort(input),/DATED_PREPERMIT_SUPPORT_BELOW_100:99/);
});

test('dated cohort is deterministic and independent of input record order',()=>{
  const input=sourceInput();
  const a=cohort.buildCohort(input);
  input.graph.candidates.reverse();
  const b=cohort.buildCohort(input);
  assert.equal(a.fingerprint,b.fingerprint);
});

test('source-date and event-identity tampering fail even when cohort is resealed',()=>{
  const c=cohort.buildCohort(sourceInput());
  for(const [name,modify] of [
    ['forged undated source',r=>{r.card.eventTimeStatus='UNKNOWN';}],
    ['applicant substituted',r=>{r.card.stage='APPLICANT — NOT YET INSPECTED';}],
    ['wrong official basis',r=>{r.card.eventDateBasis='SOURCE_PULL_DATE';}],
    ['unverified evidence ID',r=>{r.card.eventSourceRecordId='DOHMH:UNRELATED';}],
    ['stale inspection',r=>{r.card.businessEventDate='2026-08-15';}]
  ]){
    const altered=structuredClone(c),row=altered.rows[0];
    modify(row);row.evidenceFingerprint=cohort.hash(row.card);
    assert.throws(()=>cohort.validateCohort(reseal(altered)),
      /DATED_PREPERMIT_SOURCE_EVIDENCE_INVALID/,name);
  }
});

test('original unfiltered sampling and original protocol remain compatible',()=>{
  const input=sourceInput();
  const legacy=cohort.buildCohort({...input,populationScope:null});
  assert.equal(legacy.protocol.id,cohort.PROTOCOL.id);
  assert.equal(legacy.populationScope,undefined);
  assert.equal(legacy.counts.eligibleCandidates,165);
  assert.equal(legacy.counts.benchmark,100);
  assert.equal(cohort.validateCohort(legacy),legacy);
  assert.equal(legacy.productionAuthorized,false);
});
