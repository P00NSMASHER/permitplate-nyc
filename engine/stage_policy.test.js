'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {STAGES,strongestStage,applyStageCeiling,applyKnownKokeRegression}=require('./stage_policy');

test('current DOHMH filing supports JUST_FILED',()=>{
  assert.equal(strongestStage({currentFiling:true}),STAGES.JUST_FILED);
});

test('validated SLA or DOB may support BUILDOUT_LICENSING',()=>{
  assert.equal(strongestStage({currentFiling:true,validatedSlaLicensing:true}),STAGES.BUILDOUT_LICENSING);
  assert.equal(strongestStage({currentFiling:true,validatedDobHospitalityBuildout:true}),STAGES.BUILDOUT_LICENSING);
});

test('HEALTH_PRE_PERMIT requires actual current-CAMIS pre-permit',()=>{
  assert.equal(strongestStage({currentFiling:true,currentCamisPrePermit:true}),STAGES.HEALTH_PRE_PERMIT);
  assert.notEqual(strongestStage({currentFiling:true,aggregatePrePermitCount:100}),STAGES.HEALTH_PRE_PERMIT);
});

test('source count alone cannot manufacture near-opening',()=>{
  assert.notEqual(strongestStage({currentFiling:true,multiSource:true,sourceCount:3}),STAGES.NEAR_OPENING);
  assert.equal(strongestStage({currentFiling:true,explicitNearOpeningEvidence:true}),STAGES.NEAR_OPENING);
});

test('unmatched shared-site/predecessor evidence cannot advance stage',()=>{
  assert.equal(applyStageCeiling(STAGES.JUST_FILED,STAGES.BUILDOUT_LICENSING,{sharedSiteUnmatchedDob:true}),STAGES.JUST_FILED);
  assert.equal(applyStageCeiling(STAGES.JUST_FILED,STAGES.HEALTH_PRE_PERMIT,{predecessorEvidenceOnly:true}),STAGES.JUST_FILED);
});

test('known KOKE predecessor regression is pinned to suppressed audit-only state',()=>{
  const fixed=applyKnownKokeRegression({
    camis:'50192488',
    predecessor:{camis:'50184059'},
    stage:STAGES.NEAR_OPENING,
    confidence:'HIGH',
    sourceMode:'MULTI',
    bestScore:100,
    purchaseWindow:'NOW',
    deliverySuppressed:false,
  });
  assert.equal(fixed.stage,STAGES.JUST_FILED);
  assert.equal(fixed.confidence,'LOW');
  assert.equal(fixed.sourceMode,'DOHMH_ONLY');
  assert.equal(fixed.bestScore,28);
  assert.equal(fixed.purchaseWindow,'SUPPRESSED');
  assert.equal(fixed.deliverySuppressed,true);
  assert.equal(fixed.predecessorEvidenceRole,'SUPPRESSION_ONLY');
});
