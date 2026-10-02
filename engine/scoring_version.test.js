'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  SCORING_VERSION,scoringFingerprint,validateCanonicalScoreRows,
  stampRunControlNotes,hasCurrentScoringStamp
}=require('./scoring_version');

function crybabyInput(){
  return {
    commercialFit:'HIGH',materialAgeDays:14,sourceCount:2,publicPhone:true,stageNumber:2,
    sources:['DOHMH','DOB'],
    conceptText:'Eating & drinking establishment; outdoor BBQ (DOB)',
    conceptEvidence:{hotFood:true,restaurant:false,pokeBowl:false,lightPrep:false},
    knownCuisineType:true,actualDohmhPrePermit:false,
    strictVenueLinkedHospitalityDob:true,buildingLevelUnmatchedDob:false,
    dobInitialCost:173900,
    dobJobDescription:'NEW EATING & DRINKING ESTABLISHMENT AT FIRST FLOOR LESS THAN 75 PEOPLE, AND OUT DOOR BBQ ON THE ROOF, OBTAIN A NEW C. OF O.',
    dobWorkTypes:['General construction'],
  };
}
function dinerInput(){
  return {
    commercialFit:'HIGH',materialAgeDays:0,sourceCount:3,publicPhone:true,stageNumber:2,
    sources:['DOHMH','SLA','DOB'],
    conceptText:'Restaurant (SLA); Diner identity; identity-matched DOB signage',
    conceptEvidence:{hotFood:false,restaurant:true,pokeBowl:false,lightPrep:false},
    knownCuisineType:true,actualDohmhPrePermit:false,
    strictVenueLinkedHospitalityDob:false,buildingLevelUnmatchedDob:false,
    dobInitialCost:7500,dobJobDescription:'',dobWorkTypes:[],
  };
}

test('scoring version and fingerprint are deterministic',()=>{
  assert.equal(SCORING_VERSION,'permitplate-score-v2-2026-09-18');
  assert.match(scoringFingerprint(),/^[0-9a-f]{64}$/);
  assert.equal(scoringFingerprint(),scoringFingerprint());
});

test('CRYBABY live historical Hood 100 is detected as drift from canonical 93',()=>{
  const stored={
    'POS Score':65,'Insurance Score':64,'Equipment Score':100,'Hood/Fire Score':100,
    'Waste Score':58,'Pest Score':55,'Linen Score':65,'Distribution Score':78,
    'Best Vendor Fit':'Equipment','Best Score':100,
  };
  const r=validateCanonicalScoreRows([{venueKey:'153 BOWERY|10002',input:crybabyInput(),stored}]);
  assert.equal(r.pass,false);
  assert.deepEqual(r.errors.map(e=>[e.field,e.stored,e.canonical]),[['Hood/Fire Score',100,93]]);
});

test('DINER 24 historical Distribution 89 is detected and canonical recompute changes best fit',()=>{
  const stored={
    'POS Score':91,'Insurance Score':92,'Equipment Score':92,'Hood/Fire Score':92,
    'Waste Score':76,'Pest Score':73,'Linen Score':85,'Distribution Score':89,
    'Best Vendor Fit':'Insurance','Best Score':92,
  };
  const r=validateCanonicalScoreRows([{venueKey:'1674 BROADWAY|10019',input:dinerInput(),stored}]);
  assert.equal(r.pass,false);
  const byField=Object.fromEntries(r.errors.map(e=>[e.field,e]));
  assert.equal(byField['Distribution Score'].canonical,94);
  assert.equal(byField['Best Vendor Fit'].canonical,'Distribution');
  assert.equal(byField['Best Score'].canonical,94);
});

test('fully canonical rows pass as one version',()=>{
  const rows=[
    {venueKey:'153 BOWERY|10002',input:crybabyInput(),stored:{
      'POS Score':65,'Insurance Score':64,'Equipment Score':100,'Hood/Fire Score':93,
      'Waste Score':58,'Pest Score':55,'Linen Score':65,'Distribution Score':78,
      'Best Vendor Fit':'Equipment','Best Score':100}},
    {venueKey:'1674 BROADWAY|10019',input:dinerInput(),stored:{
      'POS Score':91,'Insurance Score':92,'Equipment Score':92,'Hood/Fire Score':92,
      'Waste Score':76,'Pest Score':73,'Linen Score':85,'Distribution Score':94,
      'Best Vendor Fit':'Distribution','Best Score':94}},
  ];
  assert.equal(validateCanonicalScoreRows(rows).pass,true);
});

test('run-control scoring stamp is exact and detectable',()=>{
  const notes=stampRunControlNotes('Shadow E2E PASS.');
  assert.match(notes,/ScoringVersion=permitplate-score-v2-2026-09-18/);
  assert.equal(hasCurrentScoringStamp(notes),true);
  assert.equal(hasCurrentScoringStamp('ScoringVersion=old'),false);
});
