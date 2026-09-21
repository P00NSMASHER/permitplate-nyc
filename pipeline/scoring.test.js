'use strict';

const assert = require('assert');
const s = require('./scoring');
const r = require('./scoring-receipt');
const delivery = require('./delivery-plan');

function base(overrides) {
  return Object.assign({
    commercialFit:'HIGH',
    materialAgeDays:2,
    sourceCount:1,
    publicPhone:true,
    stageNumber:1,
    sources:['DOHMH'],
    conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:false,restaurant:false,pokeBowl:false,lightPrep:false},
    knownCuisineType:true,
    actualDohmhPrePermit:false,
    strictVenueLinkedHospitalityDob:false,
    buildingLevelUnmatchedDob:false,
    directEquipmentDobScope:false,
    directHoodFireDobScope:false,
    directHoodExtraScope:false,
    dobInitialCost:null
  }, overrides || {});
}

// Historical base math is preserved.
{
  const out = s.computeScores(base());
  assert.equal(out.status,'SCORED');
  assert.equal(out.scores.POS,68);
  assert.equal(out.scores.Insurance,65);
  assert.equal(out.scores.Waste,52);
  assert.equal(out.scores.Distribution,58);
}

// Missing authority never becomes a low/default score.
{
  const out = s.computeScores(base({commercialFit:null}));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('COMMERCIAL_FIT_UNPROVEN'));
}
{
  const out = s.computeScores(base({materialAgeDays:null}));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('MATERIAL_AGE_UNPROVEN'));
}

// Broad/generated concept labels have zero specialist effect without DIRECT_SOURCE_TEXT authority.
{
  const normal = s.computeScores(base({
    conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:false,restaurant:false,pokeBowl:false,lightPrep:false}
  }));
  const broad = s.computeScores(base({
    conceptEvidence:{authority:'GENERATED_LABEL',hotFood:true,restaurant:true,pokeBowl:false,lightPrep:false}
  }));
  assert.deepEqual(broad.scores,normal.scores);
}

// Accepted SLA corroboration preserves the original timing boosts.
{
  const out = s.computeScores(base({
    sourceCount:2,
    sources:['DOHMH','SLA_PENDING']
  }));
  assert.equal(out.scores.POS,86);
  assert.equal(out.scores.Insurance,85);
}

// Direct-source hot-food evidence can unlock specialist scoring.
{
  const out = s.computeScores(base({
    conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:true,restaurant:false,pokeBowl:false,lightPrep:false}
  }));
  assert(out.scores.Equipment > out.scores.POS);
  assert.equal(out.bestVendorFit,'Equipment');
}

// Accepted venue-linked DOB + direct scope can exceed generic reference ceiling.
{
  const out = s.computeScores(base({
    stageNumber:2,
    sourceCount:2,
    sources:['DOHMH','DOB_NOW'],
    strictVenueLinkedHospitalityDob:true,
    directEquipmentDobScope:true,
    directHoodFireDobScope:true,
    directHoodExtraScope:true,
    dobInitialCost:173900,
    conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:true,restaurant:false,pokeBowl:false,lightPrep:false}
  }));
  assert.equal(out.status,'SCORED');
  assert.equal(out.scores.Equipment,100);
  assert(out.scores['Hood/Fire'] >= out.scores.POS);
}

// EXCLUDE is explicit all-zero suppression.
{
  const out = s.computeScores(base({commercialFit:'EXCLUDE'}));
  assert.equal(out.bestScore,0);
  assert.equal(out.bestVendorFit,'SUPPRESSED');
  assert(Object.values(out.scores).every((value)=>value===0));
}

