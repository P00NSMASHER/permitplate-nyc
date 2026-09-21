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
    queryFingerprint:'query-1',
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
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
    queryFingerprint:'query-1',
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
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


{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:true,
    sourceId:'x',
    connectorConfigHash:'cfg',
    queryFingerprint:'query-1',
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    schemaFingerprint:'schema',
    rawPageHashes:['page'],
    cursorClosed:true,
    fetchedCount:0
  });
  assert.equal(r.state, 'UNKNOWN');
  assert.equal(r.supportsAbsenceConclusion, false);
}

{
  const r = m.classifySourceObservation({
    transportOk:true,
    intendedFullScope:true,
    sourceId:'x',
    connectorConfigHash:'cfg',
    queryFingerprint:'query-1',
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:false,
    schemaFingerprint:'schema',
    rawPageHashes:['page'],
    cursorClosed:true,
    publisherCount:0,
    fetchedCount:0
  });
  assert.equal(r.state, 'UNKNOWN');
  assert.equal(r.reason, 'SOURCE_NOT_FRESH');
}

{
  const input = {
    event:{
      businessName:'CRYBABY',
      address:'153 Bowery',
      sourceEntityId:'CAMIS-50192386',
      sourceRecordId:'50192386',
      sourceUrl:'https://data.cityofnewyork.us/example'
    },
    candidate:{
      entityId:'venue-1',
      canonicalName:'Crybaby',
      address:'153 Bowery',
      sourceEntityIds:['CAMIS-50192386'],
      commercialFit:'HIGH'
    },
    sourceObservation:{
      transportOk:true,
      intendedFullScope:true,
      sourceId:'nyc-dohmh',
      connectorConfigHash:'cfg-v1',
      queryFingerprint:'query-v1',
      observedAt:'2026-09-21T13:30:00Z',
      sourceFresh:true,
      schemaFingerprint:'schema-v1',
      rawPageHashes:['page-1'],
      cursorClosed:true,
      publisherCount:1,
      fetchedCount:1
    },
    previousState:{lifecycleStage:'JUST FILED',sourceSystems:['DOHMH'],categoryEvidence:[],status:'active'},
    currentState:{lifecycleStage:'BUILDOUT / LICENSING',sourceSystems:['DOHMH','DOB'],categoryEvidence:['commercial-kitchen'],status:'active'},
    scoreParts:{changeRecencyMateriality:30,lifecycleTimingUrgency:22,categoryRelevance:25,evidenceStrength:18},
    postBaseline:true,
    minimumScore:60,
    alreadyDeliveredFingerprint:false
  };
  const first = m.buildOpportunityDecision(input);
  const replay = m.buildOpportunityDecision(JSON.parse(JSON.stringify(input)));
  assert.equal(first.decision, 'DELIVER');
  assert.equal(first.modelVersion, 'PermitPlate-v7.1.0');
  assert.equal(first.replayFingerprint, replay.replayFingerprint);
  assert.equal(first.sourceObservation.state, 'COMPLETE_NONEMPTY');
}

{
  const input = {
    event:{businessName:'A',address:'1 Main St',sourceEntityId:'id-1',sourceRecordId:'r1',sourceUrl:'https://example.com/r1'},
    candidate:{entityId:'e1',canonicalName:'A',address:'1 Main St',sourceEntityIds:['id-1'],commercialFit:'HIGH'},
    sourceObservation:{transportOk:false,sourceFresh:false},
    previousState:{status:'active'},
    currentState:{status:'changed'},
    scoreParts:{changeRecencyMateriality:30,lifecycleTimingUrgency:20,categoryRelevance:20,evidenceStrength:20},
    postBaseline:true,
    minimumScore:50
  };
  const result = m.buildOpportunityDecision(input);
  assert.equal(result.decision, 'REVIEW');
  assert(result.reasons.includes('SOURCE_OBSERVATION_NOT_USABLE'));
}

{
  const input = {
    event:{businessName:'A',address:'1 Main St',sourceEntityId:'id-1',sourceRecordId:'r1',sourceUrl:''},
    candidate:{entityId:'e1',canonicalName:'A',address:'1 Main St',sourceEntityIds:['id-1'],commercialFit:'HIGH'},
    sourceObservation:{
      transportOk:true,intendedFullScope:true,sourceId:'s',connectorConfigHash:'c',queryFingerprint:'q',
      observedAt:'2026-09-21T13:30:00Z',sourceFresh:true,schemaFingerprint:'x',
      rawPageHashes:['p'],cursorClosed:true,publisherCount:1,fetchedCount:1
    },
    previousState:{status:'active'},
    currentState:{status:'changed'},
    scoreParts:{changeRecencyMateriality:30,lifecycleTimingUrgency:20,categoryRelevance:20,evidenceStrength:20},
    postBaseline:true,
    minimumScore:50
  };
  const result = m.buildOpportunityDecision(input);
  assert.equal(result.decision, 'REVIEW');
  assert(result.reasons.includes('MISSING_SOURCE_LINEAGE'));
}

