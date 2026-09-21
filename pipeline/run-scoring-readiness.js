'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {scanBatches} = require('./run-source-health');
const {buildCurrentGraph} = require('./candidate-builder');
const commercialFit = require('./commercial-fit');
const scoring = require('./scoring');

const RUNNER_VERSION = 'PermitPlate-scoring-readiness-v1.0.0';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function increment(map, key) {
  const k = String(key || 'UNKNOWN');
  map[k] = (map[k] || 0) + 1;
}

function sourceRecords(batches) {
  return Object.values(batches || {}).flatMap((batch) =>
    Array.isArray(batch && batch.records) ? batch.records : []
  );
}

function auditGraph(graph, batches, observedAt) {
  const allRecords = sourceRecords(batches);
  const fitCounts = {};
  const fitStatusCounts = {};
  const scoreStatusCounts = {};
  const scoreReasonCounts = {};
  const fitScoreMatrix = {};
  const legacyFitAgreement = {
    compared:0,
    agreed:0,
    disagreed:0,
    mismatches:[]
  };
  const scoreableEntityIds = [];
  const reviewEntityIds = [];

  for (const candidate of graph.candidates || []) {
    const fit = commercialFit.classifyCommercialFit({
      candidate,
      sourceRecords:allRecords
    });
    increment(fitStatusCounts, fit.status);
    increment(fitCounts, fit.fit || 'REVIEW');

    const authority = scoring.resolveScoreAuthority(candidate);
    increment(scoreStatusCounts, authority.status);

    if (authority.status === 'SCORED') {
      scoreableEntityIds.push(candidate.entityId);
      const fitKey = fit.status === 'CLASSIFIED' ? fit.fit : 'REVIEW';
      const legacyFit = String(authority.commercialFit || 'UNKNOWN').toUpperCase();
      increment(fitScoreMatrix, fitKey + '->' + legacyFit);

      if (fit.status === 'CLASSIFIED') {
        legacyFitAgreement.compared += 1;
        if (String(fit.fit).toUpperCase() === legacyFit) {
          legacyFitAgreement.agreed += 1;
        } else {
          legacyFitAgreement.disagreed += 1;
          if (legacyFitAgreement.mismatches.length < 25) {
            legacyFitAgreement.mismatches.push({
              entityId:candidate.entityId,
              generatedFit:fit.fit,
              legacyFit,
              fitReasons:fit.reasons,
              authorityCutoff:authority.authorityCutoff
            });
          }
        }
      }
    } else {
      reviewEntityIds.push(candidate.entityId);
      for (const reason of authority.errors || ['SCORE_AUTHORITY_UNKNOWN']) {
        increment(scoreReasonCounts, reason);
      }
    }
  }

  const total = (graph.candidates || []).length;
  const scored = scoreableEntityIds.length;
  const classifiedFit = (fitStatusCounts.CLASSIFIED || 0);
  const result = {
    runnerVersion:RUNNER_VERSION,
    observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest,
    totalCandidates:total,
    fit:{
      classified:classifiedFit,
      review:(fitStatusCounts.REVIEW || 0),
      coverageRate:total ? Number((classifiedFit / total).toFixed(6)) : 0,
      counts:fitCounts
    },
    scoreAuthority:{
      scored,
      review:total - scored,
      coverageRate:total ? Number((scored / total).toFixed(6)) : 0,
      statusCounts:scoreStatusCounts,
      reviewReasons:scoreReasonCounts
    },
    legacyFitAgreement,
    fitScoreMatrix,
    sampleScoreableEntityIds:scoreableEntityIds.slice(0,25),
    sampleReviewEntityIds:reviewEntityIds.slice(0,25)
  };

  result.readinessState =
    graph.graphState !== 'COMPLETE' ? 'GRAPH_NOT_COMPLETE' :
    legacyFitAgreement.disagreed > 0 ? 'FIT_MIGRATION_REVIEW' :
    scored === total ? 'FULLY_SCORE_AUTHORIZED' :
    scored > 0 ? 'PARTIAL_SCORE_AUTHORITY' :
    'NO_CURRENT_SCORE_AUTHORITY';

  result.artifactFingerprint = sha256(stableStringify(result));
  return result;
}

async function audit(nowIso) {
  const {observedAt, batches} = await scanBatches(nowIso);
  const graph = buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });
  return auditGraph(graph, batches, observedAt);
}

async function main() {
  const result = await audit();
  const outputPath = process.argv[2] || path.join(__dirname, 'scoring-readiness-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));

  if (result.graphState !== 'COMPLETE') process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  RUNNER_VERSION,
  stableStringify,
  sha256,
  increment,
  sourceRecords,
  auditGraph,
  audit
};
