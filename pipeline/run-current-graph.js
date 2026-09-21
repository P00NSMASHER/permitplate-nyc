'use strict';

const fs = require('fs');
const path = require('path');
const {scanBatches, publicObservation} = require('./run-source-health');
const {buildCurrentGraph} = require('./candidate-builder');
const {sha256, stableStringify} = require('./socrata-reader');

const RUNNER_VERSION = 'PermitPlate-current-graph-v1.0.0';

function publicCommercialEvidence(items) {
  return (items || []).map((item) => ({
    tag:item.tag,
    sourceSystem:item.sourceSystem,
    sourceRecordId:item.sourceRecordId,
    sourceUrl:item.sourceUrl,
    matchedPatterns:item.matchedPatterns
  }));
}

function publicCandidate(candidate) {
  return {
    entityId:candidate.entityId,
    camis:candidate.camis,
    canonicalName:candidate.canonicalName,
    address:candidate.address,
    borough:candidate.borough,
    zip:candidate.zip,
    lifecycleStage:candidate.lifecycleStage,
    sourceFirstEffectiveAt:candidate.sourceFirstEffectiveAt,
    sourceLatestEffectiveAt:candidate.sourceLatestEffectiveAt,
    latestPrePermitAt:candidate.latestPrePermitAt,
    latestApplicantAt:candidate.latestApplicantAt,
    sourceSystems:candidate.sourceSystems,
    sourceCount:candidate.sourceCount,
    deliverySuppressed:candidate.deliverySuppressed,
    suppressionReasons:candidate.suppressionReasons,
    crossCamisOperationalConflicts:candidate.crossCamisOperationalConflicts,
    projectSignalId:candidate.projectSignal && candidate.projectSignal.signalId,
    acceptedCorroboration:candidate.projectSignal ?
      candidate.projectSignal.corroboration.accepted : [],
    rejectedCorroboration:candidate.projectSignal ?
      candidate.projectSignal.corroboration.rejected.map((item) => ({
        sourceRecordId:item.sourceRecordId,
        sourceSystem:item.sourceSystem,
        sourceUrl:item.sourceUrl,
        result:item.result
      })) : [],
    commercialEvidence:publicCommercialEvidence(candidate.commercialEvidence)
  };
}

function knownRegressionChecks(graph, batches) {
  const currentKoke = graph.candidates.find((candidate) => candidate.camis === '50192488');
  const koke = currentKoke ? {
    state:'OBSERVED',
    currentCamis:'50192488',
    expectedConflictingCamis:'50184059',
    suppressed:currentKoke.deliverySuppressed,
    conflictObserved:currentKoke.crossCamisOperationalConflicts.some((item) => item.camis === '50184059'),
    safe:currentKoke.deliverySuppressed &&
      currentKoke.crossCamisOperationalConflicts.some((item) => item.camis === '50184059')
  } : {
    state:'NOT_IN_CURRENT_WINDOW',
    currentCamis:'50192488',
    expectedConflictingCamis:'50184059',
    suppressed:null,
    conflictObserved:null,
    safe:true
  };

  const laMarquetaId = 'DOB_NOW:M01329447-I1';
  const dobPresent = Boolean(
    batches.DOB_NOW &&
    batches.DOB_NOW.records.some((record) => record.sourceRecordId === laMarquetaId)
  );
  const acceptedBy = graph.candidates
    .filter((candidate) =>
      candidate.projectSignal &&
      candidate.projectSignal.corroboration.accepted.some((item) => item.sourceRecordId === laMarquetaId)
    )
    .map((candidate) => candidate.entityId);

  const laMarqueta = {
    state:dobPresent ? 'OBSERVED' : 'NOT_IN_CURRENT_WINDOW',
    sourceRecordId:laMarquetaId,
    acceptedBy,
    safe:acceptedBy.length === 0
  };

  return {
    koke,
    laMarqueta,
    passed:koke.safe && laMarqueta.safe
  };
}

async function replay(nowIso) {
  const {observedAt, batches} = await scanBatches(nowIso);
  const graph = buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });

  const regressionChecks = knownRegressionChecks(graph, batches);
  const sourceObservations = Object.fromEntries(
    Object.entries(batches).map(([key, batch]) => [key, publicObservation(batch.observation)])
  );

  const result = {
    runnerVersion:RUNNER_VERSION,
    observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest,
    sourceObservations,
    metrics:graph.metrics,
    knownRegressionChecks:regressionChecks,
    candidates:graph.candidates.map(publicCandidate)
  };
  result.passed = graph.graphState === 'COMPLETE' && regressionChecks.passed;
  result.artifactFingerprint = sha256(stableStringify({
    runnerVersion:result.runnerVersion,
    observedAt:result.observedAt,
    graphState:result.graphState,
    graphDigest:result.graphDigest,
    sourceObservationIds:Object.fromEntries(
      Object.entries(sourceObservations).map(([key, observation]) => [key, observation.observationId])
    ),
    metrics:result.metrics,
    knownRegressionChecks:result.knownRegressionChecks,
    candidateIds:result.candidates.map((candidate) => candidate.entityId).sort()
  }));
  return result;
}

async function main() {
  const result = await replay();
  const outputPath = process.argv[2] || path.join(__dirname, 'current-graph-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({
    runnerVersion:result.runnerVersion,
    observedAt:result.observedAt,
    passed:result.passed,
    graphState:result.graphState,
    graphDigest:result.graphDigest,
    artifactFingerprint:result.artifactFingerprint,
    metrics:result.metrics,
    knownRegressionChecks:result.knownRegressionChecks,
    sourceStates:Object.fromEntries(
      Object.entries(result.sourceObservations).map(([key, observation]) => [key, observation.state])
    )
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {publicCandidate, knownRegressionChecks, replay};
