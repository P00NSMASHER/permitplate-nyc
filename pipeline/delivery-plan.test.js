'use strict';

const assert = require('assert');
const p = require('./delivery-plan');

const GRAPH_DIGEST = 'graph-digest-1';
const BASELINE = '2026-09-21T12:00:00Z';

function candidate(id, overrides) {
  const base = {
    entityId:id,
    projectSignalId:'PS:'+id,
    canonicalName:'Venue '+id,
    borough:'Manhattan',
    lifecycleStage:'JUST FILED',
    sourceLatestEffectiveAt:'2026-09-21T11:00:00Z',
    sourceSystems:['DOHMH'],
    commercialEvidence:[],
    deliverySuppressed:false,
    detectionReceiptId:'DET:'+id,
    scoreReceiptId:'SCORE:'+id
  };
  return Object.assign(base, overrides || {});
}

function boundReceipts(candidates, detections, scoreOverrides) {
  const detectionReceipts = [];
  const scoreReceipts = [];
  for (const c of candidates) {
    const fp = p.candidateChangeFingerprint(c);
    const det = Object.assign({
      receiptId:c.detectionReceiptId,
      entityId:c.entityId,
      changeFingerprint:fp,
      firstDetectedAt:'2026-09-21T13:00:00Z'
    }, detections && detections[c.entityId] || {});
    detectionReceipts.push(det);

    const score = Object.assign({
      scoreReceiptId:c.scoreReceiptId,
      entityId:c.entityId,
      changeFingerprint:fp,
      graphDigest:GRAPH_DIGEST,
      scorerVersion:'PermitPlate-score-fixture-v1',
      productionAuthorized:true,
      scores:{
        POS:80,
        Insurance:75,
        Equipment:70,
        'Hood/Fire':65,
        Waste:60,
        Pest:55,
        Linen:50,
        Distribution:45
      }
    }, scoreOverrides && scoreOverrides[c.entityId] || {});
    scoreReceipts.push(score);
  }
  return {detectionReceipts, scoreReceipts};
}

function plan(candidates, profileOverrides, receiptOverrides) {
  const bound = boundReceipts(
    candidates,
    receiptOverrides && receiptOverrides.detections,
    receiptOverrides && receiptOverrides.scores
  );
  return p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates},
    profile:Object.assign({
      subscriberId:'sub-1',
      baselineAt:BASELINE,
      category:'POS',
      boroughs:['Manhattan'],
      minimumScore:60,
      starterSnapshotEnabled:true,
      starterDays:7,
      starterLimit:10,
      maxSignals:25
    }, profileOverrides || {}),
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts,
    deliveredSignalKeys:[]
  });
}

// New, starter and old backlog are separated deterministically.
{
  const c1 = candidate('new');
  const c2 = candidate('starter');
  const c3 = candidate('old');
  const bound = boundReceipts([c1,c2,c3], {
    new:{firstDetectedAt:'2026-09-21T13:00:00Z'},
    starter:{firstDetectedAt:'2026-09-18T12:00:00Z'},
    old:{firstDetectedAt:'2026-09-01T12:00:00Z'}
  });
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c1,c2,c3]},
    profile:{
      subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',
      boroughs:['Manhattan'],minimumScore:60,
      starterSnapshotEnabled:true,starterDays:7,starterLimit:10,maxSignals:25
    },
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts,
    deliveredSignalKeys:[]
  });
  assert.equal(result.status,'READY');
  assert.equal(result.normalCount,1);
  assert.equal(result.starterCount,1);
  assert.equal(result.signals.length,2);
  assert(result.signals.some((x)=>x.entityId==='new' && x.section==='NORMAL'));
  assert(result.signals.some((x)=>x.entityId==='starter' && x.section==='STARTER'));
  assert(result.excluded.some((x)=>x.entityId==='old' && x.reasons.includes('PRE_BASELINE_BACKLOG')));
}

// A later material change uses the normal namespace even if the entity could have been in Starter.
{
  const c = candidate('reopen');
  const bound = boundReceipts([c], {
    reopen:{
      firstDetectedAt:'2026-09-18T12:00:00Z',
      materialChangeAt:'2026-09-21T14:00:00Z'
    }
  });
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{
      subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',
      minimumScore:60,starterSnapshotEnabled:true,starterDays:7
    },
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts
  });
  assert.equal(result.signals[0].section,'NORMAL');
  assert(result.signals[0].signalKey.startsWith('normal:'));
}

// Missing score receipt is REVIEW, never a silent low score.
{
  const c = candidate('missing-score');
  const bound = boundReceipts([c]);
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',minimumScore:0},
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:[]
  });
  assert.equal(result.signals.length,0);
  assert.equal(result.reviews.length,1);
  assert(result.reviews[0].reasons.includes('SCORE_RECEIPT_MISSING'));
}

// Score authority must match exact graph digest and change fingerprint.
{
  const c = candidate('bad-score');
  const bound = boundReceipts([c], null, {
    'bad-score':{graphDigest:'wrong-graph'}
  });
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',minimumScore:0},
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts
  });
  assert.equal(result.signals.length,0);
  assert(result.reviews[0].reasons.includes('SCORE_GRAPH_MISMATCH'));
}

