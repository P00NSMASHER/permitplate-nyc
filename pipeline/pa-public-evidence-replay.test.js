'use strict';
// Real, official PA municipal-election data and public Philadelphia permit
// references. This is a source-backed diagnostic, not genuine paid orders,
// municipality geocoding, human-reviewed permit determinations, or deliveries.
const assert=require('node:assert/strict');
const core=require('./pa-permit-orders');
const review=require('./pa-permit-fulfillment');
const fixture=require('../verification/pa-official-ucc-permit-samples.json');
assert.equal(fixture.strictlyPublicReferenceOnly,true);
assert.equal(fixture.hasRealCustomerRecords,false);
assert.equal(fixture.hasGenuinePrivateHumanReviewLabels,false);
assert.equal(fixture.municipals.length,30);
assert.equal(fixture.publicPermits.length,23);
assert(fixture.sourceOfMunicipalTruth.startsWith('https://www.pa.gov/'));
const keys=new Set();
let optedOut=0,projectTextAdmitted=0;
for(const municipality of fixture.municipals){
  const key=[municipality.county,municipality.name,municipality.type].join('|');
  assert(!keys.has(key),'duplicate government jurisdiction identity '+key);
  keys.add(key);
  assert(['BOROUGH','TOWNSHIP','CITY','HOME RULE'].includes(municipality.type));
  assert(['OPT-IN','OPT-OUT'].includes(municipality.uccElection));
  assert.equal(typeof municipality.pre1999Amendments,'boolean');
  assert(Number.isInteger(municipality.registryLine));
  if(municipality.uccElection==='OPT-OUT')optedOut++;
  const displayed=[municipality.name,municipality.type,
    municipality.county+' County, PA'].join(', ');
  const project={
    municipality:displayed,
    projectAddress:'100 Fictional Test Street, PA',
    projectScope:'Commercial kitchen or ventilation renovation for diagnostic testing'
  };
  // The text gate now rejects contradictions in the selected public source
  // sample; a passing result STILL does not verify a parcel's boundary,
  // current election/contact information or any permit applicability.
  assert.equal(core.projectHealth(project),true);
  projectTextAdmitted++;
}
assert.equal(optedOut,4);
assert.equal(projectTextAdmitted,30);
const lookup=(county,name,type)=>
  fixture.municipals.find(x=>x.county===county&&x.name===name&&x.type===type);
assert.equal(lookup('SCHUYLKILL','MOUNT CARBON','BOROUGH').uccElection,'OPT-OUT');
assert.equal(lookup('ADAMS','MENALLEN','TOWNSHIP').uccElection,'OPT-OUT');
assert.equal(lookup('FAYETTE','MENALLEN','TOWNSHIP').uccElection,'OPT-IN');
assert.equal(lookup('SCHUYLKILL','PINE GROVE','BOROUGH').pre1999Amendments,true);
assert.equal(lookup('SCHUYLKILL','PINE GROVE','TOWNSHIP').pre1999Amendments,false);
assert.equal(lookup('PIKE','PORTER','TOWNSHIP').pre1999Amendments,true);
assert.equal(lookup('SCHUYLKILL','PORTER','TOWNSHIP').pre1999Amendments,false);

// Selected official-reference text consistency guard. The five previously
// admitted wrong-county/ambiguous name cases must now be held. This is NOT a
// statewide 2,562-row census or actual address/parcel geocoding.
const negativeControls=[
  ['Pottsville City, Fayette County, PA','WRONG_COUNTY_ACCEPTED'],
  ['Pine Grove, Schuylkill County, PA','SAME_NAME_BOROUGH_TOWNSHIP_AMBIGUOUS'],
  ['Menallen Township, PA','COUNTY_NOT_RESOLVED'],
  ['Brownsville, Fayette County, PA','SAME_NAME_BOROUGH_TOWNSHIP_AMBIGUOUS'],
  ['Mount Carbon Borough, Berks County, PA','WRONG_COUNTY_ACCEPTED']
];
const knownGaps=[];
for(const [municipality,kind] of negativeControls){
  const admitted=core.projectHealth({
    municipality,projectAddress:'100 Synthetic Example Street, PA',
    projectScope:'Commercial restaurant alteration requiring actual jurisdiction review'
  });
  if(admitted)knownGaps.push(kind);
}
assert.equal(knownGaps.length,0,
  'none of the five selected-reference ambiguity controls may pass project text review');

