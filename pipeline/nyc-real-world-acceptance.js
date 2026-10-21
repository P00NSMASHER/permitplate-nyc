'use strict';

// Read-only acceptance against the SAME live official-source snapshot used by
// PermitPlate's current graph. No private state, customer profiles, provider
// credentials, scoring promotion, checkout or customer transport is accessed.
const fs = require('node:fs');
const path = require('node:path');
const {replay} = require('./run-current-graph');
const {buildCurrentGraph} = require('./candidate-builder');
const independent = require('./independent-source-review');
const categoryEvidence = require('./category-evidence');
const scorer = require('./scoring');
const shadow = require('./shadow-scoring-v3');
const shadowV4 = require('./shadow-scoring-v4');

const VERSION = 'PermitPlate-NYC-real-world-acceptance-v1.0.0';
const KEYS = Object.freeze(['DOHMH', 'DOB_NOW', 'SLA_PENDING']);
const CATEGORIES = Object.freeze(['Equipment', 'Hood/Fire', 'Waste', 'POS', 'Insurance', 'Distribution']);

const inc = (object, key) => {
  const label = String(key == null ? 'UNKNOWN' : key);
  object[label] = (object[label] || 0) + 1;
};
const ratio = (count, total) => total ? Number((count / total).toFixed(5)) : null;
const iso = value => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

function ageSummary(values, observedAt) {
  const now = Date.parse(observedAt);
  const summary = {last7d:0, days8to30:0, days31to90:0, older90d:0, future:0, unknown:0};
  for (const candidate of values) {
    const parsed = Date.parse(String(candidate.sourceLatestEffectiveAt || ''));
    if (!Number.isFinite(parsed) || !Number.isFinite(now)) summary.unknown++;
    else {
      const delta = (now - parsed) / 86400000;
      if (delta < 0) summary.future++;
      else if (delta <= 7) summary.last7d++;
      else if (delta <= 30) summary.days8to30++;
      else if (delta <= 90) summary.days31to90++;
      else summary.older90d++;
    }
  }
  return summary;
}

function sourceQuality(batch, observedAt) {
  const observation = batch && batch.observation || {};
  const records = batch && batch.records || [];
  const ids = new Set();
  let missingId = 0, duplicateId = 0, futureSourceEffectiveAt = 0;
  for (const row of records) {
    if (!row.sourceRecordId) missingId++;
    else if (ids.has(row.sourceRecordId)) duplicateId++;
    else ids.add(row.sourceRecordId);
    const date = Date.parse(String(row.sourceEffectiveAt || ''));
    if (Number.isFinite(date) && date > Date.parse(observedAt)) futureSourceEffectiveAt++;
  }
  return {
    dataset:observation.sourceId || null,
    state:observation.state || 'UNAVAILABLE',
    freshnessVerified:observation.sourceFresh === true,
    transportOk:observation.transportOk === true,
    cursorClosed:observation.cursorClosed === true,
    publisherCount:observation.publisherCount == null ? null : observation.publisherCount,
    fetchedCount:records.length,
    sourceCountMatches:records.length === observation.fetchedCount &&
      records.length === observation.publisherCount,
    missingRecordIds:missingId,
    duplicateRecordIds:duplicateId,
    futureEffectiveDates:futureSourceEffectiveAt,
    observationId:observation.observationId || null,
    sourceUpdatedAt:observation.sourceUpdatedAt || null,
    officialScopeHash:observation.queryScopeHash || null,
    complete:observation.state === 'COMPLETE_NONEMPTY' &&
      observation.sourceFresh === true && observation.transportOk === true &&
      observation.cursorClosed === true && records.length === observation.publisherCount
  };
}

