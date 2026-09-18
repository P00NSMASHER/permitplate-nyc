'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {computeScores,selectBestVendor}=require('./scoring');

function base(overrides={}){
  return {
    commercialFit:'HIGH',
    materialAgeDays:2,
    sourceCount:1,
    publicPhone:true,
    stageNumber:1,
    sources:['DOHMH'],
    conceptText:'Cafe',
    knownCuisineType:true,
    actualDohmhPrePermit:false,
    strictVenueLinkedHospitalityDob:false,
    buildingLevelUnmatchedDob:false,
    dobInitialCost:0,
    dobJobDescription:'',
    dobWorkTypes:[],
    ...overrides,
  };
}

test('base score math follows exact production components',()=>{
  const s=computeScores(base());
  // common=20 fit +15 recency +0 corroboration +5 phone =40
  assert.equal(s.POS,68); // +28 stage
  assert.equal(s.Insurance,65);
  assert.equal(s.Waste,52);
  assert.equal(s.Distribution,58); // +10 stage +8 known cuisine
});

test('SLA adds exact early timing boosts but specialist ceiling still applies',()=>{
  const s=computeScores(base({sourceCount:2,sources:['DOHMH','SLA'],conceptText:'Restaurant'}));
  // Specialist restaurant text creates direct concept evidence only for generic restaurant,
  // not the hot-food specialist unlock; Equipment/Hood may not exceed generic ceiling.
  assert.equal(s.POS,86); // common 50 + stage28 + SLA8
  assert.equal(s.Insurance,85); // common 50 +25 +10
  assert.ok(s.Equipment<=86);
  assert.ok(s.HoodFire<=86);
});

test('strict venue-linked high-cost DOB earns Equipment and category-specific scope opens ceiling',()=>{
  const s=computeScores(base({
    stageNumber:2,
    sourceCount:2,
    sources:['DOHMH','DOB'],
    strictVenueLinkedHospitalityDob:true,
    dobInitialCost:173900,
    dobJobDescription:'Restaurant interior buildout with commercial kitchen plumbing mechanical equipment',
    conceptText:'BBQ restaurant',
  }));
  assert.ok(s.Equipment>Math.max(s.POS,s.Insurance));
  assert.ok(s.HoodFire>=Math.max(s.POS,s.Insurance));
  assert.equal(s.Equipment,100);
});

test('building-level unmatched DOB receives zero DOB venue boosts',()=>{
  const a=computeScores(base({
    sourceCount:1,
    sources:['DOHMH'],
    conceptText:'Restaurant',
  }));
  const b=computeScores(base({
    sourceCount:1,
    sources:['DOHMH'],
    strictVenueLinkedHospitalityDob:true,
    buildingLevelUnmatchedDob:true,
    dobInitialCost:500000,
    dobJobDescription:'commercial kitchen mechanical plumbing',
    conceptText:'Restaurant',
  }));
  assert.equal(b.Equipment,a.Equipment);
  assert.equal(b.HoodFire,a.HoodFire);
});

test('hot-food concept earns exact concept boosts even without DOB',()=>{
  const s=computeScores(base({conceptText:'Pizza bakery hot-food'}));
  assert.ok(s.Equipment>0);
  assert.ok(s.HoodFire>0);
  assert.equal(s.BestVendorFit,'Equipment');
});

test('light-prep concepts reduce Hood and Linen',()=>{
  const normal=computeScores(base({conceptText:'unknown concept'}));
  const light=computeScores(base({conceptText:'coffee tea juice light-prep'}));
  assert.equal(light.HoodFire,normal.HoodFire-12);
  assert.equal(light.Linen,normal.Linen-8);
});

test('actual pre-permit adds exactly five to Pest Waste Distribution before cap',()=>{
  const a=computeScores(base({stageNumber:3,materialAgeDays:10,conceptText:'unknown',knownCuisineType:false}));
  const b=computeScores(base({stageNumber:3,materialAgeDays:10,conceptText:'unknown',knownCuisineType:false,actualDohmhPrePermit:true}));
  assert.equal(b.Pest-a.Pest,5);
  assert.equal(b.Waste-a.Waste,5);
  assert.equal(b.Distribution-a.Distribution,5);
});

test('EXCLUDE forces all scores to zero and suppresses best vendor',()=>{
  const s=computeScores(base({commercialFit:'EXCLUDE'}));
  for(const c of ['POS','Insurance','Equipment','HoodFire','Waste','Pest','Linen','Distribution']) assert.equal(s[c],0);
  assert.equal(s.BestScore,0);
  assert.equal(s.BestVendorFit,'SUPPRESSED');
});

test('tie-break prefers HoodFire for venue-linked kitchen/mechanical DOB',()=>{
  const scores={POS:80,Insurance:70,Equipment:80,HoodFire:80,Waste:50,Pest:50,Linen:50,Distribution:50};
  const out=selectBestVendor(scores,{
    strictVenueLinkedHospitalityDob:true,
    dobJobDescription:'commercial kitchen mechanical work',
    dobWorkTypes:[],
    stageNumber:2,
    sources:['DOB'],
  });
  assert.equal(out.BestVendorFit,'HoodFire');
});

test('tie-break prefers Equipment for relevant high-cost DOB after Hood rule is absent',()=>{
  const scores={POS:80,Insurance:70,Equipment:80,HoodFire:60,Waste:50,Pest:50,Linen:50,Distribution:50};
  const out=selectBestVendor(scores,{
    strictVenueLinkedHospitalityDob:true,
    dobJobDescription:'restaurant interior buildout',
    dobInitialCost:200000,
    dobWorkTypes:[],
    stageNumber:2,
    sources:['DOB'],
  });
  assert.equal(out.BestVendorFit,'Equipment');
});

test('early SLA tie prefers Insurance, otherwise default order begins POS',()=>{
  const scores={POS:80,Insurance:80,Equipment:60,HoodFire:60,Waste:50,Pest:50,Linen:50,Distribution:50};
  assert.equal(selectBestVendor(scores,{stageNumber:1,sources:['SLA']}).BestVendorFit,'Insurance');
  assert.equal(selectBestVendor(scores,{stageNumber:1,sources:['DOHMH']}).BestVendorFit,'POS');
});
