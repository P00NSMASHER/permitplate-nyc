'use strict';

const assert = require('assert');
const a = require('./source-adapters');

{
  const row = a.normalizeDohmhRow({
    camis:'50192386',
    dba:'CRYBABY',
    boro:'Manhattan',
    building:'153',
    street:'BOWERY',
    zipcode:'10002',
    inspection_date:'2026-09-18T00:00:00.000',
    inspection_type:'Pre-permit (Non-operational) / Initial Inspection',
    record_date:'2026-09-18T00:00:00.000',
    bin:'1000001',
    bbl:'1000000001'
  }, {observedAt:'2026-09-21T13:30:00Z'});
  assert.equal(row.sourceEntityId, 'CAMIS:50192386');
  assert.equal(row.entityKeys.camis, '50192386');
  assert.equal(row.property.address, '153 BOWERY');
  assert.equal(row.parties.operatorName, 'CRYBABY');
  assert.equal(row.eventType, 'DOHMH_PRE_PERMIT_EVENT');
  assert(!Object.prototype.hasOwnProperty.call(row, 'leadScore'));
}

{
  const row = a.normalizeDohmhRow({
    camis:'50111111',
    dba:'NEW APPLICANT',
    boro:'Queens',
    building:'1',
    street:'MAIN ST',
    inspection_date:'1900-01-01T00:00:00.000',
    record_date:'2026-09-21T09:00:00.000',
    inspection_type:''
  }, {observedAt:'2026-09-21T13:30:00Z'});
  assert.equal(row.eventType, 'DOHMH_APPLICANT_RECORD');
  assert.equal(row.sourceEffectiveAt, '2026-09-21T09:00:00.000');
}

{
  const row = a.normalizeDobNowRow({
    job_filing_number:'M00692498-P1',
    filing_status:'Approved',
    house_no:'153',
    street_name:'BOWERY',
    borough:'Manhattan',
    block:'423',
    lot:'12',
    bin:'1000001',
    job_description:'Interior renovation for eating and drinking establishment',
    initial_cost:'$173,900.00',
    owner_s_business_name:'EXAMPLE OWNER LLC',
    filing_date:'2026-09-17T00:00:00.000'
  }, {observedAt:'2026-09-21T13:30:00Z'});
  assert.equal(row.sourceRecordId, 'DOB_NOW:M00692498-P1');
  assert.equal(row.sourceEntityId, null);
  assert.equal(row.entityKeys.bin, '1000001');
  assert.equal(row.property.address, '153 BOWERY');
  assert.equal(row.facts.initial_cost_number, 173900);
}

{
  const row = a.normalizeSlaPendingRow({
    application_id:'NA-0000-26-123456',
    description:'Restaurant Wine',
    legalname:'EXAMPLE HOSPITALITY LLC',
    dba:'EXAMPLE',
    actual_address_of_premises:'153 BOWERY',
    additional_address_information:'GROUND FLOOR',
    city:'NEW YORK',
    state_name:'NY',
    zip_code:'10002',
    received_date:'2026-09-18T00:00:00.000',
    status:'Pending'
  }, {observedAt:'2026-09-21T13:30:00Z'});
  assert.equal(row.sourceEntityId, 'SLA_APPLICATION:NA-0000-26-123456');
  assert.equal(row.property.address, '153 BOWERY');
  assert.equal(row.property.unit, 'GROUND FLOOR');
  assert.equal(row.parties.dba, 'EXAMPLE');
  assert.equal(row.eventType, 'SLA_PENDING_LICENSE');
}

{
  const complete = a.buildSourceObservation('DOHMH', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:1,
    cursorClosed:true,
    schemaFields:['camis','dba','record_date'],
    rawPages:['[{"camis":"1"}]'],
    rows:[{camis:'1', dba:'A', record_date:'2026-09-21'}]
  });
  assert.equal(complete.state, 'COMPLETE_NONEMPTY');
  assert.equal(complete.supportsAbsenceConclusion, true);
  assert(complete.observationId.startsWith('OBS:'));
}

{
  const verifiedEmpty = a.buildSourceObservation('SLA_PENDING', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:0,
    cursorClosed:true,
    schemaFields:['application_id','status','received_date'],
    rawPages:['[]'],
    rows:[]
  });
  assert.equal(verifiedEmpty.state, 'VERIFIED_EMPTY');
  assert.equal(verifiedEmpty.supportsAbsenceConclusion, true);
}

{
  const unprovenEmpty = a.buildSourceObservation('SLA_PENDING', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:0,
    cursorClosed:true,
    rawPages:['[]'],
    rows:[]
  });
  assert.equal(unprovenEmpty.state, 'UNKNOWN');
  assert.equal(unprovenEmpty.supportsAbsenceConclusion, false);
}

{
  const mismatch = a.buildSourceObservation('DOB_NOW', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:2,
    cursorClosed:true,
    schemaFields:['job_filing_number','filing_status'],
    rawPages:['[{"job_filing_number":"A"}]'],
    rows:[{job_filing_number:'A', filing_status:'Approved'}]
  });
  assert.equal(mismatch.state, 'PARTIAL');
}

{
  const moved = a.buildSourceObservation('DOHMH', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:false,
    transportOk:true,
    redirected:true,
    redirectTarget:'https://new.example',
    intendedFullScope:true,
    publisherCount:0,
    cursorClosed:false,
    schemaFields:['camis'],
    rawPages:[''],
    rows:[]
  });
  assert.equal(moved.state, 'SOURCE_MOVED');
}

{
  const batch = a.normalizeBatch('DOHMH', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:1,
    cursorClosed:true,
    schemaFields:['camis','dba','record_date'],
    rawPages:['[{"camis":"501"}]'],
    rows:[{camis:'501', dba:'A', record_date:'2026-09-21'}]
  });
  assert.equal(batch.records.length, 1);
  assert.equal(batch.records[0].sourceObservationId, batch.observation.observationId);
  assert.equal(batch.observation.state, 'COMPLETE_NONEMPTY');
}

{
  const a1 = a.buildSourceObservation('DOHMH', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:1,
    cursorClosed:true,
    schemaFields:['camis','dba'],
    rawPages:['x'],
    rows:[{camis:'1', dba:'A'}]
  });
  const a2 = a.buildSourceObservation('DOHMH', {
    observedAt:'2026-09-21T13:30:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:1,
    cursorClosed:true,
    schemaFields:['dba','camis'],
    rawPages:['x'],
    rows:[{dba:'A', camis:'1'}]
  });
  assert.equal(a1.observationId, a2.observationId);
}

assert.throws(() => a.normalizeDohmhRow({dba:'missing-id'}), /missing CAMIS/);
assert.throws(() => a.normalizeDobNowRow({filing_status:'Approved'}), /missing job_filing_number/);
assert.throws(() => a.normalizeSlaPendingRow({status:'Pending'}), /missing application_id/);

console.log('PermitPlate NYC source adapter tests passed.');
