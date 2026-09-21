'use strict';

const assert = require('assert');
const p = require('./project-signal');

function record(overrides) {
  return Object.assign({
    jurisdiction:'NYC',
    sourceSystem:'DOHMH',
    sourceRecordId:'DOHMH:50100000:x',
    sourceEntityId:'CAMIS:50100000',
    sourceUrl:'https://example.test/dohmh/50100000',
    sourceObservationId:'OBS:a',
    entityKeys:{camis:'50100000',bin:'1000001'},
    property:{address:'1590 PARK AVENUE',bin:'1000001'},
    parties:{operatorName:'PRIMARY CAFE'},
    facts:{inspection_type:'Pre-permit (Non-operational) / Initial Inspection'}
  }, overrides || {});
}

// Known La Marqueta/EASTHARLEM failure class: same site is not same entity.
{
  const primary = record();
  const sharedSiteDob = record({
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M01329447-I1',
    sourceEntityId:null,
    sourceUrl:'https://example.test/dob/M01329447-I1',
    entityKeys:{jobFilingNumber:'M01329447-I1',bin:'1000001'},
    property:{address:'1590 PARK AVENUE',bin:'1000001'},
    parties:{ownerBusinessName:'CITY PROPERTY OWNER'},
    facts:{job_description:'Interior renovation'}
  });
  const result = p.corroborate(primary, sharedSiteDob);
  assert.equal(result.coLocated, true);
  assert.equal(result.corroborates, false);
  assert(result.reasons.includes('COLOCATED_ONLY'));
}

// Same namespace stable-ID contradiction always fails closed.
{
  const primary = record();
  const otherCamis = record({
    sourceRecordId:'DOHMH:50199999:y',
    sourceEntityId:'CAMIS:50199999',
    entityKeys:{camis:'50199999',bin:'1000001'},
    parties:{operatorName:'PRIMARY CAFE'}
  });
  const result = p.corroborate(primary, otherCamis);
  assert.equal(result.corroborates, false);
  assert.equal(result.confidence, 'REJECTED');
  assert.equal(result.conflict.namespace, 'camis');
}

// SLA corroboration requires same premises + exact business name bridge.
{
  const primary = record({
    property:{address:'153 BOWERY'},
    parties:{operatorName:'CRYBABY'}
  });
  const sla = record({
    sourceSystem:'SLA_PENDING',
    sourceRecordId:'SLA_PENDING:NA-1',
    sourceEntityId:'SLA_APPLICATION:NA-1',
    sourceUrl:'https://example.test/sla/NA-1',
    entityKeys:{applicationId:'NA-1'},
    property:{address:'153 BOWERY'},
    parties:{dba:'CRYBABY',legalName:'CRYBABY HOSPITALITY LLC'},
    facts:{description:'Restaurant Wine',status:'Pending'}
  });
  const result = p.corroborate(primary, sla);
  assert.equal(result.corroborates, true);
  assert.equal(result.confidence, 'HIGH');
  assert(result.reasons.includes('EXACT_BUSINESS_NAME_BRIDGE'));
}

{
  const primary = record({
    property:{address:'153 BOWERY'},
    parties:{operatorName:'CRYBABY'}
  });
  const unrelatedSla = record({
    sourceSystem:'SLA_PENDING',
    sourceRecordId:'SLA_PENDING:NA-2',
    sourceEntityId:'SLA_APPLICATION:NA-2',
    entityKeys:{applicationId:'NA-2'},
    property:{address:'153 BOWERY'},
    parties:{dba:'OTHER VENUE'},
    facts:{description:'Restaurant Wine',status:'Pending'}
  });
  const result = p.corroborate(primary, unrelatedSla);
  assert.equal(result.corroborates, false);
  assert.equal(result.coLocated, true);
}

// A reviewed explicit bridge can admit a cross-source record without weakening defaults.
{
  const primary = record();
  const dob = record({
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M99999999-I1',
    sourceEntityId:null,
    entityKeys:{jobFilingNumber:'M99999999-I1',bin:'1000001'},
    parties:{},
    facts:{job_description:'Commercial kitchen equipment and hood fire suppression installation'}
  });
  const bridge = p.reviewedBridgeKey(primary, dob);
  assert.equal(p.corroborate(primary, dob).corroborates, false);
  const reviewed = p.corroborate(primary, dob, {reviewedIdentityBridges:[bridge]});
  assert.equal(reviewed.corroborates, true);
  assert(reviewed.reasons.includes('REVIEWED_IDENTITY_BRIDGE'));
}

// Commercial evidence is evidence-tagging only; it does not manufacture a score.
{
  const dob = record({
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M1',
    sourceUrl:'https://example.test/dob/M1',
    facts:{job_description:'Commercial kitchen equipment, kitchen exhaust hood and fire suppression; interior demolition'}
  });
  const mapped = p.mapCommercialEvidence([dob]);
  const tags = mapped.map((x) => x.tag).sort();
  assert.deepEqual(tags, ['EQUIPMENT','HOOD_FIRE','WASTE']);
  assert(mapped.every((x) => x.sourceRecordId === 'DOB_NOW:M1'));
  assert(mapped.every((x) => x.sourceUrl === 'https://example.test/dob/M1'));
  assert(mapped.every((x) => !Object.prototype.hasOwnProperty.call(x, 'score')));
}

{
  const generic = record({
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M2',
    facts:{job_description:'Interior renovation'}
  });
  assert.equal(p.mapCommercialEvidence([generic]).length, 0);
}

// ProjectSignal source count uses only accepted same-entity evidence.
{
  const primary = record({
    sourceRecordId:'DOHMH:1',
    property:{address:'153 BOWERY'},
    parties:{operatorName:'CRYBABY'}
  });
  const sla = record({
    sourceSystem:'SLA_PENDING',
    sourceRecordId:'SLA_PENDING:1',
    sourceEntityId:'SLA_APPLICATION:1',
    entityKeys:{applicationId:'1'},
    property:{address:'153 BOWERY'},
    parties:{dba:'CRYBABY'},
    facts:{description:'Restaurant Wine'}
  });
  const unrelatedDob = record({
    sourceSystem:'DOB_NOW',
    sourceRecordId:'DOB_NOW:M01329447-I1',
    sourceEntityId:null,
    entityKeys:{jobFilingNumber:'M01329447-I1',bin:'1000001'},
    property:{address:'153 BOWERY',bin:'1000001'},
    parties:{ownerBusinessName:'UNRELATED OWNER'},
    facts:{job_description:'Commercial kitchen equipment and fire suppression'}
  });

  const signal = p.buildProjectSignal(primary, [sla, unrelatedDob]);
  assert.equal(signal.sourceCount, 2);
  assert.deepEqual(signal.sourceSystems.sort(), ['DOHMH','SLA_PENDING']);
  assert.equal(signal.corroboration.accepted.length, 1);
  assert.equal(signal.corroboration.rejected.length, 1);
  assert.equal(signal.commercialEvidence.some((x) => x.sourceRecordId === unrelatedDob.sourceRecordId), false);
}

// Replays with the same accepted identities are deterministic.
{
  const primary = record({sourceRecordId:'DOHMH:stable'});
  const first = p.buildProjectSignal(primary, []);
  const second = p.buildProjectSignal(JSON.parse(JSON.stringify(primary)), []);
  assert.equal(first.signalId, second.signalId);
}

console.log('PermitPlate ProjectSignal regression tests passed.');
