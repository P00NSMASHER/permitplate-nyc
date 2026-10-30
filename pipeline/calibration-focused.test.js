'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runner=require('./calibration-runner');
const cohort=require('./calibration-cohort');
const evaluator=require('./calibration-evaluation');
test('focused Equipment packet reduces human review burden without weakening protocol',()=>{
  const scope=runner.calibrationScope('Equipment');
  assert.deepEqual(scope.categories,['Equipment']);
  assert.equal(scope.benchmarkSize,100);
  assert.equal(scope.diagnosticSize,0);
  assert.equal(scope.scope,'ONE_CATEGORY_INDEPENDENT_REVIEW');
  assert.equal(cohort.PROTOCOL.minimumTuningCases,50);
  assert.equal(cohort.PROTOCOL.minimumHoldoutCases,30);
  assert.equal(cohort.PROTOCOL.minimumSelected,20);
  assert.equal(cohort.PROTOCOL.minimumPrecision,0.8);
  assert.equal(cohort.PROTOCOL.minimumReviewerAgreement,0.8);
  assert.equal(cohort.PROTOCOL.automaticPromotion,false);
  assert.deepEqual(evaluator.REVIEWER_ROLES,[
    'VENDOR_DOMAIN_REVIEWER','INDEPENDENT_DOMAIN_REVIEWER','FOUNDER_DOMAIN_REVIEWER'
  ]);
});
test('original mixed-category cohort remains available unchanged',()=>{
  const c=runner.calibrationScope();
  assert.deepEqual(c.categories,['POS','Insurance','Equipment']);
  assert.equal(c.benchmarkSize,100);
  assert.equal(c.diagnosticSize,24);
  assert.equal(c.scope,'MULTI_CATEGORY_DIAGNOSTIC');
});
test('arbitrary category cannot silently reframe review acceptance',()=>{
  for(const input of ['Equipment and POS','Purchases','Hood/Fire','equipment',
    'All',0,[],{},''] ){
    if(input===''){assert.equal(runner.calibrationScope('').categories.length,3);continue;}
    assert.throws(()=>runner.calibrationScope(input),/FOCUSED_CATEGORY_NOT_AUTHORIZED/);
  }
});
test('holdout stays sealed until a genuine independent review threshold lock',()=>{
  assert.throws(()=>cohort.blindPacket(null,'HOLDOUT',null));
  assert.equal(cohort.PROTOCOL.currentDefaultThreshold,60);
  assert.equal(cohort.PROTOCOL.target,'EVIDENCE_JUSTIFIES_VENDOR_RESEARCH_NOW_NOT_PURCHASE_PROBABILITY');
});
