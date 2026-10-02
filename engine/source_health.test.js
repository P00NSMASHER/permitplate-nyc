'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateSourceHealth,slaDiscoveryEligibility,dobFirstEligibility}=require('./source_health');

const OBS='2026-09-18T12:00:00Z';

test('healthy DOHMH allows delivery and healthy optional sources do not degrade',()=>{
  const r=evaluateSourceHealth({
    observedAt:OBS,
    dohmh:{rowsUpdatedAt:'2026-09-17T12:00:00Z',applicantCount:500,recentPrePermitCount:10},
    sla:{newestRelevantReceivedDate:'2026-09-17T12:00:00Z'},
    dob:{rowsUpdatedAt:'2026-09-17T12:00:00Z'},
  });
  assert.equal(r.deliveryAllowed,true);
  assert.equal(r.confidenceDegraded,false);
});

test('DOHMH stale or low source counts fail closed',()=>{
  const r=evaluateSourceHealth({
    observedAt:OBS,
    dohmh:{rowsUpdatedAt:'2026-09-14T11:59:00Z',applicantCount:99,recentPrePermitCount:0},
    sla:{newestRelevantReceivedDate:'2026-09-17T12:00:00Z'},
    dob:{rowsUpdatedAt:'2026-09-17T12:00:00Z'},
  });
  assert.equal(r.deliveryAllowed,false);
  assert.ok(r.blockers.includes('DOHMH_STALE'));
  assert.ok(r.blockers.includes('DOHMH_APPLICANT_COUNT_LOW'));
  assert.ok(r.blockers.includes('DOHMH_PREPERMIT_COUNT_LOW'));
});

test('SLA/DOB outage degrades confidence but does not fabricate a DOHMH blocker',()=>{
  const r=evaluateSourceHealth({
    observedAt:OBS,
    dohmh:{rowsUpdatedAt:'2026-09-17T12:00:00Z',applicantCount:200,recentPrePermitCount:1},
    sla:null,dob:null,
  });
  assert.equal(r.deliveryAllowed,true);
  assert.equal(r.confidenceDegraded,true);
  assert.ok(r.degradations.includes('SLA_UNAVAILABLE'));
  assert.ok(r.degradations.includes('DOB_UNAVAILABLE'));
});

test('SLA-first requires NYC and explicit restaurant/hospitality identity',()=>{
  assert.equal(slaDiscoveryEligibility({
    county:'Kings',receivedDate:'2026-09-01',observedAt:OBS,
    description:'Restaurant',classification:'On Premises',dba:'Example'
  }).eligible,true);

  assert.equal(slaDiscoveryEligibility({
    county:'Queens',receivedDate:'2026-09-01',observedAt:OBS,
    description:'Food & Beverage Business',classification:'Generic',dba:'123 Holdings'
  }).reason,'OPAQUE_FOOD_BEVERAGE_AUDIT_ONLY');

  assert.equal(slaDiscoveryEligibility({
    county:'Nassau',receivedDate:'2026-09-01',observedAt:OBS,
    description:'Restaurant',dba:'Example'
  }).reason,'NON_NYC_COUNTY');
});

test('DOB-first requires recent explicit hospitality use and exact address+ZIP',()=>{
  assert.equal(dobFirstEligibility({
    observedAt:OBS,materialDate:'2026-08-01',
    address:'10 Main St',zip:'10001',jobDescription:'restaurant commercial kitchen buildout'
  }).eligible,true);

  assert.equal(dobFirstEligibility({
    observedAt:OBS,materialDate:'2026-08-01',
    address:'10 Main St',zip:'10001',jobDescription:'retail sign and awning'
  }).reason,'NO_EXPLICIT_HOSPITALITY_USE');

  assert.equal(dobFirstEligibility({
    observedAt:OBS,materialDate:'2026-08-01',
    address:'',zip:'10001',jobDescription:'restaurant'
  }).reason,'MISSING_EXACT_ADDRESS_OR_ZIP');
});
