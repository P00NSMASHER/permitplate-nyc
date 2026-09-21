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

{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:true,
    sourceId:'tempe-building-permits',
    connectorConfigHash:'cfg-1',
    schemaFingerprint:'schema-1',
    rawPageHashes:['page-1'],
    cursorClosed:true,
    publisherCount:0,
    fetchedCount:0
  });
  assert.equal(r.state, 'VERIFIED_EMPTY');
  assert.equal(r.supportsAbsenceConclusion, true);
}

{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:true,
    sourceId:'tempe-building-permits',
    connectorConfigHash:'cfg-1',
    schemaFingerprint:'schema-1',
    rawPageHashes:['page-1'],
    cursorClosed:true,
    publisherCount:20,
    fetchedCount:10
  });
  assert.equal(r.state, 'PARTIAL');
  assert.equal(r.supportsAbsenceConclusion, false);
}

{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:true,
    fetchedCount:0
  });
  assert.equal(r.state, 'UNKNOWN');
}

{
  const r = m.classifySourceObservation({
    transportOk:true,
    redirected:true,
    redirectTarget:'https://data.sf.gov/resource/i98e-djp9.json',
    fetchedCount:0
  });
  assert.equal(r.state, 'SOURCE_MOVED');
  assert.equal(r.supportsAbsenceConclusion, false);
}

{
  const r = m.classifySourceObservation({
    transportOk:false,
    fetchedCount:0
  });
  assert.equal(r.state, 'SOURCE_UNAVAILABLE');
}

{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:false,
    fetchedCount:10
  });
  assert.equal(r.state, 'PARTIAL');
  assert.equal(r.supportsPositiveObservation, true);
}

{
  const g = m.absenceMutationGate({
    action:'CLOSE',
    observationState:'UNKNOWN',
    sourceFresh:true,
    scopeMatches:true,
    targetObserved:false
  });
  assert.equal(g.allowed, false);
  assert(g.reasons.includes('SOURCE_WINDOW_NOT_COMPLETE'));
}

{
  const g = m.absenceMutationGate({
    action:'CLOSE',
    observationState:'COMPLETE_NONEMPTY',
    sourceFresh:true,
    scopeMatches:true,
    targetObserved:false
  });
  assert.equal(g.allowed, true);
}

{
  const change = m.materialChange(
    {status:'active'},
    {status:'closed'},
    {
      inferredFromAbsence:true,
      absenceAction:'CLOSE',
      observationState:'PARTIAL',
      sourceFresh:true,
      scopeMatches:true
    }
  );
  assert.equal(change.material, false);
  assert.equal(change.type, 'UNVERIFIED_ABSENCE');
}

{
  const g = m.deliveryGate({
    resolutionStatus:'RESOLVED',
    commercialFit:'HIGH',
    sourceFresh:true,
    sourceObservationState:'PARTIAL',
    postBaseline:true,
    qualifyingReopen:false,
    vendorScore:80,
    minimumScore:60,
    alreadyDeliveredFingerprint:false
  });
  assert.equal(g.eligible, true);
}

{
  const g = m.deliveryGate({
    resolutionStatus:'RESOLVED',
    commercialFit:'HIGH',
    sourceFresh:true,
    sourceObservationState:'SOURCE_MOVED',
    postBaseline:true,
    qualifyingReopen:false,
    vendorScore:80,
    minimumScore:60,
    alreadyDeliveredFingerprint:false
  });
  assert.equal(g.eligible, false);
  assert(g.reasons.includes('SOURCE_OBSERVATION_NOT_USABLE'));
}

console.log('PermitPlate Model V7 regression tests passed.');
