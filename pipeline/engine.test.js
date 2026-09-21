'use strict';

const assert = require('assert');
const engine = require('./engine');
const project = require('./project-signal');

function sourceMeta(rows, overrides) {
  return Object.assign({
    observedAt:'2026-09-21T14:05:00Z',
    sourceFresh:true,
    transportOk:true,
    intendedFullScope:true,
    publisherCount:rows.length,
    cursorClosed:true,
    schemaFields:Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
    rawPages:[JSON.stringify(rows)],
    rows
  }, overrides || {});
}

const dohmhRow = {
  camis:'50192386',
  dba:'CRYBABY',
  boro:'Manhattan',
  building:'153',
  street:'BOWERY',
  zipcode:'10002',
  record_date:'2026-09-21T00:00:00.000',
  inspection_date:'1900-01-01T00:00:00.000',
  inspection_type:'Pre-permit (Non-operational) / Initial Inspection'
};

const slaRow = {
  application_id:'NA-0000-26-123456',
  description:'Restaurant Wine',
  legalname:'CRYBABY HOSPITALITY LLC',
  dba:'CRYBABY',
  actual_address_of_premises:'153 BOWERY',
  city:'NEW YORK',
  state_name:'NY',
  zip_code:'10002',
  received_date:'2026-09-20T00:00:00.000',
  status:'Pending'
};

const dobRow = {
  job_filing_number:'M00692498-P1',
  filing_status:'Approved',
  house_no:'153',
  street_name:'BOWERY',
  borough:'Manhattan',
  bin:'1000001',
  block:'423',
  lot:'12',
  job_description:'Commercial kitchen equipment, kitchen exhaust hood and fire suppression installation',
  initial_cost:'$173,900.00',
  owner_s_business_name:'UNRELATED PROPERTY OWNER',
  filing_date:'2026-09-20T00:00:00.000'
};

// Clean DOHMH + SLA exact-premise/exact-DBA path.
{
  const result = engine.evaluateOpportunity({
    sources:{
      DOHMH:sourceMeta([dohmhRow]),
      SLA_PENDING:sourceMeta([slaRow])
    },
    primary:{sourceKey:'DOHMH'},
    commercialFit:'HIGH',
    lifecycleStage:'BUILDOUT / LICENSING',
    scoreParts:{
      changeRecencyMateriality:30,
      lifecycleTimingUrgency:22,
      categoryRelevance:20,
      evidenceStrength:18
    },
    subscriberEligibility:{
      baselineAt:'2026-09-21T00:00:00Z',
      firstSignalAt:'2026-09-21T01:00:00Z'
    },
    minimumScore:60
  });

  assert.equal(result.finalDecision, 'DELIVER');
  assert.equal(result.projectSignal.sourceCount, 2);
  assert.deepEqual(result.projectSignal.sourceSystems.sort(), ['DOHMH','SLA_PENDING']);
  assert.equal(result.projectSignal.corroboration.accepted.length, 1);
  assert.equal(result.opportunityDecision.resolution.resolutionStatus, 'RESOLVED');
  assert.equal(result.opportunityDecision.subscriberEligibility.section, 'NORMAL');
}

// Same-site DOB does not corroborate and cannot smuggle trade evidence into the score.
{
  const result = engine.evaluateOpportunity({
    sources:{
      DOHMH:sourceMeta([dohmhRow]),
      DOB_NOW:sourceMeta([dobRow])
    },
    primary:{sourceKey:'DOHMH'},
    commercialFit:'HIGH',
    lifecycleStage:'JUST FILED',
    scoreParts:{
      changeRecencyMateriality:30,
      lifecycleTimingUrgency:20,
      categoryRelevance:15,
      evidenceStrength:15
    },
    subscriberEligibility:{
      baselineAt:'2026-09-21T00:00:00Z',
      firstSignalAt:'2026-09-21T01:00:00Z'
    },
    minimumScore:50,
    verticalScores:{
      Equipment:{score:97,posScore:84,insuranceScore:80},
      'Hood/Fire':{score:95,posScore:84,insuranceScore:80}
    }
  });

  assert.equal(result.finalDecision, 'DELIVER');
  assert.equal(result.projectSignal.sourceCount, 1);
  assert.equal(result.projectSignal.corroboration.accepted.length, 0);
  assert.equal(result.projectSignal.corroboration.rejected.length, 1);
  assert.equal(result.projectSignal.commercialEvidence.length, 0);
  assert.equal(result.verticalScoreResults.Equipment.capped, true);
  assert.equal(result.verticalScoreResults.Equipment.score, 84);
  assert.equal(result.verticalScoreResults['Hood/Fire'].capped, true);
  assert.equal(result.verticalScoreResults['Hood/Fire'].score, 84);
}