// A bootstrap/baseline detection receipt can never enter a customer feed.
{
  const c = candidate('baseline-detection');
  const fp = p.candidateChangeFingerprint(c);
  const bound = boundReceipts([c]);
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',minimumScore:0},
    detectionReceipts:[{
      receiptId:c.detectionReceiptId,
      entityId:c.entityId,
      changeFingerprint:fp,
      detectionClass:'BASELINE_EXISTING',
      customerEligible:false,
      firstDetectedAt:'2026-09-21T13:00:00Z'
    }],
    scoreReceipts:bound.scoreReceipts
  });
  assert.equal(result.signals.length,0);
  assert.equal(result.reviews.length,1);
  assert(result.reviews[0].reasons.includes('DETECTION_NOT_CUSTOMER_ELIGIBLE'));
}

// A canary/shadow score receipt can never reach customer delivery.
{
  const c = candidate('canary-score');
  const bound = boundReceipts([c], null, {
    'canary-score':{productionAuthorized:false}
  });
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',minimumScore:0},
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts
  });
  assert.equal(result.signals.length,0);
  assert.equal(result.reviews.length,1);
  assert(result.reviews[0].reasons.includes('SCORE_NOT_PRODUCTION_AUTHORIZED'));
}

// Candidate suppression and profile/threshold filters cannot be overridden by score.
{
  const suppressed = candidate('suppressed',{deliverySuppressed:true});
  const queens = candidate('queens',{borough:'Queens'});
  const low = candidate('low');
  const bound = boundReceipts([suppressed,queens,low], null, {
    low:{scores:{POS:59,Insurance:99,Equipment:99,'Hood/Fire':99,Waste:99,Pest:99,Linen:99,Distribution:99}}
  });
  const result = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[suppressed,queens,low]},
    profile:{
      subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',
      boroughs:['Manhattan'],minimumScore:60
    },
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts
  });
  assert.equal(result.signals.length,0);
  assert(result.excluded.some((x)=>x.entityId==='suppressed' && x.reasons.includes('CANDIDATE_SUPPRESSED')));
  assert(result.excluded.some((x)=>x.entityId==='queens' && x.reasons.includes('BOROUGH_FILTERED')));
  assert(result.excluded.some((x)=>x.entityId==='low' && x.reasons.includes('BELOW_SCORE_THRESHOLD')));
}

// Incomplete graph fails the whole report closed by default.
{
  const result = p.planCustomerDelivery({
    graph:{graphState:'PARTIAL',graphDigest:GRAPH_DIGEST,candidates:[]},
    profile:{subscriberId:'sub-1',baselineAt:BASELINE,category:'POS'}
  });
  assert.equal(result.status,'REVIEW');
  assert(result.failures.includes('GRAPH_NOT_COMPLETE'));
}

// Delivered signal key is exactly-once from customer perspective.
{
  const c = candidate('dedupe');
  const first = plan([c]);
  assert.equal(first.signals.length,1);
  const key = first.signals[0].signalKey;
  const bound = boundReceipts([c]);
  const second = p.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest:GRAPH_DIGEST,candidates:[c]},
    profile:{
      subscriberId:'sub-1',baselineAt:BASELINE,category:'POS',
      boroughs:['Manhattan'],minimumScore:60,
      starterSnapshotEnabled:true,starterDays:7
    },
    detectionReceipts:bound.detectionReceipts,
    scoreReceipts:bound.scoreReceipts,
    deliveredSignalKeys:[key]
  });
  assert.equal(second.signals.length,0);
  assert(second.excluded.some((x)=>x.reasons.includes('ALREADY_DELIVERED')));
}

// Plan and attempt identity are deterministic.
{
  const c = candidate('deterministic');
  const a = plan([c]);
  const b = plan([JSON.parse(JSON.stringify(c))]);
  assert.equal(a.planFingerprint,b.planFingerprint);
  const x = p.createDeliveryAttempt(a,'OWNER@example.com');
  const y = p.createDeliveryAttempt(b,'owner@example.com');
  assert.equal(x.attemptId,y.attemptId);
  assert.equal(x.messageIdentity,y.messageIdentity);
}

// Provider acceptance can recover local-finalization loss exactly once.
{
  const c = candidate('provider');
  const deliveryPlan = plan([c]);
  const attempt = p.createDeliveryAttempt(deliveryPlan,'owner@example.com');
  let delivered = new Set();

  const unknown = p.reconcileProviderObservation(attempt,{
    status:'UNKNOWN',
    messageIdentity:attempt.messageIdentity
  },delivered);
  assert.equal(unknown.state,'PENDING');
  assert.equal(unknown.delivered.size,0);

  const wrong = p.reconcileProviderObservation(attempt,{
    status:'ACCEPTED',
    messageIdentity:'wrong',
    providerMessageId:'provider-1'
  },delivered);
  assert.equal(wrong.state,'REVIEW');
  assert.equal(wrong.delivered.size,0);

  const accepted = p.reconcileProviderObservation(attempt,{
    status:'ACCEPTED',
    messageIdentity:attempt.messageIdentity,
    providerMessageId:'provider-1'
  },delivered);
  assert.equal(accepted.state,'FINALIZED');
  assert.equal(accepted.newlyDelivered.length,1);
  delivered = accepted.delivered;

  const replay = p.reconcileProviderObservation(attempt,{
    status:'ACCEPTED',
    messageIdentity:attempt.messageIdentity,
    providerMessageId:'provider-1'
  },delivered);
  assert.equal(replay.state,'FINALIZED');
  assert.equal(replay.reason,'IDEMPOTENT_REPLAY');
  assert.equal(replay.newlyDelivered.length,0);
  assert.equal(replay.delivered.size,1);
}

console.log('PermitPlate graph-bound delivery planner canary passed.');
