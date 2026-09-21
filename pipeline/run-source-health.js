'use strict';

const fs = require('fs');
const path = require('path');
const {readSocrataSource, sha256, stableStringify} = require('./socrata-reader');

function isoFloorDaysAgo(nowIso, days) {
  const d = new Date(nowIso);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace('Z', '');
}

function publicObservation(observation) {
  return {
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    queryScopeHash: observation.queryScopeHash,
    queryScope: observation.queryScope,
    observedAt: observation.observedAt,
    sourceFresh: observation.sourceFresh,
    transportOk: observation.transportOk,
    httpStatus: observation.httpStatus,
    sourceMoved: observation.sourceMoved,
    redirected: observation.redirected,
    redirectTarget: observation.redirectTarget,
    intendedFullScope: observation.intendedFullScope,
    publisherCount: observation.publisherCount,
    fetchedCount: observation.fetchedCount,
    cursorClosed: observation.cursorClosed,
    schemaFingerprint: observation.schemaFingerprint,
    rawPageHashes: observation.rawPageHashes,
    state: observation.state,
    supportsPositiveObservation: observation.supportsPositiveObservation,
    supportsAbsenceConclusion: observation.supportsAbsenceConclusion,
    stateReason: observation.stateReason
  };
}

function sourcePlans(observedAt) {
  const dohmhFloor = isoFloorDaysAgo(observedAt, 30);
  const dobFloor = isoFloorDaysAgo(observedAt, 14);
  return [
    {
      sourceKey:'DOHMH',
      maxAgeDays:3,
      where:`inspection_date = '1900-01-01T00:00:00.000' OR (inspection_type like 'Pre-permit%' AND inspection_date >= '${dohmhFloor}')`,
      order:'camis ASC, inspection_date ASC'
    },
    {
      sourceKey:'DOB_NOW',
      maxAgeDays:7,
      where:`filing_date >= '${dobFloor}'`,
      order:'job_filing_number ASC'
    },
    {
      sourceKey:'SLA_PENDING',
      maxAgeDays:7,
      where:null,
      order:'application_id ASC'
    }
  ];
}

async function scanBatches(nowIso) {
  const observedAt = nowIso || new Date().toISOString();
  const appToken = process.env.SOCRATA_APP_TOKEN || undefined;
  const batches = {};
  for (const plan of sourcePlans(observedAt)) {
    batches[plan.sourceKey] = await readSocrataSource(plan.sourceKey, {
      observedAt,
      appToken,
      maxAgeDays:plan.maxAgeDays,
      pageSize:5000,
      where:plan.where,
      order:plan.order
    });
  }
  return {observedAt, batches};
}

async function scan(nowIso) {
  const {observedAt, batches} = await scanBatches(nowIso);
  const results = sourcePlans(observedAt).map((plan) => {
    const batch = batches[plan.sourceKey];
    return {
      sourceKey:plan.sourceKey,
      observation:publicObservation(batch.observation),
      normalizedRecordCount:batch.records.length,
      sampleSourceRecordIds:batch.records.slice(0, 5).map((record) => record.sourceRecordId)
    };
  });

  const summary = {
    runnerVersion:'PermitPlate-source-health-v1.0.0',
    observedAt,
    sources:results,
    passed:results.every((item) =>
      ['COMPLETE_NONEMPTY','VERIFIED_EMPTY'].includes(item.observation.state)
    )
  };
  summary.fingerprint = sha256(stableStringify(summary));
  return summary;
}

async function main() {
  const result = await scan();
  const outputPath = process.argv[2] || path.join(__dirname, 'source-health-result.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {isoFloorDaysAgo, publicObservation, sourcePlans, scanBatches, scan};
