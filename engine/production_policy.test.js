'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyVerticalEvidenceCeiling,sharedSiteContribution}=require('./production_policy');

test('generic corroboration cannot push Equipment above max POS/Insurance',()=>{
  const out=applyVerticalEvidenceCeiling({POS:84,Insurance:72,Equipment:97,HoodFire:92},{genericRestaurant:true,multiSource:true});
  assert.equal(out.Equipment,84);
  assert.equal(out.HoodFire,84);
});

test('direct category DOB scope allows Equipment/HoodFire to outrank baseline',()=>{
  const out=applyVerticalEvidenceCeiling({POS:70,Insurance:60,Equipment:96,HoodFire:91},{directCategoryDobScope:true});
  assert.equal(out.Equipment,96);
  assert.equal(out.HoodFire,91);
});

test('explicit hot-food specialist evidence also opens ceiling',()=>{
  const out=applyVerticalEvidenceCeiling({POS:70,Insurance:65,Equipment:88,HoodFire:90},{explicitHotFoodSpecialist:true});
  assert.equal(out.HoodFire,90);
});

test('shared building/address without identity contributes zero',()=>{
  assert.deepEqual(sharedSiteContribution({stageDelta:2,scoreDelta:20,sourceCountDelta:1,confidenceDelta:1}),{
    stageDelta:0,scoreDelta:0,sourceCountDelta:0,confidenceDelta:0,accepted:false
  });
});

test('matching unit or operator identity may contribute',()=>{
  const out=sharedSiteContribution({matchingUnit:true,stageDelta:1,scoreDelta:8,sourceCountDelta:1,confidenceDelta:1});
  assert.equal(out.accepted,true);
  assert.equal(out.scoreDelta,8);
});