{
  const result = m.resolveEntity(
    {businessName:'Same Cafe', address:'1 Main St', sourceEntityId:'CAMIS-B'},
    {canonicalName:'Same Cafe', address:'1 Main St', sourceEntityIds:['CAMIS-A']}
  );
  assert.equal(result.stableIdentifierConflict, true);
  assert.equal(result.contradictoryEvidence, true);
  assert.equal(result.resolutionStatus, 'UNRESOLVED');
}

{
  const normal = m.classifySubscriberEligibility({
    baselineAt:'2026-09-21T12:00:00Z',
    firstSignalAt:'2026-09-21T12:00:01Z'
  });
  assert.equal(normal.eligible, true);
  assert.equal(normal.section, 'NORMAL');
}

{
  const starter = m.classifySubscriberEligibility({
    baselineAt:'2026-09-21T12:00:00Z',
    firstSignalAt:'2026-09-18T12:00:00Z',
    starterSnapshotEnabled:true,
    starterDays:7
  });
  assert.equal(starter.eligible, true);
  assert.equal(starter.section, 'STARTER');
  assert.equal(starter.reason, 'LABELED_STARTER_SNAPSHOT');
}

{
  const backlog = m.classifySubscriberEligibility({
    baselineAt:'2026-09-21T12:00:00Z',
    firstSignalAt:'2026-09-01T12:00:00Z',
    starterSnapshotEnabled:true,
    starterDays:7
  });
  assert.equal(backlog.eligible, false);
  assert.equal(backlog.reason, 'PRE_BASELINE_BACKLOG');
}

{
  const reopen = m.classifySubscriberEligibility({
    baselineAt:'2026-09-21T12:00:00Z',
    firstSignalAt:'2026-08-01T00:00:00Z',
    qualifyingReopen:true,
    reopenAt:'2026-09-21T13:00:00Z'
  });
  assert.equal(reopen.eligible, true);
  assert.equal(reopen.reason, 'POST_BASELINE_REOPEN');
}

{
  const unknownTime = m.classifySubscriberEligibility({
    baselineAt:'2026-09-21T12:00:00Z'
  });
  assert.equal(unknownTime.eligible, false);
  assert.equal(unknownTime.section, 'REVIEW');
  assert.equal(unknownTime.reason, 'EVENT_TIME_UNPROVEN');
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'Equipment',
    score:97,
    posScore:84,
    insuranceScore:80,
    evidenceTags:[]
  });
  assert.equal(result.capped, true);
  assert.equal(result.score, 84);
  assert.equal(result.reason, 'VERTICAL_EVIDENCE_CEILING');
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'Equipment',
    score:97,
    posScore:84,
    insuranceScore:80,
    evidenceTags:['EQUIPMENT']
  });
  assert.equal(result.capped, false);
  assert.equal(result.score, 97);
  assert.equal(result.reason, 'DIRECT_VERTICAL_EVIDENCE');
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'Hood/Fire',
    score:95,
    posScore:80,
    insuranceScore:82,
    evidenceTags:['HOT_FOOD_SPECIALIST']
  });
  assert.equal(result.capped, false);
  assert.equal(result.score, 95);
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'Hood/Fire',
    score:95,
    posScore:80,
    insuranceScore:82,
    evidenceTags:[]
  });
  assert.equal(result.capped, true);
  assert.equal(result.score, 82);
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'POS',
    score:91,
    posScore:91,
    insuranceScore:70,
    evidenceTags:[]
  });
  assert.equal(result.capped, false);
  assert.equal(result.score, 91);
}

{
  const result = m.applyVerticalEvidenceCeiling({
    category:'Equipment',
    score:97,
    posScore:null,
    insuranceScore:80,
    evidenceTags:[]
  });
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reason, 'REFERENCE_SCORES_MISSING');
}

{
  const r = m.classifySourceObservation({
    transportOk:false,
    intendedFullScope:true,
    fetchedCount:5
  });
  assert.equal(r.state, 'PARTIAL');
  assert.equal(r.supportsPositiveObservation, true);
  assert.equal(r.supportsAbsenceConclusion, false);
  assert.equal(r.reason, 'PARTIAL_FETCH_BEFORE_FAILURE');
}

console.log('PermitPlate Model V7 regression tests passed.');
