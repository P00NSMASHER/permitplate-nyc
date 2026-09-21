'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const adapters=require('./source-adapters'),builder=require('./candidate-builder');
const c=require('./calibration-cohort'),e=require('./calibration-evaluation');
const {renderWorkbench}=require('./calibration-workbench');
const clock=require('./event-time');
const OBS='2026-09-20T12:00:00.000Z',REVIEW='2026-09-20T13:00:00.000Z',LOCK='2026-09-20T14:00:00.000Z',HELD='2026-09-20T15:00:00.000Z';
const CODE={'a.js':'a'.repeat(64),'b.js':'b'.repeat(64),'c.js':'c'.repeat(64)};
function fixture(n=140,options={}){
  const records=Array.from({length:n},(_,i)=>adapters.normalizeDohmhRow({
    camis:String(59900000+i),dba:'Synthetic Calibration Cafe '+i,building:String(100+i),street:'SYNTHETIC AVE',boro:'Manhattan',zipcode:'10001',
    phone:'555-0100',cuisine_description:'Coffee/Tea',inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-20T00:00:00.000'
  },{observedAt:OBS}));
  const batch=r=>({records:r,observation:{state:r.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',supportsPositiveObservation:!!r.length,supportsAbsenceConclusion:true}});
  const batches={DOHMH:batch(records),SLA_PENDING:batch([]),DOB_NOW:batch([])};
  const graph=builder.buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW});
  if(options.sharedSite)graph.candidates[1].address=graph.candidates[0].address;
  if(options.suppress)graph.candidates[2].deliverySuppressed=true;
  return {graph,batches,observedAt:OBS,sourceRevision:'a'.repeat(40),codeHashes:CODE,isSynthetic:true,...options};
}
const realShape=()=>c.sealed((({fingerprint,...body})=>({...body,isSynthetic:false}))(c.buildCohort(fixture())));
// ALL reviewer data in this test file are synthetic declarations exercising the
// contract, never collected customer judgments or evidence of reviewer identity.
function mockReviews(cohort,phase='TUNING',lock=null,verdict='PURSUE_NOW'){
  const p=c.blindPacket(cohort,phase,lock);
  return ['synthetic-reviewer-one','synthetic-reviewer-two'].map(reviewerId=>({
    version:c.VERSION,phase,cohortFingerprint:cohort.fingerprint,packetFingerprint:p.fingerprint,
    lockFingerprint:p.lockFingerprint,reviewerId,reviewerRole:'VENDOR_DOMAIN_REVIEWER',
    attestation:'INDEPENDENT_HUMAN_SOURCE_REVIEW',blinded:true,isSynthetic:false,
    judgments:p.cards.flatMap(card=>cohort.categories.map(category=>({caseId:card.caseId,category,
      evidenceFingerprint:card.evidenceFingerprint,verdict,reason:'Synthetic fixture, not a real buyer judgment.',
      evidenceRefs:[card.evidence[0].recordId],reviewedAt:phase==='HOLDOUT'?HELD:REVIEW})))
  }));
}
function reseal(value){const {fingerprint,...body}=value;return c.sealed(body);}

test('snapshot cohort has 70 tuning, 30 holdout and 24 diagnostic cases',()=>{
  const cohort=c.buildCohort(fixture());
  assert.deepEqual(cohort.counts,{graphCandidates:140,eligibleCandidates:140,eligibleSiteGroups:140,benchmark:100,holdout:30,tuning:70,diagnostic:24});
  assert.equal(cohort.productionAuthorized,false);assert.equal(cohort.transportMode,'NO_SEND');assert.equal(c.verify(cohort),true);
});
test('same inputs are deterministic',()=>{
  const a=c.buildCohort(fixture()),b=c.buildCohort(fixture());assert.equal(a.fingerprint,b.fingerprint);
});
test('source input order cannot change sample or split',()=>{
  const f=fixture();const a=c.buildCohort(f);f.graph.candidates.reverse();const b=c.buildCohort(f);
  assert.equal(a.fingerprint,b.fingerprint);
});
test('same premises are evaluated in only one split and only one selected case',()=>{
  const cohort=c.buildCohort(fixture(140,{sharedSite:true}));
  assert.equal(cohort.counts.eligibleSiteGroups,139);
  assert.equal(new Set(cohort.rows.map(r=>r.groupId)).size,cohort.rows.length);
});
test('normalizing a site is not an entity merge',()=>{
  assert.equal(c.siteKey({entityId:'x',borough:'manhattan',address:'  1   MAIN ST '}),c.siteKey({entityId:'y',borough:'MANHATTAN',address:'1 MAIN ST'}));
  assert.notEqual(c.siteKey({entityId:'x'}),c.siteKey({entityId:'y'}));
});
test('suppressed candidates cannot contaminate the benchmark or be threshold-selected',()=>{
  const cohort=c.buildCohort(fixture(140,{suppress:true}));assert.equal(cohort.counts.eligibleCandidates,139);
  assert.ok(cohort.rows.filter(r=>r.panel==='BENCHMARK').every(r=>r.eligible));
  assert.equal(e.metrics([{eligible:false,positive:true,predictions:{v4:{POS:100}}}],'POS','v4',0).selected,0);
});
test('incomplete source graph refuses calibration',()=>{
  const f=fixture();f.graph.graphState='PARTIAL';assert.throws(()=>c.buildCohort(f),/COMPLETE_GRAPH_REQUIRED/);
});
test('missing revision and hashes refuse unverifiable inputs',()=>{
  assert.throws(()=>c.buildCohort({...fixture(),sourceRevision:'main'}),/EXACT_SOURCE_REVISION_REQUIRED/);
  assert.throws(()=>c.buildCohort({...fixture(),codeHashes:{}}),/CODE_HASHES_REQUIRED/);
});
test('duplicate entity rows refuse a fake larger sample',()=>{
  const f=fixture();f.graph.candidates.push(f.graph.candidates[0]);assert.throws(()=>c.buildCohort(f),/ENTITY_ID_MISSING_OR_DUPLICATE/);
});
test('score, split and diagnostic buckets are absent from blinded cards',()=>{
  const p=c.blindPacket(c.buildCohort(fixture()));assert.equal(p.cards.length,94);
  for(const card of p.cards)for(const hidden of ['predictions','scores','split','panel','eligible','commercialFit','v3','v4'])assert.equal(hidden in card,false);
  assert.ok(p.cards.every(card=>!JSON.stringify(card).includes('555-0100')));
});
test('review evidence retains official source references and no private contacts',()=>{
  const r={sourceSystem:'DOHMH',sourceRecordId:'r',sourceUrl:'https://data.cityofnewyork.us/a',facts:{phone:'not retained',email:'not retained',inspection_date:'2026-09-01',cuisine_description:'Cafe'}};
  const card=c.sourceCard(r);assert.equal(card.facts.phone,undefined);assert.equal(card.facts.email,undefined);
  assert.equal(card.sourceUrl,r.sourceUrl);assert.equal(c.sourceCard({...r,sourceUrl:'https://thirdparty.example/a'}).sourceUrl,null);
});
test('fresh extraction cannot select a new random cohort via scores alone',()=>{
  const f=fixture();const a=c.buildCohort(f);
  for(const candidate of f.graph.candidates){candidate.sourceLatestEffectiveAt='2026-08-01T00:00:00Z';}
  const b=c.buildCohort(f);
  assert.deepEqual(a.rows.filter(r=>r.panel==='BENCHMARK').map(r=>[r.entityId,r.split]),b.rows.filter(r=>r.panel==='BENCHMARK').map(r=>[r.entityId,r.split]));
});
test('holdout is unavailable without a valid frozen threshold lock',()=>{
  const cohort=c.buildCohort(fixture());assert.throws(()=>c.blindPacket(cohort,'HOLDOUT'),/HOLDOUT_REQUIRES_THRESHOLD_LOCK/);
});
test('tampering with a cohort or evidence refuses review',()=>{
  const cohort=c.buildCohort(fixture());cohort.rows[0].card.businessName='changed';assert.throws(()=>c.validateCohort(cohort),/COHORT_INTEGRITY_INVALID/);
  assert.throws(()=>c.validateCohort(reseal(cohort)),/EVIDENCE_FINGERPRINT_MISMATCH/);
});
test('a site manually moved across splits is detected even after rehash',()=>{
  const cohort=c.buildCohort(fixture());const a=cohort.rows.find(r=>r.split==='TUNING'),b=cohort.rows.find(r=>r.split==='HOLDOUT');b.groupId=a.groupId;
  assert.throws(()=>c.validateCohort(reseal(cohort)),/SITE_SPLIT_LEAKAGE/);
});
test('zero buyer labels produces a real block, not a fabricated recommendation',()=>{
  const cohort=realShape(),result=e.lockThresholds(cohort,[],LOCK);
  assert.equal(result.status,'BLOCKED');assert.ok(result.failures.includes('TWO_INDEPENDENT_REVIEWERS_REQUIRED'));
  assert.equal(result.productionAuthorized,false);assert.ok(Object.values(result.categories).every(r=>r.threshold===null&&r.grid.length===0));
});
test('one reviewer is never independent consensus',()=>{
  const cohort=realShape(),result=e.lockThresholds(cohort,mockReviews(cohort).slice(0,1),LOCK);
  assert.equal(result.status,'BLOCKED');assert.equal(result.categories.POS.labelCoverage,0);
});
test('synthetic cohorts cannot produce genuine calibration',()=>{
  const cohort=c.buildCohort(fixture()),result=e.lockThresholds(cohort,mockReviews(cohort),LOCK);
  assert.ok(result.failures.includes('SYNTHETIC_COHORT_NOT_REAL_REVIEW'));assert.equal(result.productionAuthorized,false);
});
for(const [name,mutate,reason] of [
  ['machine-labeled judgments',r=>{r[0].reviewerRole='AUTOMATED';},'INDEPENDENT_HUMAN_REVIEW_REQUIRED'],
  ['synthetic labels',r=>{r[0].isSynthetic=true;},'INDEPENDENT_HUMAN_REVIEW_REQUIRED'],
  ['duplicate reviewer identities',r=>{r[1].reviewerId=r[0].reviewerId;},'REVIEWER_ID_INVALID_OR_DUPLICATE'],
  ['wrong packet',r=>{r[0].packetFingerprint='bad';},'REVIEW_PACKET_BINDING_INVALID'],
  ['score-exposed labels',r=>{r[0].blinded=false;},'INDEPENDENT_HUMAN_REVIEW_REQUIRED'],
  ['duplicate verdict',r=>{r[0].judgments.push(r[0].judgments[0]);},'DUPLICATE_REVIEWER_JUDGMENT'],
  ['unsupported category',r=>{r[0].judgments[0].category='Other';},'UNKNOWN_OR_WRONG_PHASE_CASE'],
  ['wrong source reference',r=>{r[0].judgments[0].evidenceRefs=['unrelated'];},'SOURCE_REFERENCE_REQUIRED'],
  ['no evidence reason',r=>{r[0].judgments[0].reason='';},'SOURCE_REASON_REQUIRED'],
  ['future timestamp',r=>{r[0].judgments[0].reviewedAt='2099-01-01T00:00:00Z';},'REVIEW_TIMESTAMP_INVALID']
])test(name+' is rejected',()=>{
  const cohort=realShape(),r=mockReviews(cohort);mutate(r);const result=e.lockThresholds(cohort,r,LOCK);
  assert.equal(result.status,'BLOCKED');assert.ok(result.failures.includes(reason));
});
test('disagreement is unresolved, never silently negative or a majority vote',()=>{
  const cohort=realShape(),r=mockReviews(cohort),target=r[0].judgments.find(j=>cohort.rows.find(x=>x.caseId===j.caseId).split==='TUNING');
  target.verdict='WATCH';const result=e.lockThresholds(cohort,r,LOCK);
  assert.equal(result.status,'BLOCKED');assert.equal(result.categories[target.category].disagreements,1);
});
test('watch and insufficient evidence are non-actionable, not confirmed buying intent',()=>{
  const cohort=realShape();
  for(const label of ['WATCH','NOT_RELEVANT','INSUFFICIENT_EVIDENCE']){
    const result=e.lockThresholds(cohort,mockReviews(cohort,'TUNING',null,label),LOCK);
    assert.equal(result.status,'BLOCKED');assert.ok(result.failures.includes('POS:NO_THRESHOLD_JUSTIFIED'));
  }
});
test('diagnostic labels cannot change chosen category thresholds',()=>{
  const cohort=realShape(),a=mockReviews(cohort),b=structuredClone(a),diagnostics=new Set(cohort.rows.filter(r=>r.panel==='DIAGNOSTIC').map(r=>r.caseId));
  b.forEach(r=>r.judgments.forEach(j=>{if(diagnostics.has(j.caseId))j.verdict='NOT_RELEVANT';}));
  const x=e.lockThresholds(cohort,a,LOCK),y=e.lockThresholds(cohort,b,LOCK);
  assert.deepEqual(x.categories,y.categories);assert.equal(x.status,'THRESHOLDS_LOCKED_NOT_PRODUCTION');
});
test('lock refuses future creation and cannot predate its tuning reviews',()=>{
  const cohort=realShape();assert.throws(()=>e.lockThresholds(cohort,[],'2099-01-01T00:00:00Z'),/LOCK_TIME_INVALID/);
  assert.ok(e.lockThresholds(cohort,mockReviews(cohort),'2026-09-20T12:30:00Z').failures.includes('LOCK_PREDATES_TUNING_REVIEW'));
});
test('holdout packet contains only unseen groups and no ranking fields',()=>{
  const cohort=realShape(),lock=e.lockThresholds(cohort,mockReviews(cohort),LOCK);
  const tune=c.blindPacket(cohort),hold=c.blindPacket(cohort,'HOLDOUT',lock);
  assert.equal(hold.cards.length,30);const ids=new Set(tune.cards.map(c=>c.caseId));assert.ok(hold.cards.every(c=>!ids.has(c.caseId)));
});
test('heldout labels cannot be presented as tuning labels',()=>{
  const cohort=realShape(),lock=e.lockThresholds(cohort,mockReviews(cohort),LOCK),r=mockReviews(cohort,'HOLDOUT',lock);
  assert.ok(e.lockThresholds(cohort,r,HELD).failures.includes('REVIEW_PACKET_BINDING_INVALID'));
});
test('perfect fixture holdout only allows manual review, never promotion',()=>{
  const cohort=realShape(),lock=e.lockThresholds(cohort,mockReviews(cohort),LOCK);
  const result=e.evaluateHoldout(cohort,lock,mockReviews(cohort,'HOLDOUT',lock));
  assert.equal(result.status,'ELIGIBLE_FOR_MANUAL_REVIEW_ONLY');assert.equal(result.productionAuthorized,false);
  assert.ok(result.remainingGates.includes('ACTUAL_LONGITUDINAL_REFRESH_EVIDENCE'));
  assert.ok(Object.values(result.categories).every(c=>c.metrics.n===30&&c.metrics.precision===1));
});
test('empty or negative holdout cannot pass or request a different threshold',()=>{
  const cohort=realShape(),lock=e.lockThresholds(cohort,mockReviews(cohort),LOCK);
  assert.equal(e.evaluateHoldout(cohort,lock,[]).status,'HOLDOUT_BLOCKED_OR_FAILED');
  const result=e.evaluateHoldout(cohort,lock,mockReviews(cohort,'HOLDOUT',lock,'WATCH'));
  assert.equal(result.status,'HOLDOUT_BLOCKED_OR_FAILED');assert.ok(Object.values(result.categories).every(r=>!('grid' in r)));
  assert.equal(result.categories.POS.threshold,lock.categories.POS.threshold);
});
test('holdout labels reviewed before threshold locking are rejected',()=>{
  const cohort=realShape(),lock=e.lockThresholds(cohort,mockReviews(cohort),LOCK),r=mockReviews(cohort,'HOLDOUT',lock);
  r[0].judgments[0].reviewedAt=REVIEW;assert.ok(e.evaluateHoldout(cohort,lock,r).failures.includes('HOLDOUT_REVIEW_PREDATES_LOCK'));
});
test('Wilson support prevents high confidence from two favorable examples',()=>{
  assert.equal(e.wilsonLower(0,0),null);assert.ok(e.wilsonLower(2,2)<0.35);assert.ok(e.wilsonLower(20,20)>0.83);
  assert.equal(e.passes({selected:2,precision:1,precisionWilsonLower95:e.wilsonLower(2,2)}),false);
});
test('empty selections and absence of positives are explicit null rates',()=>{
  const r=e.metrics([{eligible:true,positive:false,predictions:{v4:{POS:40}}}],'POS','v4',60);
  assert.equal(r.precision,null);assert.equal(r.recall,null);assert.equal(r.precisionWilsonLower95,null);
  assert.throws(()=>e.metrics([{eligible:true,positive:false,predictions:{v4:{POS:null}}}],'POS','v4',60),/SCORE_INVALID/);
});
test('workbench has no transport or hidden predictions and safely embeds hostile source text',()=>{
  const cohort=c.buildCohort(fixture());const row=cohort.rows.find(r=>r.split==='TUNING');
  row.card.businessName='</script><script>alert(1)</script>';row.evidenceFingerprint=c.hash(row.card);
  const packet=c.blindPacket(reseal(cohort)),html=renderWorkbench(packet);
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('\\u003c/script\\u003e'));assert.ok(html.includes("connect-src 'none'"));
  assert.ok(!html.includes('fetch('));assert.ok(!html.includes('localStorage'));assert.ok(!html.includes('predictions'));
  assert.ok(!html.includes(cohort.rows.find(r=>r.split==='HOLDOUT').caseId));
});
test('fresh review workbench has no prefilled judgments',()=>{
  const html=renderWorkbench(c.blindPacket(c.buildCohort(fixture())));
  assert.ok(html.includes('const answers=new Map()'));assert.ok(!html.includes('checked="checked"'));
});
test('new tooling does not alter frozen production source files',()=>{
  const names=['scoring-policy.js','shadow-scoring-v3.js','canonical-score-receipt.js'];
  assert.equal(require('./scoring-policy').PRODUCTION_SCORING_MODE,'CANONICAL_V3_WITH_LEGACY_FALLBACK');
  assert.equal(require('./shadow-scoring-v4').SHADOW_SCORING_VERSION,'permitplate-shadow-score-v4-event-time-2026-09-21');
  for(const name of names)assert.ok(!fs.readFileSync(path.join(__dirname,name),'utf8').includes('calibration-'));
});