// Public permit metadata is separate from private Checkout Session identity.
// The same address may hold several legal permit types and statuses.
const permits=new Set(),types=new Set(),byAddress=new Map();
const statusSet=new Set();
for(const p of fixture.publicPermits){
  assert(/^[A-Z]{2}-\d{4}-\d{6}$/.test(p.number));
  assert(!permits.has(p.number),'duplicated official permit reference');
  permits.add(p.number);types.add(p.type);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(p.issuedDate));
  assert(p.sourceKey in fixture.publicPermitSources);
  assert(fixture.publicPermitSources[p.sourceKey].startsWith('https://li.phila.gov/'));
  if(p.currentStatusAsDisplayed)statusSet.add(p.currentStatusAsDisplayed);
  if(p.publicAddress){
    if(!byAddress.has(p.publicAddress))byAddress.set(p.publicAddress,[]);
    byAddress.get(p.publicAddress).push(p);
  }
  assert.notEqual(p.number,core.LINK);
  assert.equal(p.number.startsWith('cs_'),false);
}
assert(types.size>=8);
assert(statusSet.has('ISSUED'));
assert(statusSet.has('EXPIRED'));
assert(statusSet.has('COMPLETED'));
assert(statusSet.has('AMENDMENT APPLICATION INCOMPLETE'));
const broad=byAddress.get('521 S BROAD ST');
assert.equal(broad.length,4);
assert.equal(new Set(broad.map(p=>p.type)).size,4);
const woodbine=byAddress.get('6393 WOODBINE AVE');
assert.equal(woodbine.length,4);
assert(woodbine.some(p=>p.type==='Residential Building Permit'));
assert(woodbine.some(p=>p.type==='Mechanical / Fuel Gas Permit'));
assert.equal(fixture.publicPermits.find(
  p=>p.number==='CP-2026-004256').currentStatusAsDisplayed,
  'AMENDMENT APPLICATION INCOMPLETE');
assert.equal(fixture.publicPermits.find(
  p=>p.number==='CP-2025-005916').currentStatusAsDisplayed,'EXPIRED');
// A registry URL alone is not human-reviewed case evidence.
const declaredReview=review.researchErrors({
  researcherId:'fixture-only',preparedAt:'2026-10-20T13:00:00.000Z',
  sources:[{
    sourceId:'PA-DLI-PUBLIC-REGISTRY',
    url:fixture.sourceOfMunicipalTruth,observedAt:'2026-10-20T13:00:00.000Z',
    claim:'The public municipal election registry is official government evidence.',
    verifiedByHuman:false
  }]
},'2026-10-20T12:00:00.000Z');
assert(declaredReview.includes('PA_RESEARCH_SOURCES_INCOMPLETE'));
assert.equal(review.govUrl(fixture.sourceOfMunicipalTruth),true);
const outcome={
  sample:'PA public jurisdiction and Philadelphia permit provenance',
  authoritativeMunicipalityRowsReviewed:fixture.municipals.length,
  uccOptOutReferenceRows:optedOut,
  officialPhiladelphiaPermitReferences:fixture.publicPermits.length,
  permitTypesRepresented:types.size,
  publicLocationsWithMultiplePermitTypes:
    [...byAddress.values()].filter(v=>new Set(v.map(p=>p.type)).size>1).length,
  actuallyConfirmedCustomerPayments:0,
  genuineHumanPermitAdjudications:0,
  providerVerifiedCustomerDeliveries:0,
  jurisdictionAutomaticallyAuthenticated:false,
  baselineTextGateFalseAcceptances:knownGaps,
  result:'SELECTED_REFERENCE_TEXT_GUARD_PASS_STATEWIDE_JURISDICTION_UNVERIFIED'
};
console.log(JSON.stringify(outcome,null,2));