// Explicit reviewed bridge admits DOB evidence and unlocks evidence-backed vertical scoring.
{
  const batches = engine.buildBatches({
    DOHMH:sourceMeta([dohmhRow]),
    DOB_NOW:sourceMeta([dobRow])
  });
  const primary = engine.findPrimaryRecord(batches, {sourceKey:'DOHMH'});
  const dob = batches.find((b) => b.records.some((r) => r.sourceSystem === 'DOB_NOW')).records[0];
  const bridge = project.reviewedBridgeKey(primary, dob);

  const result = engine.evaluateOpportunity({
    sources:{
      DOHMH:sourceMeta([dohmhRow]),
      DOB_NOW:sourceMeta([dobRow])
    },
    primary:{sourceKey:'DOHMH'},
    reviewedIdentityBridges:[bridge],
    commercialFit:'HIGH',
    lifecycleStage:'BUILDOUT / LICENSING',
    scoreParts:{
      changeRecencyMateriality:30,
      lifecycleTimingUrgency:25,
      categoryRelevance:25,
      evidenceStrength:20
    },
    subscriberEligibility:{
      baselineAt:'2026-09-21T00:00:00Z',
      firstSignalAt:'2026-09-21T01:00:00Z'
    },
    minimumScore:60,
    verticalScores:{
      Equipment:{score:97,posScore:84,insuranceScore:80},
      'Hood/Fire':{score:95,posScore:84,insuranceScore:80}
    }
  });

  assert.equal(result.finalDecision, 'DELIVER');
  assert.equal(result.projectSignal.sourceCount, 2);
  assert(result.projectSignal.commercialEvidence.some((x) => x.tag === 'EQUIPMENT'));
  assert(result.projectSignal.commercialEvidence.some((x) => x.tag === 'HOOD_FIRE'));
  assert.equal(result.verticalScoreResults.Equipment.capped, false);
  assert.equal(result.verticalScoreResults.Equipment.score, 97);
  assert.equal(result.verticalScoreResults['Hood/Fire'].capped, false);
  assert.equal(result.verticalScoreResults['Hood/Fire'].score, 95);
}

// Source failure cannot mint a customer decision from zero rows.
{
  const result = engine.evaluateOpportunity({
    sources:{
      DOHMH:sourceMeta([dohmhRow], {
        sourceFresh:false,
        transportOk:false,
        intendedFullScope:true
      })
    },
    primary:{sourceKey:'DOHMH'},
    commercialFit:'HIGH',
    scoreParts:{
      changeRecencyMateriality:30,
      lifecycleTimingUrgency:25,
      categoryRelevance:25,
      evidenceStrength:20
    },
    postBaseline:true,
    minimumScore:60
  });
  assert.equal(result.finalDecision, 'REVIEW');
  assert(result.reasons.includes('PRIMARY_SOURCE_OBSERVATION_NOT_USABLE'));
}

// Exact input replay is deterministic.
{
  const input = {
    sources:{DOHMH:sourceMeta([dohmhRow])},
    primary:{sourceKey:'DOHMH'},
    commercialFit:'HIGH',
    scoreParts:{
      changeRecencyMateriality:25,
      lifecycleTimingUrgency:20,
      categoryRelevance:20,
      evidenceStrength:15
    },
    subscriberEligibility:{
      baselineAt:'2026-09-21T00:00:00Z',
      firstSignalAt:'2026-09-21T01:00:00Z'
    },
    minimumScore:50
  };
  const first = engine.evaluateOpportunity(input);
  const second = engine.evaluateOpportunity(JSON.parse(JSON.stringify(input)));
  assert.equal(first.engineFingerprint, second.engineFingerprint);
  assert.equal(first.projectSignal.signalId, second.projectSignal.signalId);
  assert.equal(first.opportunityDecision.replayFingerprint, second.opportunityDecision.replayFingerprint);
}

console.log('PermitPlate end-to-end engine regression tests passed.');
