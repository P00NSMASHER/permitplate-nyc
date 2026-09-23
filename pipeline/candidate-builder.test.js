'use strict';

const assert = require('assert');
const adapters = require('./source-adapters');
const builder = require('./candidate-builder');
const project = require('./project-signal');

function observation(sourceKey, rows, state='COMPLETE_NONEMPTY') {
  const sourceId = adapters.SOURCE_CONFIGS[sourceKey].sourceId;
  return {
    observation:{
      observationId:'OBS:'+sourceKey,
      sourceId,
      state,
      supportsPositiveObservation:['COMPLETE_NONEMPTY','PARTIAL'].includes(state),
      supportsAbsenceConclusion:['COMPLETE_NONEMPTY','VERIFIED_EMPTY'].includes(state)
    },
    records:rows
  };
}

function dohmh(row) {
  return adapters.normalizeDohmhRow(row,{observedAt:'2026-09-21T14:00:00Z'});
}
function sla(row) {
  return adapters.normalizeSlaPendingRow(row,{observedAt:'2026-09-21T14:00:00Z'});
}
function dob(row) {
  return adapters.normalizeDobNowRow(row,{observedAt:'2026-09-21T14:00:00Z'});
}

const currentApplicant = dohmh({
  camis:'50192488',
  dba:'KOKE',
  boro:'Manhattan',
  building:'173',
  street:'BLEECKER STREET',
  zipcode:'10012',
  inspection_date:'1900-01-01T00:00:00.000',
  record_date:'2026-09-18T12:00:00.000'
});

// Zone-less Socrata timestamps are UTC regardless of the runner's local timezone.
{
  assert.equal(
    builder.timeMs('2026-09-18T12:00:00.000'),
    Date.parse('2026-09-18T12:00:00.000Z')
  );
  assert.equal(
    builder.timeMs('2026-09-18T12:00:00-04:00'),
    Date.parse('2026-09-18T16:00:00.000Z')
  );
  assert.equal(builder.timeMs('not-a-date'),null);
}
const predecessorPrepermit = dohmh({
  camis:'50184059',
  dba:'OLDER OPERATOR',
  boro:'Manhattan',
  building:'173',
  street:'BLEECKER STREET',
  zipcode:'10012',
  inspection_date:'2026-09-14T00:00:00.000',
  record_date:'2026-09-14T12:00:00.000',
  inspection_type:'Pre-permit (Non-operational) / Initial Inspection'
});

{
  const candidates = builder.buildDohmhCandidates([currentApplicant, predecessorPrepermit]);
  assert.equal(candidates.length,2);
  const current = candidates.find((x)=>x.camis==='50192488');
  const pred = candidates.find((x)=>x.camis==='50184059');
  assert.equal(current.lifecycleStage,'JUST FILED');
  assert.equal(pred.lifecycleStage,'HEALTH PRE-PERMIT');
  assert.equal(current.sourceLatestEffectiveAt,'2026-09-18T12:00:00.000Z');
}

{
  const candidates = builder.applyCrossCamisOperationalConflicts(
    builder.buildDohmhCandidates([currentApplicant, predecessorPrepermit])
  );
  const current = candidates.find((x)=>x.camis==='50192488');
  assert.equal(current.deliverySuppressed,true);
  assert(current.suppressionReasons.includes('CROSS_CAMIS_OPERATIONAL_CONFLICT'));
  assert.equal(current.crossCamisOperationalConflicts.length,1);
  assert.equal(current.crossCamisOperationalConflicts[0].camis,'50184059');
}

{
  const unrelated = dohmh({
    camis:'50199999',
    dba:'OTHER PLACE',
    boro:'Brooklyn',
    building:'10',
    street:'OTHER STREET',
    zipcode:'11201',
    inspection_date:'2026-09-15T00:00:00.000',
    record_date:'2026-09-15T00:00:00.000',
    inspection_type:'Pre-permit (Non-operational) / Initial Inspection'
  });
  const candidates = builder.applyCrossCamisOperationalConflicts(
    builder.buildDohmhCandidates([currentApplicant, unrelated])
  );
  assert.equal(candidates.find((x)=>x.camis==='50192488').deliverySuppressed,false);
}

