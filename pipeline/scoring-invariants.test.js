'use strict';

const assert=require('assert');
const adapters=require('./source-adapters');
const project=require('./project-signal');
const shadow=require('./shadow-scoring-v3');

function dohmh(row){
  return adapters.normalizeDohmhRow(row,{observedAt:'2026-09-21T16:00:00Z'});
}
function dob(row){
  return adapters.normalizeDobNowRow(row,{observedAt:'2026-09-21T16:00:00Z'});
}
function candidate(primary,evidence,overrides){
  const signal=project.buildProjectSignal(primary,evidence||[],{
    reviewedIdentityBridges:overrides&&overrides.reviewedIdentityBridges||[]
  });
  return Object.assign({
    entityId:primary.sourceEntityId,
    camis:primary.entityKeys.camis,
    canonicalName:primary.parties.operatorName,
    borough:primary.property.borough,
    lifecycleStage:'JUST FILED',
    sourceLatestEffectiveAt:primary.sourceEffectiveAt,
    sourceSystems:signal.sourceSystems,
    sourceCount:signal.sourceCount,
    deliverySuppressed:false,
    crossCamisOperationalConflicts:[],
    primaryRecord:primary,
    commercialEvidence:signal.commercialEvidence,
    projectSignal:signal
  },overrides||{});
}
function recordsMap(records){ return shadow.sourceMap(records); }

const primary=dohmh({
  camis:'58880001',dba:'TEST CAFE',boro:'Manhattan',building:'100',street:'MAIN ST',
  zipcode:'10001',phone:'555-1000',cuisine_description:'Coffee/Tea',
  inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
});

// Rejected same-site DOB evidence has exactly zero scoring effect.
{
  const unrelated=dob({
    job_filing_number:'M-REJECTED',
    house_no:'100',street_name:'MAIN ST',borough:'Manhattan',bin:'1000001',
    owner_s_business_name:'UNRELATED OWNER',
    job_description:'Commercial kitchen hood fire suppression restaurant',
    initial_cost:'$500,000',
    filing_date:'2026-09-21T11:00:00.000'
  });
  const without=candidate(primary,[]);
  const withRejected=candidate(primary,[unrelated]);
  assert.equal(withRejected.projectSignal.corroboration.accepted.length,0);
  assert.equal(withRejected.projectSignal.corroboration.rejected.length,1);
  const a=shadow.computeShadowScores(without,recordsMap([primary]),'2026-09-21T16:00:00Z');
  const b=shadow.computeShadowScores(withRejected,recordsMap([primary,unrelated]),'2026-09-21T16:00:00Z');
  assert.deepEqual(b.scores,a.scores);
  assert.equal(b.bestVendorFit,a.bestVendorFit);
}

// Accepted identity-only signage does not mint hospitality DOB specialist authority.
{
  const sign=dob({
    job_filing_number:'M-SIGN',
    house_no:'100',street_name:'MAIN ST',borough:'Manhattan',
    owner_s_business_name:'TEST CAFE',
    job_description:'Install exterior illuminated wall sign TEST CAFE',
    initial_cost:'$7,500',
    filing_date:'2026-09-21T11:00:00.000'
  });
  const bridge=project.reviewedBridgeKey(primary,sign);
  const c=candidate(primary,[sign],{reviewedIdentityBridges:[bridge]});
  const out=shadow.computeShadowScores(c,recordsMap([primary,sign]),'2026-09-21T16:00:00Z');
  assert.equal(out.input.acceptedDob,false);
  assert.equal(out.input.acceptedDobIdentityOnly,true);
  assert.equal(out.input.directEquipmentDobScope,false);
  assert.equal(out.input.directHoodFireDobScope,false);
}

