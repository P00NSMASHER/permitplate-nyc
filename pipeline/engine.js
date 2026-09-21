'use strict';

const model = require('../model-v7');
const adapters = require('./source-adapters');
const project = require('./project-signal');

const ENGINE_VERSION = 'PermitPlate-engine-v1.0.0';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function businessName(record) {
  const p = record && record.parties || {};
  return p.operatorName || p.dba || p.legalName || p.applicantBusinessName || p.permitteeBusinessName || null;
}

function recordToResolutionEvent(record) {
  return {
    businessName: businessName(record),
    address: record && record.property && record.property.address,
    sourceEntityId: record && record.sourceEntityId,
    sourceRecordId: record && record.sourceRecordId,
    sourceUrl: record && record.sourceUrl
  };
}

function defaultCandidate(primary, commercialFit) {
  const name = businessName(primary);
  return {
    entityId: primary.sourceEntityId || primary.sourceRecordId,
    canonicalName: name,
    address: primary && primary.property && primary.property.address,
    sourceEntityIds: primary.sourceEntityId ? [primary.sourceEntityId] : [],
    commercialFit: commercialFit || 'MEDIUM'
  };
}

function observationMap(batches) {
  return new Map((batches || []).map((batch) => [
    batch.observation.observationId,
    batch.observation
  ]));
}

function recordObservation(record, observations) {
  return observations.get(record && record.sourceObservationId) || null;
}

function positiveRecord(record, observations) {
  const obs = recordObservation(record, observations);
  return Boolean(obs && obs.supportsPositiveObservation === true);
}

function buildBatches(sourceInputs) {
  const inputs = sourceInputs || {};
  return Object.keys(inputs).map((sourceKey) => adapters.normalizeBatch(sourceKey, inputs[sourceKey]));
}

function findPrimaryRecord(batches, selector) {
  const sel = selector || {};
  const sourceKey = sel.sourceKey || 'DOHMH';
  const batch = batches.find((item) => item.observation &&
    adapters.SOURCE_CONFIGS[sourceKey] &&
    item.observation.sourceId === adapters.SOURCE_CONFIGS[sourceKey].sourceId);
  if (!batch) throw new Error(`Primary source batch missing: ${sourceKey}`);

  if (sel.sourceRecordId) {
    const record = batch.records.find((item) => item.sourceRecordId === sel.sourceRecordId);
    if (!record) throw new Error(`Primary source record not found: ${sel.sourceRecordId}`);
    return record;
  }

  if (sel.sourceEntityId) {
    const matches = batch.records.filter((item) => item.sourceEntityId === sel.sourceEntityId);
    if (matches.length !== 1) {
      throw new Error(`Primary entity selector must resolve exactly one record: ${sel.sourceEntityId}`);
    }
    return matches[0];
  }

  if (batch.records.length !== 1) {
    throw new Error('Primary selector required when source batch contains multiple records');
  }
  return batch.records[0];
}

function normalizeEvidenceRecords(batches, primary, observations) {
  const acceptedForConsideration = [];
  const rejectedBySourceState = [];
  for (const batch of batches) {
    for (const record of batch.records) {
      if (record.sourceRecordId === primary.sourceRecordId) continue;
      const observation = recordObservation(record, observations);
      if (observation && observation.supportsPositiveObservation === true) {
        acceptedForConsideration.push(record);
      } else {
        rejectedBySourceState.push({
          sourceRecordId: record.sourceRecordId,
          sourceSystem: record.sourceSystem,
          observationId: record.sourceObservationId || null,
          observationState: observation && observation.state || 'UNKNOWN',
          reason: 'SOURCE_OBSERVATION_NOT_USABLE'
        });
      }
    }
  }
  return {acceptedForConsideration, rejectedBySourceState};
}

