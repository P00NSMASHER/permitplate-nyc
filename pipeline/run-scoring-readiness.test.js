'use strict';

const assert = require('assert');
const readiness = require('./run-scoring-readiness');
const promotionCanary = require('./run-scoring-promotion-canary');

function batch(sourceId, overrides={}) {
  return {
    observation:{
      sourceId,
      state:'COMPLETE_NONEMPTY',
      stateReason:'FULL_SCOPE_COMPLETE_NONEMPTY',
      transportOk:true,
      httpStatus:200,
      sourceFresh:true,
      intendedFullScope:true,
      publisherCount:1,
      cursorClosed:true,
      supportsPositiveObservation:true,
      supportsAbsenceConclusion:true,
      ...overrides
    },
    records:[{sourceRecordId:sourceId + ':1'}]
  };
}

{
  const batches = {
    DOHMH:batch('43nn-pn8j',{
      state:'SOURCE_UNAVAILABLE',
      stateReason:'HTTP_503',
      transportOk:false,
      httpStatus:503,
      sourceFresh:false,
      intendedFullScope:false,
      publisherCount:null,
      cursorClosed:false,
      supportsPositiveObservation:false,
      supportsAbsenceConclusion:false
    }),
    SLA_PENDING:batch('snvw-ib2e'),
    DOB_NOW:batch('w9ak-ipjd')
  };
  const result = readiness.auditGraph({
    graphState:'REVIEW',
    graphDigest:null,
    reasons:['DOHMH_SOURCE_OBSERVATION_NOT_USABLE'],
    candidates:[]
  }, batches, '2026-10-16T13:00:00.000Z');

  assert.deepEqual(result.graphReasons,['DOHMH_SOURCE_OBSERVATION_NOT_USABLE']);
  assert.equal(result.readinessState,'GRAPH_NOT_COMPLETE');
  assert.deepEqual(result.sourceObservations[0],{
    sourceKey:'DOB_NOW',
    state:'COMPLETE_NONEMPTY',
    stateReason:'FULL_SCOPE_COMPLETE_NONEMPTY',
    transportOk:true,
    httpStatus:200,
    sourceFresh:true,
    intendedFullScope:true,
    publisherCount:1,
    fetchedCount:1,
    cursorClosed:true,
    supportsPositiveObservation:true,
    supportsAbsenceConclusion:true
  });
  assert.equal(result.sourceObservations[1].sourceKey,'DOHMH');
  assert.equal(result.sourceObservations[1].stateReason,'HTTP_503');
  assert.equal(result.sourceObservations[2].sourceKey,'SLA_PENDING');
}

{
  const batches = {
    DOHMH:batch('43nn-pn8j'),
    SLA_PENDING:batch('snvw-ib2e',{
      state:'VERIFIED_EMPTY',
      stateReason:'FULL_SCOPE_VERIFIED_EMPTY',
      publisherCount:0,
      supportsPositiveObservation:false
    }),
    DOB_NOW:batch('w9ak-ipjd',{
      state:'VERIFIED_EMPTY',
      stateReason:'FULL_SCOPE_VERIFIED_EMPTY',
      publisherCount:0,
      supportsPositiveObservation:false
    })
  };
  batches.SLA_PENDING.records=[];
  batches.DOB_NOW.records=[];

  const result = readiness.auditGraph({
    graphState:'COMPLETE',
    graphDigest:'complete-fixture',
    reasons:[],
    candidates:[]
  }, batches, '2026-10-16T13:00:00.000Z');

  assert.deepEqual(result.graphReasons,[]);
  assert.deepEqual(
    result.sourceObservations.map((source)=>[source.sourceKey,source.state,source.fetchedCount]),
    [
      ['DOB_NOW','VERIFIED_EMPTY',0],
      ['DOHMH','COMPLETE_NONEMPTY',1],
      ['SLA_PENDING','VERIFIED_EMPTY',0]
    ]
  );
}

{
  // Replay the exact aggregate status from the November 10 failed canary.
  const blocked={
    graphState:'COMPLETE',candidateCount:4254,
    productionScoringMode:'CANONICAL_V3_WITH_LEGACY_FALLBACK',
    promotion:{canaryReady:false},
    canonicalProductionReceiptCount:0,
    productionAuthorizedReceiptCount:0,
    canonicalCanaryProbeReceiptCount:1,
    canonicalCanaryProductionAuthorizedCount:0,
    canaryDeliveryBoundaryProbe:{blocked:true},
    productionDeliveryBoundaryProbe:{accepted:false},
    externalSendCalls:0
  };
  const diagnostic=promotionCanary.evaluateCanaryAcceptance(blocked);
  assert.equal(diagnostic.passed,false,'No current overlap must never authorize customer scoring');
  assert.deepEqual(diagnostic.failures,[
    'CURRENT_PROMOTION_EVIDENCE_NOT_READY',
    'CANONICAL_PRODUCTION_RECEIPTS_INCOMPLETE',
    'PRODUCTION_AUTHORIZED_RECEIPTS_INCOMPLETE',
    'PRODUCTION_DELIVERY_NOT_ACCEPTED'
  ]);
  const ready={...blocked,promotion:{canaryReady:true},
    canonicalProductionReceiptCount:4254,
    productionAuthorizedReceiptCount:4254,
    productionDeliveryBoundaryProbe:{accepted:true}};
  assert.deepEqual(promotionCanary.evaluateCanaryAcceptance(ready),{passed:true,failures:[]});
  assert.equal(promotionCanary.evaluateCanaryAcceptance({...ready,
    promotion:{canaryReady:false}}).passed,false,'Numeric receipts do not override evidence hold');
  assert.equal(promotionCanary.evaluateCanaryAcceptance({...ready,
    canaryDeliveryBoundaryProbe:{blocked:false}}).passed,false,'Unsafe canary cannot pass');
  assert.equal(promotionCanary.evaluateCanaryAcceptance({...ready,
    externalSendCalls:1}).passed,false,'External sends cannot pass');
  assert.equal(promotionCanary.evaluateCanaryAcceptance({...ready,
    canonicalCanaryProductionAuthorizedCount:1}).passed,false,'Canary must remain unpromoted');
}

console.log('PermitPlate scoring readiness diagnostics regression tests passed.');
