'use strict';

const assert = require('assert');
const scoring = require('./scoring');
const receipt = require('./scoring-receipt');
const delivery = require('./delivery-plan');
const snapshot = require('../scoring/legacy-score-authority-2026-09-18.json');

function authorityRecord() {
  const record = snapshot.records.find((item) =>
    item && item.authorityKey && item.authorityKey.camis &&
    Number(item.sourceCount) === 1 &&
    Array.isArray(item.sources) &&
    item.sources.length === 1 &&
    String(item.sources[0]).toUpperCase() === 'DOHMH' &&
    String(item.stage) === 'JUST FILED'
  );
  if (!record) throw new Error('Expected at least one DOHMH-only legacy authority record');
  return record;
}

function candidateFrom(record, overrides) {
  const camis = String(record.authorityKey.camis);
  return Object.assign({
    entityId:'CAMIS:' + camis,
    camis,
    projectSignalId:'PS:legacy:' + camis,
    canonicalName:'Legacy-authorized candidate',
    borough:'Manhattan',
    lifecycleStage:record.stage,
    sourceLatestEffectiveAt:record.lastUpdated,
    sourceSystems:record.sources.slice(),
    sourceCount:Number(record.sourceCount),
    deliverySuppressed:false,
    commercialEvidence:[],
    detectionReceiptId:'DET:' + camis,
    scoreReceiptId:null
  }, overrides || {});
}

function expectedScores(record) {
  return {
    POS:Number(record.scores['POS Score']),
    Insurance:Number(record.scores['Insurance Score']),
    Equipment:Number(record.scores['Equipment Score']),
    'Hood/Fire':Number(record.scores['Hood/Fire Score']),
    Waste:Number(record.scores['Waste Score']),
    Pest:Number(record.scores['Pest Score']),
    Linen:Number(record.scores['Linen Score']),
    Distribution:Number(record.scores['Distribution Score'])
  };
}

const authority = authorityRecord();

// Literal production snapshot replays exactly; there is no inferred category formula.
{
  const candidate = candidateFrom(authority);
  const out = scoring.resolveScoreAuthority(candidate);
  assert.equal(out.status,'SCORED');
  assert.equal(out.authorityId,snapshot.authorityId);
  assert.equal(out.scoringVersion,scoring.SCORING_VERSION);
  assert.deepEqual(out.scores,expectedScores(authority));
  assert.equal(out.bestVendorFit,authority.bestVendorFit);
  assert.equal(out.bestScore,Number(authority.bestScore));
  assert(out.authorityRecordFingerprint);
}

// Missing score authority is REVIEW, never a synthesized low/default score.
{
  const out = scoring.resolveScoreAuthority({
    entityId:'CAMIS:99999999',
    camis:'99999999',
    lifecycleStage:'JUST FILED',
    sourceSystems:['DOHMH'],
    sourceCount:1,
    sourceLatestEffectiveAt:'2026-09-18T00:00:00Z'
  });
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('SCORE_AUTHORITY_MISSING'));
  assert.equal(Object.prototype.hasOwnProperty.call(out,'scores'),false);
}

// State drift invalidates the frozen authority.
{
  const out = scoring.resolveScoreAuthority(candidateFrom(authority,{
    lifecycleStage:'BUILDOUT / LICENSING'
  }));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('LEGACY_AUTHORITY_STAGE_DRIFT'));
}

{
  const out = scoring.resolveScoreAuthority(candidateFrom(authority,{
    sourceSystems:['DOHMH','SLA_PENDING'],
    sourceCount:2
  }));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('LEGACY_AUTHORITY_SOURCE_COUNT_DRIFT'));
  assert(out.errors.includes('LEGACY_AUTHORITY_SOURCE_SET_DRIFT'));
}

// A later source state cannot inherit an older score even when stage/sources look unchanged.
{
  const cutoff = Date.parse(authority.lastUpdated);
  assert(Number.isFinite(cutoff));
  const out = scoring.resolveScoreAuthority(candidateFrom(authority,{
    sourceLatestEffectiveAt:new Date(cutoff + 60 * 1000).toISOString()
  }));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('LEGACY_AUTHORITY_SUPERSEDED_BY_NEWER_STATE'));
}