function candidate(overrides) {
  return Object.assign({
    entityId:'CAMIS:50192386',
    projectSignalId:'PS:crybaby',
    canonicalName:'CRYBABY',
    borough:'Manhattan',
    lifecycleStage:'BUILDOUT / LICENSING',
    sourceLatestEffectiveAt:'2026-09-20T12:00:00Z',
    sourceSystems:['DOHMH','SLA_PENDING','DOB_NOW'],
    sourceCount:3,
    deliverySuppressed:false,
    commercialEvidence:[
      {tag:'EQUIPMENT',sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:M00692498-P1'},
      {tag:'HOOD_FIRE',sourceSystem:'DOB_NOW',sourceRecordId:'DOB_NOW:M00692498-P1'}
    ]
  }, overrides || {});
}

// Score receipt is deterministic and bound to graph + exact change.
{
  const c = candidate();
  const input = {
    candidate:c,
    graphDigest:'graph-1',
    authority:{
      scoredAt:'2026-09-21T12:00:00Z',
      firstDetectedAt:'2026-09-20T12:00:00Z',
      commercialFit:'HIGH',
      publicPhone:true,
      conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:true,restaurant:false,pokeBowl:false,lightPrep:false},
      knownCuisineType:true,
      acceptedDobInitialCost:173900,
      directHoodExtraScope:true
    }
  };
  const first = r.buildScoreReceipt(input);
  const replay = r.buildScoreReceipt(JSON.parse(JSON.stringify(input)));
  assert.equal(first.status,'SCORED');
  assert.equal(first.scoreReceiptId,replay.scoreReceiptId);
  assert.equal(first.changeFingerprint,delivery.candidateChangeFingerprint(c));
  assert.equal(first.graphDigest,'graph-1');
  assert.equal(first.scorerVersion,s.SCORING_VERSION);
  assert.equal(first.scores.Equipment,100);

  const changed = candidate({sourceLatestEffectiveAt:'2026-09-21T13:00:00Z'});
  const second = r.buildScoreReceipt(Object.assign({},input,{candidate:changed}));
  assert.notEqual(second.changeFingerprint,first.changeFingerprint);
  assert.notEqual(second.scoreReceiptId,first.scoreReceiptId);
}

// Receipt refuses missing commercial-fit authority.
{
  const out = r.buildScoreReceipt({
    candidate:candidate(),
    graphDigest:'graph-1',
    authority:{
      scoredAt:'2026-09-21T12:00:00Z',
      firstDetectedAt:'2026-09-20T12:00:00Z'
    }
  });
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('COMMERCIAL_FIT_UNPROVEN'));
}

// A real generated score receipt is accepted by the graph-bound delivery planner.
{
  const c = candidate({
    detectionReceiptId:'DET:crybaby',
    scoreReceiptId:null
  });
  const fp = delivery.candidateChangeFingerprint(c);
  const scoreReceipt = r.buildScoreReceipt({
    candidate:c,
    graphDigest:'graph-live',
    authority:{
      scoredAt:'2026-09-21T12:00:00Z',
      firstDetectedAt:'2026-09-21T11:00:00Z',
      commercialFit:'HIGH',
      publicPhone:false,
      conceptEvidence:{authority:'DIRECT_SOURCE_TEXT',hotFood:true,restaurant:false,pokeBowl:false,lightPrep:false},
      knownCuisineType:true,
      acceptedDobInitialCost:173900,
      directHoodExtraScope:true
    }
  });
  c.scoreReceiptId = scoreReceipt.scoreReceiptId;

  const plan = delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:'graph-live',candidates:[c]},
    profile:{
      subscriberId:'sub-1',
      baselineAt:'2026-09-21T10:00:00Z',
      category:'Equipment',
      boroughs:['Manhattan'],
      minimumScore:60
    },
    detectionReceipts:[{
      receiptId:'DET:crybaby',
      entityId:c.entityId,
      changeFingerprint:fp,
      firstDetectedAt:'2026-09-21T11:00:00Z'
    }],
    scoreReceipts:[scoreReceipt]
  });
  assert.equal(plan.status,'READY');
  assert.equal(plan.signals.length,1);
  assert.equal(plan.signals[0].scoreReceiptId,scoreReceipt.scoreReceiptId);
  assert.equal(plan.signals[0].selectedScore,100);
}

console.log('PermitPlate versioned scoring and score-receipt regression tests passed.');