function currentStateFromSignal(signal, input) {
  return {
    lifecycleStage: input.lifecycleStage || 'JUST FILED',
    sourceSystems: signal.sourceSystems.slice().sort(),
    categoryEvidence: Array.from(new Set(signal.commercialEvidence.map((item) => item.tag))).sort(),
    status: input.status || 'active',
    projectSignalId: signal.signalId
  };
}

function evaluateOpportunity(input) {
  const data = input || {};
  const batches = buildBatches(data.sources || {});
  const observations = observationMap(batches);
  const primary = findPrimaryRecord(batches, data.primary);
  const primaryObservation = recordObservation(primary, observations);
  const evidenceSelection = normalizeEvidenceRecords(batches, primary, observations);

  const signal = project.buildProjectSignal(
    primary,
    evidenceSelection.acceptedForConsideration,
    {reviewedIdentityBridges: data.reviewedIdentityBridges || []}
  );
  signal.corroboration.rejectedBySourceState = evidenceSelection.rejectedBySourceState;

  const candidate = data.candidate || defaultCandidate(primary, data.commercialFit);
  const currentState = data.currentState || currentStateFromSignal(signal, data);

  const decision = model.buildOpportunityDecision({
    event: recordToResolutionEvent(primary),
    candidate,
    sourceObservation: primaryObservation || {},
    previousState: data.previousState || null,
    currentState,
    changeOptions: data.changeOptions || {},
    scoreParts: data.scoreParts || {},
    commercialFit: data.commercialFit || candidate.commercialFit,
    subscriberEligibility: data.subscriberEligibility || null,
    postBaseline: data.postBaseline,
    qualifyingReopen: data.qualifyingReopen,
    minimumScore: data.minimumScore,
    alreadyDeliveredFingerprint: data.alreadyDeliveredFingerprint
  });

  const reasons = decision.reasons.slice();
  if (!positiveRecord(primary, observations)) reasons.push('PRIMARY_SOURCE_OBSERVATION_NOT_USABLE');
  if (evidenceSelection.rejectedBySourceState.length) reasons.push('EVIDENCE_SOURCE_OBSERVATION_REJECTED');

  const directEvidenceTags = signal.commercialEvidence.map((item) => item.tag);
  const verticalScoreResults = {};
  for (const [category, scoreInput] of Object.entries(data.verticalScores || {})) {
    verticalScoreResults[category] = model.applyVerticalEvidenceCeiling({
      category,
      score: scoreInput && scoreInput.score,
      posScore: scoreInput && scoreInput.posScore,
      insuranceScore: scoreInput && scoreInput.insuranceScore,
      evidenceTags: directEvidenceTags,
      hotFoodSpecialistEvidence: data.hotFoodSpecialistEvidence === true
    });
  }

  let finalDecision = decision.decision;
  if (reasons.some((reason) => [
    'PRIMARY_SOURCE_OBSERVATION_NOT_USABLE',
    'EVIDENCE_SOURCE_OBSERVATION_REJECTED'
  ].includes(reason))) finalDecision = 'REVIEW';

  const engineFingerprint = model.stateHash({
    engineVersion: ENGINE_VERSION,
    projectSignalId: signal.signalId,
    opportunityReplayFingerprint: decision.replayFingerprint,
    sourceObservationIds: signal.provenance.sourceObservationIds.slice().sort(),
    rejectedSourceEvidence: evidenceSelection.rejectedBySourceState,
    finalDecision,
    reasons: reasons.slice().sort(),
    verticalScoreResults
  });

  return {
    engineVersion: ENGINE_VERSION,
    pipelineVersion: adapters.PIPELINE_VERSION,
    projectSignalVersion: project.PROJECT_SIGNAL_VERSION,
    finalDecision,
    reasons,
    engineFingerprint,
    observations: batches.map((batch) => batch.observation),
    projectSignal: signal,
    opportunityDecision: decision,
    verticalScoreResults
  };
}

module.exports = {
  ENGINE_VERSION,
  recordToResolutionEvent,
  defaultCandidate,
  buildBatches,
  findPrimaryRecord,
  evaluateOpportunity
};