// Delivery suppression cannot be bypassed by an old score row.
{
  const out = scoring.resolveScoreAuthority(candidateFrom(authority,{
    deliverySuppressed:true
  }));
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('CANDIDATE_SUPPRESSED'));
}

// Receipt identity is deterministic and bound to graph, change, authority and literal scores.
{
  const candidate = candidateFrom(authority);
  const input = {
    candidate,
    graphDigest:'graph-legacy-1',
    scoredAt:'2026-09-21T15:00:00Z'
  };
  const first = receipt.buildScoreReceipt(input);
  const replay = receipt.buildScoreReceipt(JSON.parse(JSON.stringify(input)));
  assert.equal(first.status,'SCORED');
  assert.equal(first.scoreReceiptId,replay.scoreReceiptId);
  assert.equal(first.changeFingerprint,delivery.candidateChangeFingerprint(candidate));
  assert.equal(first.graphDigest,'graph-legacy-1');
  assert.equal(first.authorityId,snapshot.authorityId);
  assert(first.authorityRecordFingerprint);
  assert.deepEqual(first.scores,expectedScores(authority));
}

// Drifted candidate gets a REVIEW receipt with no score ID.
{
  const candidate = candidateFrom(authority,{sourceSystems:['DOHMH','SLA_PENDING'],sourceCount:2});
  const out = receipt.buildScoreReceipt({candidate,graphDigest:'graph-legacy-1'});
  assert.equal(out.status,'REVIEW');
  assert.equal(out.scoreReceiptId,undefined);
  assert(out.errors.includes('LEGACY_AUTHORITY_SOURCE_SET_DRIFT'));
}

// A literal-authority score receipt remains compatible with the graph-bound delivery planner.
{
  const candidate = candidateFrom(authority);
  const graphDigest = 'graph-live-authority-test';
  const scoreReceipt = receipt.buildScoreReceipt({
    candidate,
    graphDigest,
    scoredAt:'2026-09-21T15:00:00Z'
  });
  assert.equal(scoreReceipt.status,'SCORED');
  candidate.scoreReceiptId = scoreReceipt.scoreReceiptId;

  const fingerprint = delivery.candidateChangeFingerprint(candidate);
  const cutoff = Date.parse(authority.lastUpdated);
  const firstDetectedAt = new Date(cutoff).toISOString();
  const baselineAt = new Date(cutoff - 60 * 60 * 1000).toISOString();
  const detectionReceipt = {
    receiptId:candidate.detectionReceiptId,
    entityId:candidate.entityId,
    changeFingerprint:fingerprint,
    firstDetectedAt
  };

  const minimumScore = Math.max(0, Number(scoreReceipt.scores.POS) - 1);
  const plan = delivery.planCustomerDelivery({
    graph:{graphState:'COMPLETE',graphDigest,candidates:[candidate]},
    profile:{
      subscriberId:'sub-authority-test',
      baselineAt,
      category:'POS',
      boroughs:[],
      minimumScore
    },
    detectionReceipts:[detectionReceipt],
    scoreReceipts:[scoreReceipt]
  });
  assert.equal(plan.status,'READY');
  assert.equal(plan.reviews.length,0);
  assert.equal(plan.signals.length,1);
  assert.equal(plan.signals[0].scoreReceiptId,scoreReceipt.scoreReceiptId);
  assert.equal(plan.signals[0].selectedScore,scoreReceipt.scores.POS);
}

// computeScores compatibility surface itself refuses formula-style inputs.
{
  const out = scoring.computeScores({commercialFit:'HIGH',stageNumber:1});
  assert.equal(out.status,'REVIEW');
  assert(out.errors.includes('CANDIDATE_REQUIRED_FOR_SCORE_AUTHORITY'));
}

console.log('PermitPlate validated score-authority and score-receipt regression tests passed.');
