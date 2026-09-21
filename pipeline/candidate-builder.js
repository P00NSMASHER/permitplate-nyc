'use strict';

const crypto = require('crypto');
const project = require('./project-signal');

const CANDIDATE_BUILDER_VERSION = 'PermitPlate-candidate-builder-v1.0.0';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function norm(value) {
  return project.norm(value);
}

function timeMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sourceCamis(record) {
  return text(record && record.entityKeys && record.entityKeys.camis);
}

function isApplicant(record) {
  return record && record.eventType === 'DOHMH_APPLICANT_RECORD';
}

function isPrePermit(record) {
  return record && record.eventType === 'DOHMH_PRE_PERMIT_EVENT';
}

function recordOrder(a, b) {
  const ta = timeMs(a && a.sourceEffectiveAt) ?? -Infinity;
  const tb = timeMs(b && b.sourceEffectiveAt) ?? -Infinity;
  return tb - ta || text(a && a.sourceRecordId).localeCompare(text(b && b.sourceRecordId));
}

function bestNonblank(records, getter) {
  for (const record of records.slice().sort(recordOrder)) {
    const value = getter(record);
    if (text(value)) return value;
  }
  return null;
}

function groupDohmhByCamis(records) {
  const groups = new Map();
  for (const record of records || []) {
    if (!record || record.sourceSystem !== 'DOHMH') continue;
    const camis = sourceCamis(record);
    if (!camis) continue;
    if (!groups.has(camis)) groups.set(camis, []);
    groups.get(camis).push(record);
  }
  return groups;
}

function buildDohmhCandidates(records) {
  const groups = groupDohmhByCamis(records);
  const candidates = [];

  for (const [camis, group] of groups) {
    const relevant = group.filter((record) => isApplicant(record) || isPrePermit(record)).sort(recordOrder);
    if (!relevant.length) continue;

    const prePermits = relevant.filter(isPrePermit).sort(recordOrder);
    const applicants = relevant.filter(isApplicant).sort(recordOrder);
    const primaryRecord = prePermits[0] || applicants[0] || relevant[0];

    const effectiveTimes = relevant.map((record) => timeMs(record.sourceEffectiveAt)).filter((x) => x !== null);
    const earliestMs = effectiveTimes.length ? Math.min(...effectiveTimes) : null;
    const latestMs = effectiveTimes.length ? Math.max(...effectiveTimes) : null;

    const candidate = {
      builderVersion: CANDIDATE_BUILDER_VERSION,
      entityId: `CAMIS:${camis}`,
      camis,
      canonicalName: bestNonblank(relevant, (record) => record.parties && record.parties.operatorName),
      address: bestNonblank(relevant, (record) => record.property && record.property.address),
      borough: bestNonblank(relevant, (record) => record.property && record.property.borough),
      zip: bestNonblank(relevant, (record) => record.property && record.property.zip),
      bin: bestNonblank(relevant, (record) => record.property && record.property.bin),
      bbl: bestNonblank(relevant, (record) => record.property && record.property.bbl),
      sourceEntityIds: [`CAMIS:${camis}`],
      lifecycleStage: prePermits.length ? 'HEALTH PRE-PERMIT' : 'JUST FILED',
      sourceFirstEffectiveAt: earliestMs === null ? null : new Date(earliestMs).toISOString(),
      sourceLatestEffectiveAt: latestMs === null ? null : new Date(latestMs).toISOString(),
      latestPrePermitAt: prePermits.length ? prePermits[0].sourceEffectiveAt : null,
      latestApplicantAt: applicants.length ? applicants[0].sourceEffectiveAt : null,
      primaryRecord,
      dohmhRecordIds: relevant.map((record) => record.sourceRecordId),
      dohmhRecordCount: relevant.length,
      crossCamisOperationalConflicts: [],
      deliverySuppressed: false,
      suppressionReasons: []
    };
    candidates.push(candidate);
  }

  return candidates.sort((a, b) =>
    (timeMs(b.sourceLatestEffectiveAt) ?? -Infinity) - (timeMs(a.sourceLatestEffectiveAt) ?? -Infinity) ||
    a.entityId.localeCompare(b.entityId)
  );
}

function normalizedAddress(value) {
  return norm(value);
}

