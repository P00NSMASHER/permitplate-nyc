'use strict';
// Selected official PA municipal-election ROWS only. This is a text-consistency
// diagnostic; it does not geocode a property, authenticate a current official,
// or establish permit applicability or a complete statewide registry.
const assert=require('node:assert/strict');
const guard=require('./pa-jurisdiction-identity');
const orders=require('./pa-permit-orders');
const a=require('../verification/pa-official-ucc-permit-samples.json');
const b=require('./pa-real-official-evidence.json');

assert.equal(guard.REFERENCES.length,32);
assert.equal(guard.SOURCE,a.sourceOfMunicipalTruth);
assert.equal(a.strictlyPublicReferenceOnly,true);
assert.equal(b.noActualStripeTransaction,true);
const sample={projectAddress:'100 Example Street, Pottsville PA',
  projectScope:'Commercial hood and interior restaurant renovation'};
function check(municipality){
  return orders.projectHealth({...sample,municipality});
}
let validated=0;
for(const row of a.municipals){
  const municipality=row.name+', '+row.type+', '+row.county+' County, PA';
  const result=guard.assess(municipality);
  assert.equal(result.status,'SELECTED_REFERENCE_TEXT_MATCH',row.id);
  assert.equal(result.textMatched.type,row.type);
  assert.equal(result.textMatched.county,row.county);
  assert.equal(result.textMatched.historicalElection,row.uccElection);
  assert.equal(result.geographicBoundaryVerified,false);
  assert.equal(result.currentJurisdictionContactVerified,false);
  assert.equal(result.permitApplicabilityVerified,false);
  assert.equal(check(municipality),true);
  validated++;
}
for(const row of b.municipalDecisions){
  const text=row.name+', '+row.municipalityType+', '+row.county+' County, PA';
  const result=guard.assess(text);
  assert.equal(result.status,'SELECTED_REFERENCE_TEXT_MATCH',row.caseId);
  assert.equal(result.textMatched.historicalElection,row.uccDecision);
  assert.equal(check(text),true);
}
assert.equal(validated,30);
for(const [input,expected] of [
  ['Pottsville City, Fayette County, PA','KNOWN_NAME_COUNTY_NOT_CONFIRMED'],
  ['Pine Grove, Schuylkill County, PA','MUNICIPALITY_TYPE_AMBIGUOUS'],
  ['Menallen Township, PA','COUNTY_NOT_EXPLICIT'],
  ['Brownsville, Fayette County, PA','MUNICIPALITY_TYPE_AMBIGUOUS'],
  ['Mount Carbon Borough, Berks County, PA','KNOWN_NAME_COUNTY_NOT_CONFIRMED'],
  ['Pine Grove City, Schuylkill County, PA','MUNICIPALITY_TYPE_CONFLICT'],
  ['Pine Grove, City, Schuylkill County, PA','MUNICIPALITY_TYPE_CONFLICT'],
  ['Pottsville, Unknown County, PA','KNOWN_NAME_COUNTY_NOT_CONFIRMED'],
  ['Pottsville City, PA','COUNTY_NOT_EXPLICIT'],
  ['Pottsville, Berks County','KNOWN_NAME_COUNTY_NOT_CONFIRMED']
]){
  assert.equal(guard.assess(input).status,expected,input);
  assert.equal(check(input),false,input);
}
for(const [input,election] of [
  ['Pottsville, Schuylkill County, PA','OPT-IN'],
  ['Pottsville City, Schuylkill County','OPT-IN'],
  ['City of Pottsville, Schuylkill County, PA','OPT-IN'],
  ['Mount Carbon Borough, Schuylkill County, PA','OPT-OUT'],
  ['Pine Grove Township, Schuylkill County, PA','OPT-IN'],
  ['Pine Grove Borough, Schuylkill County, PA','OPT-IN'],
  ['Fayette City, Fayette County, PA','OPT-OUT'],
  ['Fayette City Borough, Fayette County, PA','OPT-OUT'],
  ['Menallen Township, Adams County, PA','OPT-OUT'],
  ['Menallen Township, Fayette County, PA','OPT-IN'],
  ['Philadelphia, Philadelphia County','OPT-IN'],
  ['Branch Township, Schuylkill County, PA','OPT-IN']
]){
  const got=guard.assess(input);
  assert.equal(got.status,'SELECTED_REFERENCE_TEXT_MATCH',input);
  assert.equal(got.textMatched.historicalElection,election,input);
  assert.equal(check(input),true,input);
}
// Do not claim a complete statewide reference set. An unknown municipality is
// still subject to independent genuine human jurisdiction/source review.
const unknown='Exampleville Borough, Schuylkill County, PA';
assert.equal(guard.assess(unknown).status,'NAME_NOT_IN_SELECTED_REFERENCE');
assert.equal(guard.assess(unknown).geographicBoundaryVerified,false);
assert.equal(check(unknown),true,'unknown references are not proof of false municipality');
assert.equal(check('Pottsville, Schuylkill County'),true);
for(const malformed of [null,{},[],42,'','Pottsville\nBCC: redacted',
  'Pottsville, , Schuylkill County','Pottsville <script>, Schuylkill County']){
  assert.notEqual(guard.assess(malformed).status,'SELECTED_REFERENCE_TEXT_MATCH');
  assert.equal(check(malformed),false);
}
for(const entry of guard.REFERENCES){
  assert(!('phone' in entry)&&!('codeOfficial' in entry));
}
assert.equal(guard.requiresClarification('Pine Grove, Schuylkill County'),true);
assert.equal(guard.requiresClarification('Pottsville, Schuylkill County'),false);
console.log('PA selected-official-reference county/type ambiguity guard: 32 reference rows, 5 known false-admissions now held; boundary and real-customer evidence remain unverified.');
