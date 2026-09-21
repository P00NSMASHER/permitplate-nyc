'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const a=require('./source-adapters');
const p=require('./project-signal');
const b=require('./candidate-builder');
const d=require('./detection-ledger');
const m=require('./material-change');
const delivery=require('./delivery-plan');
const T0='2026-09-21T13:00:00Z', T1='2026-09-22T13:00:00Z', T2='2026-09-23T13:00:00Z';
const clone=value=>JSON.parse(JSON.stringify(value));
function row(overrides={}) {
  return {camis:'59980001',dba:'Synthetic Example Cafe',boro:'Manhattan',building:'10',street:'EXAMPLE ST',zipcode:'10001',cuisine_description:'Coffee/Tea',inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00Z',...overrides};
}
const batch=records=>({observation:{state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true},records});
function graph(primaryRow=row(),slaRows=[],dobRows=[],reviewed=false) {
  const primary=a.normalizeDohmhRow(primaryRow,{observedAt:primaryRow.record_date});
  const dobs=dobRows.map(value=>a.normalizeDobNowRow(value,{observedAt:primaryRow.record_date}));
  return b.buildCurrentGraph({dohmhBatch:batch([primary]),slaBatch:batch(slaRows.map(value=>a.normalizeSlaPendingRow(value,{observedAt:primaryRow.record_date}))),dobBatch:batch(dobs),reviewedIdentityBridges:reviewed?dobs.map(record=>p.reviewedBridgeKey(primary,record)):[]});
}
function sla(overrides={}) {
  return {application_id:'SYNTHETIC-1',dba:'Synthetic Example Cafe',legalname:'Example Business LLC',description:'Food & Beverage Business',actual_address_of_premises:'10 EXAMPLE ST',city:'MANHATTAN',state_name:'NY',zip_code:'10001',received_date:'2026-09-20T00:00:00.000',status:'Pending',...overrides};
}
function dob(overrides={}) {
  return {job_filing_number:'M-SYNTHETIC-1',house_no:'10',street_name:'EXAMPLE ST',borough:'Manhattan',owner_s_business_name:'Example Business LLC',filing_date:'2026-09-20T00:00:00.000',filing_status:'Filed',job_description:'Restaurant commercial kitchen buildout',initial_cost:'$100,000',...overrides};
}
function advance(first,second) {
  const baseline=d.bootstrapLedger(first,T0);
  const before=JSON.stringify(baseline.ledger);
  const result=d.advanceDetectionLedger(baseline.ledger,second,T1);
  assert.equal(JSON.stringify(baseline.ledger),before,'input ledger must not be mutated');
  return {baseline,result};
}
function legacyBinding(c) {
  return delivery.sha256(delivery.stableStringify({entityId:c.entityId||null,projectSignalId:c.projectSignalId||null,lifecycleStage:c.lifecycleStage||null,sourceLatestEffectiveAt:c.sourceLatestEffectiveAt||null,sourceSystems:(c.sourceSystems||[]).slice().sort(),commercialEvidence:(c.commercialEvidence||[]).map(item=>({tag:item.tag||null,sourceSystem:item.sourceSystem||null,sourceRecordId:item.sourceRecordId||null})).sort((x,y)=>delivery.stableStringify(x).localeCompare(delivery.stableStringify(y)))}));
}
function oldLedger(g) {
  const old=clone(d.bootstrapLedger(g,T0).ledger);
  for(const c of g.candidates) {
    const entry=old.entries[c.entityId]; delete entry.materiality;
    entry.currentChangeFingerprint=legacyBinding(c);
    entry.entryFingerprint=d.entryFingerprint(entry);
  }
  old.ledgerFingerprint=d.ledgerFingerprint(old);
  return old;
}

test('DOHMH material evidence never substitutes extraction date for an event date',()=>{
  const source=a.normalizeDohmhRow(row(),{observedAt:T0});
  assert.equal(m.sourceEvidence(source).eventDate,null);
  const serialized=JSON.stringify(m.sourceEvidence(source));
  assert.ok(!serialized.includes('record_date')); assert.ok(!serialized.includes('1900-01-01'));
});
test('refresh-only binding changes preserve the customer-event clock',()=>{
  const {result}=advance(graph(),graph(row({record_date:'2026-09-22T12:00:00Z'})));
  assert.equal(result.customerEligibleReceipts.length,0);
  assert.equal(result.materialityMetrics.refreshOnlyCount,1);
  assert.equal(result.ledger.entries['CAMIS:59980001'].lastCustomerEventAt,null);
});
test('unchanged normalized facts are stable despite observation metadata changes',()=>{
  const g=graph(),next=clone(g); next.candidates[0].primaryRecord.observedAt=T1;
  next.candidates[0].primaryRecord.sourceObservationId='ANOTHER-RECEIPT';
  assert.equal(m.describe(g.candidates[0]).fingerprint,m.describe(next.candidates[0]).fingerprint);
});
test('generated ProjectSignal and raw-record hashes do not define commercial materiality',()=>{
  const g=graph(),next=clone(g); next.candidates[0].projectSignal.signalId='PS:REHASH';
  next.candidates[0].primaryRecord.sourceRecordId='DOHMH:DIFFERENT-GENERATED-HASH';
  assert.equal(m.describe(g.candidates[0]).fingerprint,m.describe(next.candidates[0]).fingerprint);
});
test('violation-row reordering and grade corrections are not new opening events',()=>{
  const initial=row({inspection_date:'2026-09-20T00:00:00.000',inspection_type:'Pre-permit (Operational) / Initial Inspection',action:'Violations were cited.',violation_code:'01A',score:12});
  const {result}=advance(graph(initial),graph({...initial,record_date:'2026-09-22T12:00:00Z',violation_code:'02B',score:10,grade:'A'}));
  assert.equal(result.customerEligibleReceipts.length,0);
});
test('new actual inspection date produces a material event',()=>{
  const inspected=row({inspection_date:'2026-09-20T00:00:00.000',inspection_type:'Pre-permit (Operational) / Initial Inspection'});
  const {result}=advance(graph(inspected),graph({...inspected,inspection_date:'2026-09-22T00:00:00.000'}));
  assert.equal(result.customerEligibleReceipts.length,1);
  assert.ok(result.customerEligibleReceipts[0].changeReasons.includes('EVIDENCE_CHANGED'));
});
test('accepted SLA status change under the same application ID invalidates old bindings',()=>{
  const first=graph(row(),[sla()]),second=graph(row(),[sla({status:'Under review'})]);
  assert.notEqual(first.graphDigest,second.graphDigest);
  assert.notEqual(delivery.candidateChangeFingerprint(first.candidates[0]),delivery.candidateChangeFingerprint(second.candidates[0]));
  const {result}=advance(first,second);
  assert.equal(result.customerEligibleReceipts.length,1);
  assert.ok(result.customerEligibleReceipts[0].changeReasons.includes('EVIDENCE_CHANGED'));
});
test('accepted DOB cost change under the same filing ID remains visible',()=>{
  const {result}=advance(graph(row(),[],[dob()],true),graph(row(),[],[dob({initial_cost:'$175,000'})],true));
  assert.equal(result.customerEligibleReceipts.length,1);
});
test('accepted DOB scope changes are not hidden by an unchanged filing ID',()=>{
  const {result}=advance(graph(row(),[],[dob()],true),graph(row(),[],[dob({job_description:'Restaurant commercial kitchen buildout and structural work'})],true));
  assert.equal(result.customerEligibleReceipts.length,1);
});
test('equivalent numeric formatting is not a new cost change',()=>{
  const {result}=advance(graph(row(),[],[dob()],true),graph(row(),[],[dob({initial_cost:100000})],true));
  assert.equal(result.customerEligibleReceipts.length,0);
});
test('rejected co-located DOB changes cannot create a customer event',()=>{
  const {result}=advance(graph(row(),[],[dob()]),graph(row(),[],[dob({job_description:'Commercial kitchen hood fire suppression',initial_cost:'$500,000'})]));
  assert.equal(result.customerEligibleReceipts.length,0);
});
test('loss of accepted evidence from a rolling window is review, not closure/reopen',()=>{
  const {result}=advance(graph(row(),[sla()]),graph());
  assert.equal(result.customerEligibleReceipts.length,0);
  assert.ok(result.reviewReceipts[0].changeReasons.includes('CORROBORATION_LEFT_WINDOW'));
});
for(const [name,change] of [['name',{dba:'Different Business Name'}],['address',{building:'11'}],['borough',{boro:'Queens'}]]) {
  test(name+' correction requires review rather than an inferred new business',()=>{
    const {result}=advance(graph(),graph(row(change)));
    assert.equal(result.customerEligibleReceipts.length,0);
    assert.equal(result.reviewReceipts.length,1);
  });
}
test('new suppression blocks customer changes even when other evidence changes',()=>{
  const first=graph(),second=clone(first);
  second.graphDigest='synthetic-new-graph'; second.candidates[0].deliverySuppressed=true;
  second.candidates[0].suppressionReasons=['IDENTITY_CONFLICT'];
  const {result}=advance(first,second);
  assert.equal(result.customerEligibleReceipts.length,0);
  assert.ok(result.reviewReceipts[0].changeReasons.includes('SUPPRESSION_CHANGED'));
});
test('legacy migration creates no customer leads and preserves historical clocks',()=>{
  const g=graph(),old=oldLedger(g),id=g.candidates[0].entityId;
  old.entries[id].lastCustomerEventAt=T0; old.entries[id].lastCustomerEventClass='NEW_ENTITY';
  old.entries[id].entryFingerprint=d.entryFingerprint(old.entries[id]);old.ledgerFingerprint=d.ledgerFingerprint(old);
  const before=JSON.stringify(old),result=d.advanceDetectionLedger(old,g,T1);
  assert.equal(result.committed,true);assert.equal(result.customerEligibleReceipts.length,0);
  assert.equal(result.materialityMetrics.migratedCount,1);
  assert.equal(result.reviewReceipts[0].detectionClass,'MATERIALITY_MIGRATION_REVIEW');
  assert.equal(result.ledger.initializedAt,old.initializedAt);
  assert.equal(result.ledger.entries[id].firstObservedAt,old.entries[id].firstObservedAt);
  assert.equal(result.ledger.entries[id].lastCustomerEventAt,T0);
  assert.equal(result.ledger.entries[id].lastReviewReceipt.receiptId,result.reviewReceipts[0].receiptId);
  assert.equal(JSON.stringify(old),before);
});
test('migration cannot backdate a genuine intervening change as new; it records review',()=>{
  const first=graph(),second=graph(row({inspection_date:'2026-09-22T10:00:00.000',inspection_type:'Pre-permit (Operational) / Initial Inspection'}));
  const result=d.advanceDetectionLedger(oldLedger(first),second,T1);
  assert.equal(result.customerEligibleReceipts.length,0);
  assert.ok(result.reviewReceipts[0].changeReasons.includes('NO_HISTORICAL_SEMANTIC_SNAPSHOT'));
});
test('post-migration real changes are delivered once and then remain stable',()=>{
  const g=graph(),migrated=d.advanceDetectionLedger(oldLedger(g),g,T1);
  const next=graph(row({inspection_date:'2026-09-23T10:00:00.000',inspection_type:'Pre-permit (Operational) / Initial Inspection'}));
  const detected=d.advanceDetectionLedger(migrated.ledger,next,T2);
  assert.equal(detected.customerEligibleReceipts.length,1);
  const replay=d.advanceDetectionLedger(detected.ledger,next,'2026-09-24T13:00:00Z');
  assert.equal(replay.customerEligibleReceipts.length,0);
});
test('partial source windows cannot advance either migration or customer history',()=>{
  const g=graph(),old=oldLedger(g),partial={...g,graphState:'PARTIAL'};
  const result=d.advanceDetectionLedger(old,partial,T1);
  assert.equal(result.committed,false);assert.equal(result.ledger.ledgerFingerprint,old.ledgerFingerprint);
});
test('missing ledger fingerprint is not a trusted migration baseline',()=>{
  const g=graph(),old=oldLedger(g); delete old.ledgerFingerprint;
  const result=d.advanceDetectionLedger(old,g,T1);
  assert.equal(result.committed,false);assert.ok(result.errors.includes('LEDGER_FINGERPRINT_REQUIRED'));
});
test('tampered semantic descriptor fails even if only the outer ledger hash is recomputed',()=>{
  const g=graph(),old=d.bootstrapLedger(g,T0).ledger;
  old.entries[g.candidates[0].entityId].materiality.parts.evidence='0'.repeat(64);
  old.ledgerFingerprint=d.ledgerFingerprint(old);
  const result=d.advanceDetectionLedger(old,g,T1);
  assert.equal(result.committed,false);assert.ok(result.errors.includes('LEDGER_MATERIALITY_INVALID'));
});
test('a corrupt uninitialized ledger cannot silently erase existing entries',()=>{
  const g=graph(),old=oldLedger(g); old.initializedAt=null;
  const result=d.advanceDetectionLedger(old,g,T1);
  assert.equal(result.committed,false);assert.ok(result.errors.includes('UNINITIALIZED_LEDGER_HAS_ENTRIES'));
});
test('an older observation cannot roll the ledger backward',()=>{
  const g=graph(),old=d.bootstrapLedger(g,T1).ledger;
  assert.equal(d.advanceDetectionLedger(old,g,T0).reason,'NON_MONOTONIC_OBSERVATION');
});
test('semantic record ordering and duplicate evidence do not affect materiality',()=>{
  const g=graph(row(),[sla()],[dob()],true),c=g.candidates[0],other=clone(c);
  other.projectSignal.materialEvidence.reverse();
  other.projectSignal.materialEvidence.push(clone(other.projectSignal.materialEvidence[0]));
  assert.equal(m.describe(c).fingerprint,m.describe(other).fingerprint);
});
test('new unknown entities still enter as NEW_ENTITY after an established baseline',()=>{
  const g=graph(),old=d.bootstrapLedger(g,T0).ledger;
  const next=graph(row({camis:'59980002'}));
  const result=d.advanceDetectionLedger(old,next,T1);
  assert.equal(result.customerEligibleReceipts.length,1);
  assert.equal(result.customerEligibleReceipts[0].detectionClass,'NEW_ENTITY');
});
test('bulk 4104-candidate extraction refresh yields zero customer events',()=>{
  const rows=Array.from({length:4104},(_,i)=>row({camis:String(59000000+i),building:String(i+1),dba:'Synthetic Cafe '+i}));
  function bulk(date) {
    return b.buildCurrentGraph({dohmhBatch:batch(rows.map(value=>a.normalizeDohmhRow({...value,record_date:date},{observedAt:date}))),slaBatch:batch([]),dobBatch:batch([])});
  }
  const first=bulk('2026-09-21T12:00:00Z'),second=bulk('2026-09-22T12:00:00Z');
  const {result}=advance(first,second);
  assert.equal(result.customerEligibleReceipts.length,0);
  assert.equal(result.materialityMetrics.refreshOnlyCount,4104);
  assert.equal(Object.keys(result.ledger.entries).length,4104);
  console.log(JSON.stringify({test:'synthetic-extract-refresh',candidates:4104,customerEvents:0,refreshOnly:result.materialityMetrics.refreshOnlyCount}));
});
