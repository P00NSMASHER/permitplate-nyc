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

// Actual DOHMH October 21 snapshot repeated seven identical violation rows
// for CAMIS 50186277. Publisher row count must remain intact, but the graph
// must not count byte-identical facts twice as independent observations.
{
  const original=predecessorPrepermit;
  const duplicate=structuredClone(original);
  assert.equal(original.sourceRecordId,duplicate.sourceRecordId);
  assert.equal(original.rawFactFingerprint,duplicate.rawFactFingerprint);
  const publisherRows=[original,duplicate];
  const candidates=builder.buildDohmhCandidates(publisherRows);
  const baseline=builder.buildDohmhCandidates([original]);
  assert.equal(publisherRows.length,2); // Source evidence never rewritten.
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].dohmhRecordCount,1);
  assert.deepEqual(candidates[0].dohmhRecordIds,[original.sourceRecordId]);
  assert.deepEqual(candidates,baseline);
  const spoofed={...duplicate,rawFactFingerprint:'f'.repeat(64)};
  assert.throws(()=>builder.buildDohmhCandidates([original,spoofed]),
    /DOHMH_SOURCE_RECORD_ID_COLLISION/);
}

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


// Real NYC DOHMH snapshot included 70 CAMIS entries with borough '0',
// sometimes with non-NYC ZIPs. A ZIP code or shared premise is not verified
// borough evidence. Unknown and contradictory original boroughs fail closed.
{
  const applicant=(camis,boro,zip,street)=>dohmh({
    camis,dba:'Borough Source Test '+camis,
    ...(boro===undefined?{}:{boro}),
    building:'10',street,zipcode:zip,
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-10-20T06:00:27.000'
  });
  const invalid=applicant('50126672','0','08512','UNVERIFIED ROAD');
  const absent=applicant('50126674',undefined,'10012','NO BOROUGH ROAD');
  const valid=applicant('50126673','Manhattan','10012','VALID ROAD');
  const conflicting=applicant('50126675','Manhattan','10012','MIXED ROAD');
  const contradictory=dohmh({
    camis:'50126675',dba:'Borough Source Test 50126675',
    boro:'Bronx',building:'10',street:'MIXED ROAD',zipcode:'10012',
    inspection_date:'2026-10-17T00:00:00.000',
    inspection_type:'Pre-permit (Non-operational) / Initial Inspection',
    record_date:'2026-10-20T06:00:27.000'
  });
  const rows=[invalid,absent,valid,conflicting,contradictory];
  const originalFacts=JSON.stringify(rows);
  const graph=builder.buildCurrentGraph({
    dohmhBatch:observation('DOHMH',rows),
    slaBatch:observation('SLA_PENDING',[],'VERIFIED_EMPTY'),
    dobBatch:observation('DOB_NOW',[],'VERIFIED_EMPTY')
  });
  assert.equal(graph.graphState,'COMPLETE');
  assert.equal(graph.metrics.candidateCount,4);
  assert.equal(graph.metrics.suppressedCount,3);
  const byCamis=new Map(graph.candidates.map(x=>[x.camis,x]));
  for(const camis of ['50126672','50126674','50126675']){
    const x=byCamis.get(camis);
    assert.equal(x.deliverySuppressed,true,camis);
    assert(x.suppressionReasons.includes('NYC_BOROUGH_UNVERIFIED'),camis);
    assert.equal(require('./curated-research-ledger').eligibleCandidate(x),false,camis);
  }
  const ambiguous=byCamis.get('50126675');
  assert(ambiguous.suppressionReasons.includes('NYC_BOROUGH_CONFLICT'));
  assert.equal(ambiguous.lifecycleStage,'HEALTH PRE-PERMIT');
  assert.equal(byCamis.get('50126672').borough,'0'); // Preserve source fact.
  assert.equal(byCamis.get('50126674').borough,null); // Never infer from ZIP.
  const verified=byCamis.get('50126673');
  assert.equal(verified.borough,'Manhattan');
  assert.equal(verified.deliverySuppressed,false);
  assert.deepEqual(verified.suppressionReasons,[]);
  assert.equal(JSON.stringify(rows),originalFacts); // Do not change official rows.
}

console.log('PermitPlate candidate graph regression tests passed.');