function indexRecordsByAddress(records) {
  const index = new Map();
  for (const record of records || []) {
    const key = normalizedAddress(record && record.property && record.property.address);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
  return index;
}

function applyCrossCamisOperationalConflicts(candidates) {
  const byAddress = new Map();

  for (const candidate of candidates || []) {
    const key = normalizedAddress(candidate.address);
    if (!key) continue;
    if (!byAddress.has(key)) byAddress.set(key, []);
    byAddress.get(key).push(candidate);
  }

  for (const candidate of candidates || []) {
    if (candidate.lifecycleStage !== 'JUST FILED') continue;
    const key = normalizedAddress(candidate.address);
    if (!key) continue;

    const conflicts = (byAddress.get(key) || [])
      .filter((other) =>
        other.camis !== candidate.camis &&
        other.lifecycleStage === 'HEALTH PRE-PERMIT' &&
        other.latestPrePermitAt
      )
      .map((other) => ({
        camis: other.camis,
        entityId: other.entityId,
        latestPrePermitAt: other.latestPrePermitAt,
        primarySourceRecordId: other.primaryRecord && other.primaryRecord.sourceRecordId
      }))
      .sort((a, b) => text(b.latestPrePermitAt).localeCompare(text(a.latestPrePermitAt)) || a.camis.localeCompare(b.camis));

    if (conflicts.length) {
      candidate.crossCamisOperationalConflicts = conflicts;
      candidate.deliverySuppressed = true;
      candidate.suppressionReasons.push('CROSS_CAMIS_OPERATIONAL_CONFLICT');
    }
  }

  return candidates;
}

function acceptedObservation(batch) {
  return Boolean(batch && batch.observation && batch.observation.supportsPositiveObservation === true);
}

function completeObservation(batch) {
  return Boolean(batch && batch.observation && batch.observation.supportsAbsenceConclusion === true);
}

function sourceCompletenessReasons(data) {
  const reasons = [];
  if (!completeObservation(data.dohmhBatch)) reasons.push('DOHMH_SOURCE_WINDOW_NOT_COMPLETE');
  if (!completeObservation(data.slaBatch)) reasons.push('SLA_SOURCE_WINDOW_NOT_COMPLETE');
  if (!completeObservation(data.dobBatch)) reasons.push('DOB_SOURCE_WINDOW_NOT_COMPLETE');
  return reasons;
}

function buildCurrentGraph(input) {
  const data = input || {};
  const dohmhBatch = data.dohmhBatch;
  if (!dohmhBatch || !acceptedObservation(dohmhBatch)) {
    return {
      builderVersion: CANDIDATE_BUILDER_VERSION,
      graphState: 'REVIEW',
      reasons: ['DOHMH_SOURCE_OBSERVATION_NOT_USABLE'],
      candidates: [],
      metrics: {candidateCount: 0}
    };
  }

  const candidates = applyCrossCamisOperationalConflicts(buildDohmhCandidates(dohmhBatch.records));
  const slaRecords = data.slaBatch && acceptedObservation(data.slaBatch) ? data.slaBatch.records : [];
  const dobRecords = data.dobBatch && acceptedObservation(data.dobBatch) ? data.dobBatch.records : [];
  const slaByAddress = indexRecordsByAddress(slaRecords);
  const dobByAddress = indexRecordsByAddress(dobRecords);
  const reviewedIdentityBridges = data.reviewedIdentityBridges || [];

  let acceptedSla = 0;
  let acceptedDobReviewed = 0;
  let rejectedDobColocation = 0;
  let suppressed = 0;
  const stageCounts = {};

  for (const candidate of candidates) {
    const addressKey = normalizedAddress(candidate.address);
    const sameAddressSla = addressKey ? (slaByAddress.get(addressKey) || []) : [];
    const sameAddressDob = addressKey ? (dobByAddress.get(addressKey) || []) : [];
    const signal = project.buildProjectSignal(
      candidate.primaryRecord,
      sameAddressSla.concat(sameAddressDob),
      {reviewedIdentityBridges}
    );

    candidate.projectSignal = signal;
    candidate.sourceSystems = signal.sourceSystems;
    candidate.sourceCount = signal.sourceCount;
    candidate.commercialEvidence = signal.commercialEvidence;

    for (const item of signal.corroboration.accepted) {
      if (item.sourceSystem === 'SLA_PENDING') acceptedSla += 1;
      if (item.sourceSystem === 'DOB_NOW') acceptedDobReviewed += 1;
    }
    rejectedDobColocation += signal.corroboration.rejected.filter((item) => item.sourceSystem === 'DOB_NOW').length;

    if (candidate.deliverySuppressed) suppressed += 1;
    stageCounts[candidate.lifecycleStage] = (stageCounts[candidate.lifecycleStage] || 0) + 1;
  }

  const graphDigest = sha256(JSON.stringify(candidates.map((candidate) => ({
    entityId: candidate.entityId,
    stage: candidate.lifecycleStage,
    sourceRecordIds: candidate.projectSignal && candidate.projectSignal.sourceRecordIds || [],
    suppressed: candidate.deliverySuppressed,
    suppressionReasons: candidate.suppressionReasons
  })).sort((a, b) => a.entityId.localeCompare(b.entityId))));

  const completenessReasons = sourceCompletenessReasons(data);
  return {
    builderVersion: CANDIDATE_BUILDER_VERSION,
    graphState: completenessReasons.length ? 'PARTIAL' : 'COMPLETE',
    reasons: completenessReasons,
    graphDigest,
    candidates,
    metrics: {
      candidateCount: candidates.length,
      stageCounts,
      suppressedCount: suppressed,
      crossCamisOperationalConflictCount: candidates.filter((candidate) =>
        candidate.crossCamisOperationalConflicts.length > 0
      ).length,
      acceptedSlaCorroborationCount: acceptedSla,
      acceptedDobReviewedCorroborationCount: acceptedDobReviewed,
      rejectedDobColocationCount: rejectedDobColocation,
      sourceCompleteness: {
        DOHMH: completeObservation(data.dohmhBatch),
        SLA_PENDING: completeObservation(data.slaBatch),
        DOB_NOW: completeObservation(data.dobBatch)
      }
    }
  };
}

module.exports = {
  CANDIDATE_BUILDER_VERSION,
  timeMs,
  isApplicant,
  isPrePermit,
  groupDohmhByCamis,
  buildDohmhCandidates,
  indexRecordsByAddress,
  applyCrossCamisOperationalConflicts,
  acceptedObservation,
  completeObservation,
  sourceCompletenessReasons,
  buildCurrentGraph
};