function assessSnapshot(publicGraph, batches, graph) {
  const observedAt = publicGraph.observedAt;
  const sourceSummary = Object.fromEntries(KEYS.map(key =>
    [key, sourceQuality(batches[key], observedAt)]));
  const entities = graph.candidates;
  const entityIds = new Set(entities.map(c => c.entityId));
  const unlinked = independent.inspect({graph:publicGraph,batches,observedAt,limit:20});
  const allRecords = KEYS.flatMap(key => batches[key].records);
  const recordsById = shadow.sourceMap(allRecords);
  const stageCounts = {}, boroughCounts = {}, bestShadowFitCounts = {};
  const effectiveTimestampCounts = {};
  const eventTimeStatuses = {}, eventTimeAgeBases = {}, v4BestFitCounts = {};
  const categoryStatus = Object.fromEntries(CATEGORIES.map(label => [label, {}]));
  const supportByEntity = new Map();
  const examples = [];
  let missingName = 0, missingAddress = 0, missingBorough = 0;
  let invalidBorough = 0, uninspectedPlaceholder = 0, misleadinglyRecentPlaceholder = 0;
  let suppressed = 0, shadowScored = 0, literalScored = 0, categoryKeywordEntities = 0;
  let shadowFailed = 0, v4Review = 0, v4Scored = 0;
  let naiveRecencyInflation = 0, v4UnknownPlaceholder = 0;
  let unsupportedCategoryPromotion = 0;

  const byPublicId = new Map(publicGraph.candidates.map(candidate => [candidate.entityId,candidate]));
  for (const candidate of entities) {
    inc(stageCounts,candidate.lifecycleStage);
    inc(boroughCounts,candidate.borough);
    if (!candidate.canonicalName) missingName++;
    if (!candidate.address) missingAddress++;
    if (!candidate.borough) missingBorough++;
    if (!['Manhattan','Brooklyn','Queens','Bronx','Staten Island'].includes(
      String(candidate.borough || ''))) invalidBorough++;
    inc(effectiveTimestampCounts,iso(candidate.sourceLatestEffectiveAt));
    // DOHMH inspection date 1900-01-01 means *not yet inspected*, not
    // "the business applied yesterday". A fresh record_date is not
    // independently verified opening/application evidence.
    const placeholder = String(candidate.primaryRecord?.facts?.inspection_date || '')
      .startsWith('1900-01-01');
    if (placeholder) {
      uninspectedPlaceholder++;
      const effective = Date.parse(String(candidate.sourceLatestEffectiveAt || ''));
      const nowMs = Date.parse(observedAt);
      if (Number.isFinite(effective) && effective <= nowMs &&
          nowMs - effective <= 7 * 86400000) misleadinglyRecentPlaceholder++;
    }
    if (candidate.deliverySuppressed) suppressed++;

    const publicCandidate = byPublicId.get(candidate.entityId);
    if (!publicCandidate) throw new Error('NYC_PUBLIC_GRAPH_IDENTITY_MISSING');
    const statuses = {};
    for (const label of CATEGORIES) {
      const evidence = categoryEvidence.classify(publicCandidate,label);
      inc(categoryStatus[label],evidence.status);
      statuses[label] = evidence.status;
      // Context is not a reviewer verdict or customer-ready category match.
      if (evidence.manualReviewRequired !== true) unsupportedCategoryPromotion++;
    }
    const contextual = CATEGORIES.filter(key => statuses[key] === 'SOURCE_KEYWORD_CONTEXT');
    if (contextual.length) categoryKeywordEntities++;
    supportByEntity.set(candidate.entityId,contextual);

    const scored = shadow.computeShadowScores(candidate,recordsById,observedAt);
    if (scored.status === 'SHADOW_SCORED') {
      shadowScored++;
      inc(bestShadowFitCounts,scored.bestVendorFit);
    } else shadowFailed++;
    const modern = shadowV4.computeShadowScores(candidate,recordsById,observedAt);
    inc(eventTimeStatuses,modern.eventChronology?.status || 'MISSING');
    inc(eventTimeAgeBases,modern.eventChronology?.eventDateBasis || 'MISSING');
    if (modern.status === 'SHADOW_SCORED') {
      v4Scored++;
      inc(v4BestFitCounts,modern.bestVendorFit);
    } else v4Review++;
    // Only the legacy V3 scorer uses the DOHMH extract date as if it were
    // a business event. The newer V4 event-time model must give UNKNOWN
    // placeholder applicants zero recent-event points.
    if (placeholder && modern.eventChronology?.status === 'UNKNOWN') {
      v4UnknownPlaceholder++;
      if (modern.eventChronology.recencyPoints !== 0) {
        throw new Error('NYC_UNKNOWN_EVENT_WRONGLY_GRANTED_RECENCY');
      }
      if (scored.status === 'SHADOW_SCORED' &&
          shadow.recency(scored.input.materialAgeDays) > 0) {
        naiveRecencyInflation++;
      }
    }
    // An experimental numeric score never grants authority to publish it.
    if (scorer.resolveScoreAuthority(candidate).status === 'SCORED') literalScored++;
  }

  // Examples are real PUBLIC restaurant records, not actual buyers or paid
  // customer artifacts. Never include phone, emails or free-form source rows.
  for (const candidate of entities.slice().sort((a,b) =>
    String(b.sourceLatestEffectiveAt||'').localeCompare(String(a.sourceLatestEffectiveAt||'')) ||
      a.entityId.localeCompare(b.entityId))) {
    if (examples.length >= 8) break;
    if (candidate.deliverySuppressed || !candidate.canonicalName ||
        !candidate.address || !candidate.camis) continue;
    examples.push({
      camis:candidate.camis,
      publicName:candidate.canonicalName,
      publicAddress:candidate.address,
      borough:candidate.borough,
      stage:candidate.lifecycleStage,
      sourceLatestEffectiveAt:iso(candidate.sourceLatestEffectiveAt),
      categoriesWithKeywordContext:supportByEntity.get(candidate.entityId) || [],
      officialUrl:'https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=' +
        encodeURIComponent(candidate.camis),
      reviewStatus:'UNADJUDICATED_PUBLIC_RESEARCH_ONLY'
    });
  }
  const sourcePassed = KEYS.every(key => sourceSummary[key].complete);
  const consistentGraph = publicGraph.passed === true && graph.graphState === 'COMPLETE' &&
    publicGraph.graphState === graph.graphState &&
    publicGraph.graphDigest === graph.graphDigest &&
    entities.length === publicGraph.candidates.length &&
    entities.length === entityIds.size &&
    entities.length === graph.metrics.candidateCount &&
    suppressed === graph.metrics.suppressedCount;
  const researchSafe = unlinked.status === 'REVIEW_ONLY' &&
    unlinked.customerDeliveryAllowed === false && unlinked.externalSendCalls === 0;
  const passed = sourcePassed && consistentGraph && researchSafe &&
    shadowFailed === 0 && unsupportedCategoryPromotion === 0;

  return {
    version:VERSION, observedAt, sourceMainIndependent:false,
    inputSource:'LIVE_OFFICIAL_PUBLIC_SOCRATA_GET_ONLY',
    allSourcesComplete:sourcePassed,
    sources:sourceSummary,
    graph:{
      graphState:graph.graphState,
      digest:graph.graphDigest,
      candidates:entities.length,
      stageCounts,
      boroughCounts,
      suppressed,
      suppressionRate:ratio(suppressed,entities.length),
      acceptedSlaCorroboration:graph.metrics.acceptedSlaCorroborationCount,
      acceptedReviewedDobCorroboration:graph.metrics.acceptedDobReviewedCorroborationCount,
      rejectedDobColocation:graph.metrics.rejectedDobColocationCount,
      missingName, missingAddress, missingBorough, invalidBorough,
      uninspectedPlaceholderCandidates:uninspectedPlaceholder,
      uninspectedPlaceholderWithRecentRecordDate:misleadinglyRecentPlaceholder,
      mostFrequentSourceEffectiveTimestamps:Object.entries(effectiveTimestampCounts)
        .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
        .slice(0,5).map(([timestamp,count])=>({timestamp,count})),
      dateSemanticsWarning:'DOHMH 1900 inspection placeholders and record_date updates do not prove new restaurant openings or application dates.',
      latestSourceEffectiveDateAge:ageSummary(entities,observedAt),
      regressionChecks:publicGraph.knownRegressionChecks
    },
    unlinkedEarlySignals:{
      status:unlinked.status,
      total:unlinked.totalResearchMatches == null ? null : unlinked.totalResearchMatches,
      sourceCounts:unlinked.sourceCounts || {},
      ignored:unlinked.ignored || {},
      constructionScope:unlinked.constructionScopeSummary || null,
      customerDeliveryAllowed:false,
      inspectFailures:unlinked.failures || []
    },
    relevance:{
      byCategoryStatus:categoryStatus,
      entitiesWithAnySourceKeywordContext:categoryKeywordEntities,
      entitiesWithAnySourceKeywordContextRate:ratio(categoryKeywordEntities,entities.length),
      note:'Keyword context and co-location are not adjudicated product needs or buyer intent.'
    },
    scores:{
      experimentalShadowScored:shadowScored,
      shadowBestFitCounts:bestShadowFitCounts,
      newerEventTimeShadowScored:v4Scored,
      newerEventTimeShadowReview:v4Review,
      newerEventTimeBestFitCounts:v4BestFitCounts,
      newerEventTimeStatuses:eventTimeStatuses,
      newerEventDateBases:eventTimeAgeBases,
      placeholderApplicantsWithUnknownEventDate:v4UnknownPlaceholder,
      legacyRecencyInflatedByExtractDate:naiveRecencyInflation,
      legacyScoreVersionEvaluated:shadow.SHADOW_SCORING_VERSION,
      modernScoreVersionEvaluated:shadowV4.SHADOW_SCORING_VERSION,
      validProductionScoreAuthority:literalScored,
      scoresPublished:0,
      buyerPrecision:null, buyerRecall:null, confirmedNewOpenings:null,
      note:'Cannot estimate accuracy without independently adjudicated labels.'
    },
    publicResearchExamples:examples,
    controls:{
      customerProfilesRead:0, privateStateRead:false, paymentsCreated:0,
      customerMessagesSent:0, customerReportsPublished:0,
      independentHumanLabelsProvided:0, reviewedIdentityBridgesProvided:0,
      customerDeliveryAllowed:false, automatedScoringPromotionAllowed:false
    },
    failures:[
      ...(!sourcePassed?['OFFICIAL_SOURCE_COUNT_OR_FRESHNESS_INCOMPLETE']:[]),
      ...(!consistentGraph?['PUBLIC_AND_FULL_GRAPH_INCONSISTENT']:[]),
      ...(!researchSafe?['UNLINKED_RESEARCH_NOT_REVIEW_ONLY']:[]),
      ...(shadowFailed?['SHADOW_SCORING_INCOMPLETE']:[]),
      ...(v4Review?['EVENT_TIME_V4_SHADOW_INCOMPLETE']:[]),
      ...(unsupportedCategoryPromotion?['CATEGORY_BYPASSED_MANUAL_REVIEW']:[])
    ],
    passed
  };
}

async function run() {
  const {result,batches} = await replay(undefined,{withBatches:true});
  const graph = buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });
  return assessSnapshot(result,batches,graph);
}

async function main() {
  const result = await run();
  const dest = process.argv[2];
  if (dest) {
    const resolved=path.resolve(dest);
    fs.mkdirSync(path.dirname(resolved),{recursive:true});
    fs.writeFileSync(resolved,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  console.log(JSON.stringify(result,null,2));
  if (!result.passed) process.exitCode=1;
}
if (require.main===module) {
  main().catch(error => {
    // Never print raw upstream responses or sensitive exception content in CI.
    console.error('NYC_REAL_WORLD_BENCHMARK_REVIEW_REQUIRED:'+
      String(error && error.code || 'SOURCE_OR_ASSERTION_ERROR'));
    process.exitCode=1;
  });
}
module.exports={VERSION,KEYS,CATEGORIES,ageSummary,sourceQuality,assessSnapshot,run};
