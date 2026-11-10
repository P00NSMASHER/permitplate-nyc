'use strict';
// All reviewer identities, labels, and sources below are synthetic regression
// fixtures, NEVER genuine expert review or scoring authorization evidence.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const c=require('./calibration-cohort');
const progress=require('./calibration-review-progress');
const {renderWorkbench}=require('./calibration-workbench');
const runner=require('./calibration-runner');

const observedAt='2026-09-20T12:00:00.000Z';
const reviewedAt='2026-09-20T13:00:00.000Z';
const batch=records=>({records,observation:{
  state:records.length?'COMPLETE_NONEMPTY':'VERIFIED_EMPTY',
  supportsPositiveObservation:records.length>0,supportsAbsenceConclusion:true
}});
const raw=Array.from({length:105},(_,i)=>adapters.normalizeDohmhRow({
  camis:String(58812000+i),dba:'Synthetic Sample Restaurant '+i,
  building:String(10+i),street:'REGRESSION ONLY AVE',
  boro:'Manhattan',zipcode:'10001',cuisine_description:'Coffee/Tea',
  inspection_date:'1900-01-01T00:00:00.000',
  record_date:'2026-09-20T00:00:00.000'
},{observedAt}));
const batches={DOHMH:batch(raw),DOB_NOW:batch([]),SLA_PENDING:batch([])};
const graph=builder.buildCurrentGraph({
  dohmhBatch:batches.DOHMH,dobBatch:batches.DOB_NOW,slaBatch:batches.SLA_PENDING
});
const original=c.buildCohort({
  graph,batches,observedAt,sourceRevision:'a'.repeat(40),
  codeHashes:{"source.js":'a'.repeat(64),"scorer.js":'b'.repeat(64),"reviewer.js":'c'.repeat(64)},
  isSynthetic:true,categories:['Equipment'],benchmarkSize:100,diagnosticSize:0
});
// Simulated non-synthetic metadata only to exercise structural contract.
// Replacing isSynthetic cannot authenticate a real reviewer or human labels.
const {fingerprint,...body}=original;
const structurallyValidShape=c.sealed({...body,isSynthetic:false});
function mockReview(id,overrides={}){
  const p=c.blindPacket(structurallyValidShape);
  const judgments=p.cards.map(card=>({
    caseId:card.caseId,category:'Equipment',
    evidenceFingerprint:card.evidenceFingerprint,
    verdict:'PURSUE_NOW',
    reason:'Synthetic fixture research claim with source evidence cited.',
    evidenceRefs:[card.evidence[0].recordId],reviewedAt
  }));
  return {
    version:c.VERSION,phase:'TUNING',
    cohortFingerprint:structurallyValidShape.fingerprint,
    packetFingerprint:p.fingerprint,lockFingerprint:p.lockFingerprint,
    reviewerId:id,reviewerRole:'INDEPENDENT_DOMAIN_REVIEWER',
    attestation:'INDEPENDENT_HUMAN_SOURCE_REVIEW',
    blinded:true,isSynthetic:false,draft:false,judgments,...overrides
  };
}
test('actual zero-label state explicitly blocks customer scoring and names the two-reviewer gap',()=>{
  const r=progress.evaluateReviewProgress(structurallyValidShape,[]);
  assert.equal(r.status,'AWAITING_INDEPENDENT_REVIEW_EXPORTS');
  assert.equal(r.reviewerCodesReceived,0);
  assert.equal(r.reviewerCodesRequired,2);
  assert.deepEqual(r.inputFailures,[]);
  assert.equal(r.categories.Equipment.tuningCases,70);
  assert.equal(r.categories.Equipment.missingCases,70);
  assert.equal(r.structurallyCompleteNotAuthenticated,false);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.customerDeliveryAllowed,false);
  assert.equal(r.holdoutReleased,false);
  assert.equal(r.thresholdLocked,false);
  assert.equal(r.externalSendCalls,0);
  assert.equal(c.verify(r),true);
});
test('incomplete real-review-shaped exports do not pass and remain separate from drafts',()=>{
  const one=mockReview('synthetic-alpha');
  const r=progress.evaluateReviewProgress(structurallyValidShape,[one]);
  assert.equal(r.status,'AWAITING_INDEPENDENT_REVIEW_EXPORTS');
  assert.equal(r.reviewerCodesReceived,1);
  assert.equal(r.categories.Equipment.missingCases,70,'one judgment is never two independent labels');
  assert.equal(r.reviewerInputCounts[0].submittedJudgments,70);
  assert.equal(r.productionAuthorized,false);
  const partial=mockReview('synthetic-beta',{judgments:one.judgments.slice(0,5)});
  const p=progress.evaluateReviewProgress(structurallyValidShape,[one,partial]);
  assert.equal(p.status,'INCOMPLETE_OR_DISAGREED_SOURCE_REVIEWS');
  assert.equal(p.categories.Equipment.missingCases,65);
  assert.equal(p.productionAuthorized,false);
});
test('even two complete declarations only permit MANUAL identity check, not score or delivery',()=>{
  const r=progress.evaluateReviewProgress(structurallyValidShape,[
    mockReview('synthetic-alpha'),mockReview('synthetic-beta')
  ]);
  assert.equal(r.status,'STRUCTURALLY_COMPLETE_MANUAL_IDENTITY_VERIFICATION_REQUIRED');
  assert.equal(r.structurallyCompleteNotAuthenticated,true);
  assert.equal(r.reviewerIdentityIndependenceAuthenticated,false);
  assert.equal(r.categories.Equipment.acceptedConsensusCases,70);
  assert.equal(r.categories.Equipment.disagreementCases,0);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.customerDeliveryAllowed,false);
  assert.equal(r.holdoutReleased,false);
  assert.equal(r.thresholdLocked,false);
  assert.equal(r.externalSendCalls,0);
  assert.equal(JSON.stringify(r).includes('synthetic-alpha'),false);
  assert.equal(JSON.stringify(r).includes('PURSUE_NOW'),false);
  assert.equal(JSON.stringify(r).includes('caseId'),false);
});
test('draft reviews are never accepted even if all synthetic labels happen to be complete',()=>{
  const r=progress.evaluateReviewProgress(structurallyValidShape,[
    mockReview('synthetic-alpha'),
    mockReview('synthetic-beta',{
      draft:true,attestation:'DRAFT_NOT_ATTESTED'
    })
  ]);
  assert.equal(r.status,'INVALID_OR_DRAFT_REVIEW_INPUT');
  assert(r.inputFailures.includes('DRAFT_REVIEW_NOT_ACCEPTED'));
  assert.equal(r.reviewerCodesReceived,1);
  assert.equal(r.structurallyCompleteNotAuthenticated,false);
  assert.equal(r.productionAuthorized,false);
});
test('wrong source packet, duplicate reviewer code and disagreement block',()=>{
  const a=mockReview('synthetic-alpha');
  const wrong=mockReview('synthetic-beta',{packetFingerprint:'wrong'});
  const invalid=progress.evaluateReviewProgress(structurallyValidShape,[a,wrong]);
  assert(invalid.inputFailures.includes('REVIEW_PACKET_BINDING_INVALID'));
  const duplicate=progress.evaluateReviewProgress(structurallyValidShape,[a,mockReview('synthetic-alpha')]);
  assert(duplicate.inputFailures.includes('REVIEWER_ID_INVALID_OR_DUPLICATE'));
  const conflicting=mockReview('synthetic-beta');
  conflicting.judgments[0].verdict='WATCH';
  const disagreement=progress.evaluateReviewProgress(structurallyValidShape,[a,conflicting]);
  assert.equal(disagreement.status,'INCOMPLETE_OR_DISAGREED_SOURCE_REVIEWS');
  assert.equal(disagreement.categories.Equipment.disagreementCases,1);
  assert.equal(disagreement.structurallyCompleteNotAuthenticated,false);
});
test('a test cohort never acquires reviewer authority from two synthetic declarations',()=>{
  const shape=c.blindPacket(original);
  const template=mockReview('synthetic-alpha');
  const p=progress.evaluateReviewProgress(original,[{
    ...template,cohortFingerprint:original.fingerprint,packetFingerprint:shape.fingerprint,
    isSynthetic:true
  }]);
  assert.equal(p.status,'SYNTHETIC_COHORT_INELIGIBLE');
  assert.equal(p.productionAuthorized,false);
});
test('offline workbench clearly separates saveable drafts from complete attested final export',()=>{
  const html=renderWorkbench(c.blindPacket(structurallyValidShape));
  assert(html.includes('id="saveDraft"'));
  assert(html.includes('Save progress draft'));
  assert(html.includes('Final review blocked:'));
  assert(html.includes('judgments.length!==expected'));
  assert(html.includes("draft?'DRAFT_NOT_ATTESTED'"));
  assert(html.includes('el(\'saveDraft\').onclick=()=>exportReview(true)'));
  assert(!html.includes('localStorage'));
  assert(!html.includes('fetch('));
  assert(!html.includes('productionAuthorized:true'));
  assert(!html.includes('HOLDOUT'));
});
test('read-only CLI status reports no labels without writing production or local artifacts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-review-progress-'));
  try{
    const file=path.join(dir,'cohort.json');
    fs.writeFileSync(file,JSON.stringify(original));
    const before=fs.readdirSync(dir);
    const result=spawnSync(process.execPath,[path.join(__dirname,'calibration-runner.js'),'status',file],{
      encoding:'utf8',timeout:10000
    });
    assert.equal(result.status,0,result.stderr);
    const status=JSON.parse(result.stdout);
    assert.equal(status.status,'SYNTHETIC_COHORT_INELIGIBLE');
    assert.equal(status.productionAuthorized,false);
    assert.equal(status.customerDeliveryAllowed,false);
    assert.deepEqual(fs.readdirSync(dir),before,'status must not create files');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new progress logic is hash-pinned with the source and protocol',()=>{
  assert(runner.INPUT_FILES.includes('pipeline/calibration-review-progress.js'));
  assert.equal(c.PROTOCOL.minimumTuningCases,50);
  assert.equal(c.PROTOCOL.minimumHoldoutCases,30);
  assert.equal(c.PROTOCOL.minimumSelected,20);
  assert.equal(c.PROTOCOL.minimumPrecision,0.8);
  assert.equal(c.PROTOCOL.minimumReviewerAgreement,0.8);
  assert.equal(c.PROTOCOL.automaticPromotion,false);
});
