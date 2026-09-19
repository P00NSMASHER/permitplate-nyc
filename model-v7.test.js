'use strict';

const assert = require('assert');
const m = require('./model-v7');

{
  const result = m.resolveEntity(
    {businessName:'CRYBABY', address:'153 Bowery', sourceEntityId:'CAMIS-50192386'},
    {canonicalName:'Crybaby', address:'153 Bowery', sourceEntityIds:['CAMIS-50192386']}
  );
  assert.equal(result.resolutionStatus, 'RESOLVED');
}

{
  const result = m.resolveEntity(
    {businessName:'Cafe A', address:'1 Market St', unit:'12'},
    {canonicalName:'Cafe A', address:'1 Market St', unit:'3', sourceEntityIds:[]}
  );
  assert.notEqual(result.resolutionStatus, 'RESOLVED');
}

{
  const prev = {lifecycleStage:'JUST FILED', sourceSystems:['DOHMH'], categoryEvidence:[], status:'active'};
  const cur = {lifecycleStage:'BUILDOUT / LICENSING', sourceSystems:['DOHMH','DOB'], categoryEvidence:['commercial-kitchen'], status:'active'};
  const change = m.materialChange(prev, cur);
  assert.equal(change.material, true);
  assert.equal(change.type, 'STAGE_ADVANCE');
}

{
  const state = {lifecycleStage:'JUST FILED', sourceSystems:['DOHMH'], categoryEvidence:[], status:'active'};
  assert.equal(m.materialChange(state, JSON.parse(JSON.stringify(state))).material, false);
}

{
  const s = m.vendorScore({changeRecencyMateriality:35,lifecycleTimingUrgency:25,categoryRelevance:40,evidenceStrength:20});
  assert.equal(s.total, 100);
  assert.deepEqual(s.components, {
    changeRecencyMateriality:30,
    lifecycleTimingUrgency:25,
    categoryRelevance:25,
    evidenceStrength:20
  });
}

{
  const g = m.deliveryGate({
    resolutionStatus:'REVIEW',
    commercialFit:'HIGH',
    sourceFresh:true,
    postBaseline:true,
    qualifyingReopen:false,
    vendorScore:90,
    minimumScore:50,
    alreadyDeliveredFingerprint:false
  });
  assert.equal(g.eligible, false);
  assert(g.reasons.includes('IDENTITY_NOT_RESOLVED'));
}

{
  const g = m.deliveryGate({
    resolutionStatus:'RESOLVED',
    commercialFit:'HIGH',
    sourceFresh:true,
    postBaseline:false,
    qualifyingReopen:true,
    vendorScore:78,
    minimumScore:60,
    alreadyDeliveredFingerprint:false
  });
  assert.equal(g.eligible, true);
}

console.log('PermitPlate Model V7 regression tests passed.');