{
  const venue = dohmh({
    camis:'50112345',
    dba:'CRYBABY',
    boro:'Manhattan',
    building:'153',
    street:'BOWERY',
    zipcode:'10002',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-09-21T09:00:00.000'
  });
  const exactSla = sla({
    application_id:'NA-1',
    dba:'CRYBABY',
    legalname:'CRYBABY HOSPITALITY LLC',
    actual_address_of_premises:'153 BOWERY',
    additional_address_information:'GROUND FLOOR',
    city:'NEW YORK',
    state_name:'NY',
    zip_code:'10002',
    received_date:'2026-09-20T00:00:00.000',
    status:'Pending'
  });
  const sameSiteDob = dob({
    job_filing_number:'M01329447-I1',
    house_no:'153',
    street_name:'BOWERY',
    borough:'Manhattan',
    bin:'1000001',
    block:'1',
    lot:'1',
    owner_s_business_name:'UNRELATED PROPERTY OWNER',
    job_description:'Commercial kitchen equipment and hood fire suppression',
    filing_date:'2026-09-20T00:00:00.000'
  });

  const graph = builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[venue]),
    slaBatch:observation('SLA_PENDING',[exactSla]),
    dobBatch:observation('DOB_NOW',[sameSiteDob])
  });
  assert.equal(graph.graphState,'COMPLETE');
  assert.equal(graph.metrics.candidateCount,1);
  const candidate=graph.candidates[0];
  assert.equal(candidate.sourceCount,2);
  assert.deepEqual(candidate.sourceSystems.sort(),['DOHMH','SLA_PENDING']);
  assert.equal(candidate.projectSignal.corroboration.accepted.length,1);
  assert.equal(candidate.projectSignal.corroboration.rejected.length,1);
  assert.equal(candidate.commercialEvidence.some((x)=>x.sourceRecordId==='DOB_NOW:M01329447-I1'),false);
  assert.equal(graph.metrics.rejectedDobColocationCount,1);
}

{
  const venue = dohmh({
    camis:'50112345',
    dba:'CRYBABY',
    building:'153',
    street:'BOWERY',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-09-21T09:00:00.000'
  });
  const sameSiteDob = dob({
    job_filing_number:'M1',
    house_no:'153',
    street_name:'BOWERY',
    job_description:'Commercial kitchen equipment and hood fire suppression',
    filing_date:'2026-09-20T00:00:00.000'
  });
  const bridge=project.reviewedBridgeKey(venue,sameSiteDob);
  const graph=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[venue]),
    slaBatch:observation('SLA_PENDING',[],'VERIFIED_EMPTY'),
    dobBatch:observation('DOB_NOW',[sameSiteDob]),
    reviewedIdentityBridges:[bridge]
  });
  assert.equal(graph.candidates[0].sourceCount,2);
  assert.equal(graph.metrics.acceptedDobReviewedCorroborationCount,1);
  assert(graph.candidates[0].commercialEvidence.some((x)=>x.tag==='EQUIPMENT'));
}

{
  const partial=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[currentApplicant],'PARTIAL'),
    slaBatch:observation('SLA_PENDING',[],'VERIFIED_EMPTY'),
    dobBatch:observation('DOB_NOW',[],'VERIFIED_EMPTY')
  });
  assert.equal(partial.graphState,'PARTIAL');
  assert.equal(partial.metrics.candidateCount,1);
  assert(partial.reasons.includes('DOHMH_SOURCE_WINDOW_NOT_COMPLETE'));
  assert.equal(partial.metrics.sourceCompleteness.DOHMH,false);
}

{
  const unusable=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[],'SOURCE_UNAVAILABLE')
  });
  assert.equal(unusable.graphState,'REVIEW');
  assert.equal(unusable.metrics.candidateCount,0);
}

{
  const auxOutage=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[currentApplicant]),
    slaBatch:observation('SLA_PENDING',[],'SOURCE_UNAVAILABLE'),
    dobBatch:observation('DOB_NOW',[],'VERIFIED_EMPTY')
  });
  assert.equal(auxOutage.graphState,'PARTIAL');
  assert.equal(auxOutage.metrics.candidateCount,1);
  assert(auxOutage.reasons.includes('SLA_SOURCE_WINDOW_NOT_COMPLETE'));
  assert.equal(auxOutage.metrics.sourceCompleteness.DOHMH,true);
  assert.equal(auxOutage.metrics.sourceCompleteness.SLA_PENDING,false);
  assert.equal(auxOutage.metrics.sourceCompleteness.DOB_NOW,true);
}

{
  const first=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[currentApplicant,predecessorPrepermit])
  });
  const second=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',[predecessorPrepermit,currentApplicant])
  });
  assert.equal(first.graphDigest,second.graphDigest);
}

console.log('PermitPlate candidate graph regression tests passed.');