// Accepted hospitality/kitchen DOB can add category-specific evidence.
{
  const kitchen=dob({
    job_filing_number:'M-KITCHEN',
    house_no:'100',street_name:'MAIN ST',borough:'Manhattan',
    owner_s_business_name:'TEST CAFE',
    job_description:'Restaurant interior buildout with commercial kitchen, mechanical plumbing and hood fire suppression',
    initial_cost:'$175,000',
    filing_date:'2026-09-21T11:00:00.000'
  });
  const bridge=project.reviewedBridgeKey(primary,kitchen);
  const c=candidate(primary,[kitchen],{
    reviewedIdentityBridges:[bridge],
    lifecycleStage:'BUILDOUT / LICENSING'
  });
  const out=shadow.computeShadowScores(c,recordsMap([primary,kitchen]),'2026-09-21T16:00:00Z');
  assert.equal(out.input.acceptedDob,true);
  assert.equal(out.input.directEquipmentDobScope,true);
  assert.equal(out.input.directHoodFireDobScope,true);
  assert(out.scores.Equipment>=out.scores.POS);
  assert(out.scores['Hood/Fire']>=out.scores.POS);
}

// Recency only decays; an older otherwise-identical signal cannot score higher.
{
  const freshCandidate=candidate(primary,[]);
  const oldCandidate=JSON.parse(JSON.stringify(freshCandidate));
  oldCandidate.sourceLatestEffectiveAt='2026-08-01T12:00:00Z';
  const fresh=shadow.computeShadowScores(freshCandidate,recordsMap([primary]),'2026-09-21T16:00:00Z');
  const old=shadow.computeShadowScores(oldCandidate,recordsMap([primary]),'2026-09-21T16:00:00Z');
  for(const category of shadow.CATEGORIES){
    assert(old.scores[category]<=fresh.scores[category],category+' recency inflated');
  }
}

// Public-phone evidence can add at most the documented +5 and never be invented.
{
  const noPhone=dohmh({
    camis:'58880002',dba:'TEST CAFE',boro:'Manhattan',building:'101',street:'MAIN ST',
    zipcode:'10001',phone:'',cuisine_description:'Coffee/Tea',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const withPhone=shadow.computeShadowScores(candidate(primary,[]),recordsMap([primary]),'2026-09-21T16:00:00Z');
  const without=shadow.computeShadowScores(candidate(noPhone,[]),recordsMap([noPhone]),'2026-09-21T16:00:00Z');
  assert.equal(withPhone.input.publicPhone,true);
  assert.equal(without.input.publicPhone,false);
  assert.equal(withPhone.scores.POS-without.scores.POS,5);
  assert.equal(withPhone.scores.Insurance-without.scores.Insurance,5);
}

// Institutional/residential exclusions are always all-zero suppressed.
{
  const excluded=dohmh({
    camis:'58880003',dba:'THE TEST RESIDENCE',boro:'Manhattan',building:'102',street:'MAIN ST',
    zipcode:'10001',phone:'555-2000',
    inspection_date:'1900-01-01T00:00:00.000',record_date:'2026-09-21T12:00:00.000'
  });
  const out=shadow.computeShadowScores(candidate(excluded,[]),recordsMap([excluded]),'2026-09-21T16:00:00Z');
  assert.equal(out.fitReceipt.fit,'EXCLUDE');
  assert.equal(out.bestVendorFit,'SUPPRESSED');
  assert.equal(out.bestScore,0);
  assert(Object.values(out.scores).every((score)=>score===0));
}

// Every score remains bounded even under maximal accepted evidence.
{
  const kitchen=dob({
    job_filing_number:'M-MAX',
    house_no:'100',street_name:'MAIN ST',borough:'Manhattan',
    owner_s_business_name:'TEST CAFE',
    job_description:'Restaurant commercial kitchen equipment mechanical plumbing hood fire suppression',
    initial_cost:'$999,999',
    filing_date:'2026-09-21T11:00:00.000'
  });
  const bridge=project.reviewedBridgeKey(primary,kitchen);
  const c=candidate(primary,[kitchen],{
    reviewedIdentityBridges:[bridge],
    lifecycleStage:'MULTI-SOURCE NEAR-OPENING'
  });
  const out=shadow.computeShadowScores(c,recordsMap([primary,kitchen]),'2026-09-21T16:00:00Z');
  for(const score of Object.values(out.scores)){
    assert(Number.isInteger(score));
    assert(score>=0&&score<=100);
  }
}

console.log('PermitPlate scoring adversarial invariants passed.');
