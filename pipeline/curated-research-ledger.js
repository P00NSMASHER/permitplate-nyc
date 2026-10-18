'use strict';

// Score-independent, private source-observation history for the paid
// founder-curated product. It never promotes model scores or sends messages.
const crypto = require('crypto');
const materialChange = require('./material-change');
const MATERIAL_EVENT_VERSION='PermitPlate-curated-material-event-v1.0.0';

const VERSION = 'PermitPlate-curated-research-ledger-v1.0.0';
const REQUIRED_SOURCES = ['DOHMH', 'DOB_NOW', 'SLA_PENDING'];

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(
      key => JSON.stringify(key) + ':' + stable(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}
function hash(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}
function materialEvent(entityId,previous,current,observedAt,reasons) {
  const core={
    version:MATERIAL_EVENT_VERSION,
    kind:'MATERIAL_CHANGE',
    entityId,
    observedAt,
    fromFingerprint:previous.fingerprint,
    toFingerprint:current.fingerprint,
    changeReasons:[...new Set(reasons || [])].sort()
  };
  return {...core,eventId:'MAT:'+hash(core).slice(0,24)};
}
function validMaterialEvent(event) {
  if(!event || event.version!==MATERIAL_EVENT_VERSION ||
    event.kind!=='MATERIAL_CHANGE' ||
    !/^CAMIS:[0-9]+$/.test(String(event.entityId||'')) ||
    !instant(event.observedAt) ||
    !/^[a-f0-9]{64}$/.test(String(event.fromFingerprint||'')) ||
    !/^[a-f0-9]{64}$/.test(String(event.toFingerprint||'')) ||
    !Array.isArray(event.changeReasons) || !event.changeReasons.includes('EVIDENCE_CHANGED')) {
    return false;
  }
  const {eventId,...core}=event;
  return eventId==='MAT:'+hash(core).slice(0,24);
}
function instant(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function seal(data) {
  const ledger = { ...data };
  delete ledger.ledgerFingerprint;
  ledger.ledgerFingerprint = hash(ledger);
  return ledger;
}
function validate(ledger) {
  const failures = [];
  if (!ledger || ledger.version !== VERSION) failures.push('CURATED_LEDGER_VERSION_INVALID');
  if (!ledger || !instant(ledger.initializedAt) || !instant(ledger.observedAt)) {
    failures.push('CURATED_LEDGER_TIMESTAMPS_INVALID');
  } else if (Date.parse(ledger.observedAt) < Date.parse(ledger.initializedAt)) {
    failures.push('CURATED_LEDGER_TIMELINE_INVALID');
  }
  if (!ledger || !ledger.entries || typeof ledger.entries !== 'object' ||
      Array.isArray(ledger.entries)) failures.push('CURATED_LEDGER_ENTRIES_INVALID');
  const expected = ledger ? seal(ledger).ledgerFingerprint : null;
  if (!ledger || !/^[a-f0-9]{64}$/.test(String(ledger.ledgerFingerprint || '')) ||
      ledger.ledgerFingerprint !== expected) failures.push('CURATED_LEDGER_FINGERPRINT_INVALID');
  for (const [id, entry] of Object.entries(ledger && ledger.entries || {})) {
    if (!entry || entry.entityId !== id || !/^CAMIS:[0-9]+$/.test(id)) {
      failures.push('CURATED_LEDGER_ID_INVALID');
    }
    if (!entry || !instant(entry.firstObservedAt) || !instant(entry.lastObservedAt) ||
        !['PRESENT', 'OUT_OF_CURRENT_WINDOW'].includes(entry.presenceState)) {
      failures.push('CURATED_LEDGER_ENTRY_INVALID');
    } else {
      if(entry.materiality!=null && !materialChange.valid(entry.materiality)) {
        failures.push('CURATED_LEDGER_MATERIALITY_INVALID');
      }
      if(entry.materialityMigrationAt!=null && (!instant(entry.materialityMigrationAt) ||
        Date.parse(entry.materialityMigrationAt)<Date.parse(ledger.initializedAt) ||
        Date.parse(entry.materialityMigrationAt)>Date.parse(entry.lastObservedAt))) {
        failures.push('CURATED_MATERIALITY_MIGRATION_TIME_INVALID');
      }
      if(entry.lastMaterialEvent!=null &&
          (!validMaterialEvent(entry.lastMaterialEvent) ||
           entry.lastMaterialEvent.entityId!==id ||
           !materialChange.valid(entry.materiality) ||
           Date.parse(entry.lastMaterialEvent.observedAt)<Date.parse(ledger.initializedAt) ||
           Date.parse(entry.lastMaterialEvent.observedAt)>Date.parse(entry.lastObservedAt))) {
        failures.push('CURATED_MATERIAL_EVENT_INVALID');
      }
      const first=Date.parse(entry.firstObservedAt);
      const last=Date.parse(entry.lastObservedAt);
      const initialized=Date.parse(ledger.initializedAt);
      const observed=Date.parse(ledger.observedAt);
      if (first < initialized || first > last || last > observed) {
        failures.push('CURATED_LEDGER_ENTRY_TIMELINE_INVALID');
      }
    }
  }
  return { valid:failures.length === 0, failures:[...new Set(failures)] };
}
function graphFingerprint(graph) {
  const observations = graph.sourceObservations || {};
  return hash({
    runnerVersion:graph.runnerVersion,
    observedAt:graph.observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest,
    sourceObservationIds:Object.fromEntries(
      Object.entries(observations).map(([key, item]) => [key, item && item.observationId])
    ),
    metrics:graph.metrics,
    knownRegressionChecks:graph.knownRegressionChecks,
    // Match run-current-graph.js: hash every customer-visible field.
    candidates:(graph.candidates || []).slice().sort(
      (a,b) => String(a.entityId).localeCompare(String(b.entityId))
    )
  });
}
function checkGraph(graph) {
  const g = graph || {};
  const failures = [];
  if (g.runnerVersion !== 'PermitPlate-current-graph-v1.0.0') {
    failures.push('CURATED_GRAPH_VERSION_INVALID');
  }
  if (g.graphState !== 'COMPLETE' || g.passed !== true ||
      !g.knownRegressionChecks || g.knownRegressionChecks.passed !== true) {
    failures.push('CURATED_GRAPH_NOT_COMPLETE');
  }
  if (!instant(g.observedAt) || !/^[a-f0-9]{64}$/.test(String(g.graphDigest || ''))) {
    failures.push('CURATED_GRAPH_IDENTITY_INVALID');
  }
  if (!Array.isArray(g.candidates)) failures.push('CURATED_GRAPH_CANDIDATES_INVALID');
  if (!g.artifactFingerprint || g.artifactFingerprint !== graphFingerprint(g)) {
    failures.push('CURATED_GRAPH_RECEIPT_INVALID');
  }
  for (const key of REQUIRED_SOURCES) {
    const source = g.sourceObservations && g.sourceObservations[key];
    if (!source || source.state !== 'COMPLETE_NONEMPTY' ||
        source.supportsAbsenceConclusion !== true || source.sourceFresh !== true ||
        source.transportOk !== true || source.observedAt !== g.observedAt ||
        source.publisherCount !== source.fetchedCount) {
      failures.push('CURATED_SOURCE_NOT_VERIFIED:' + key);
    }
  }
  const ids = new Set();
  for (const candidate of g.candidates || []) {
    if (!candidate || !/^CAMIS:[0-9]+$/.test(String(candidate.entityId || '')) ||
        candidate.entityId !== 'CAMIS:' + String(candidate.camis || '') ||
        ids.has(candidate.entityId)) failures.push('CURATED_CANDIDATE_ID_INVALID');
    else ids.add(candidate.entityId);
    if(candidate && candidate.materiality!=null &&
        !materialChange.valid(candidate.materiality)) {
      failures.push('CURATED_CANDIDATE_MATERIALITY_INVALID');
    }
  }
  return {valid:failures.length === 0, failures:[...new Set(failures)]};
}
function eligibleCandidate(candidate) {
  return candidate && candidate.deliverySuppressed !== true &&
    !(candidate.crossCamisOperationalConflicts || []).length &&
    Boolean(String(candidate.canonicalName || '').trim()) &&
    Boolean(String(candidate.address || '').trim()) &&
    Boolean(String(candidate.borough || '').trim());
}
function advance(previous, graph) {
  const check = checkGraph(graph);
  if (!check.valid) {
    return {status:'REVIEW', failures:check.failures, ledger:previous || null, newResearchCount:0};
  }
  const now = instant(graph.observedAt);
  if (previous) {
    const verified = validate(previous);
    if (!verified.valid) return {
      status:'REVIEW', failures:verified.failures, ledger:previous, newResearchCount:0
    };
    if (Date.parse(now) < Date.parse(previous.observedAt) ||
        (now === previous.observedAt && graph.graphDigest !== previous.graphDigest)) {
      return {status:'REVIEW',failures:['CURATED_NON_MONOTONIC_GRAPH'],ledger:previous,newResearchCount:0};
    }
  }
  const baseline = !previous;
  const entries = previous ? JSON.parse(JSON.stringify(previous.entries)) : {};
  const seen = new Set();
  const research = [];
  const held = [];
  const materialEvents = [];
  const materialReviews = [];
  for (const candidate of graph.candidates) {
    const id = candidate.entityId;
    seen.add(id);
    const prior = entries[id];
    const descriptor=materialChange.valid(candidate.materiality)?
      candidate.materiality:null;
    const next={...prior,
      entityId:id,
      firstObservedAt:prior ? prior.firstObservedAt : now,
      lastObservedAt:now,
      presenceState:'PRESENT',
      ...(descriptor ? {materiality:descriptor} : {})
    };
    // Private v1 has no semantic baseline. Attach the first complete
    // descriptor without generating any invented material-change event.
    if(prior && !materialChange.valid(prior.materiality) && descriptor) {
      next.materialityMigrationAt=now;
    }
    // Reappearance, identity/premise drift and suppressed candidates require
    // review. Only a meaningfully changed, accepted source-evidence
    // descriptor may propose a new event, never a publisher extraction date.
    if(prior && prior.presenceState==='PRESENT' &&
        descriptor && materialChange.valid(prior.materiality)) {
      const comparison=materialChange.compare(prior.materiality,descriptor);
      const evidenceChanged=prior.materiality.parts.evidence!==descriptor.parts.evidence;
      if(comparison.material && evidenceChanged && eligibleCandidate(candidate)) {
        const event=materialEvent(id,prior.materiality,descriptor,now,comparison.reasons);
        next.lastMaterialEvent=event;
        materialEvents.push(event);
      } else if(comparison.review || comparison.material) {
        next.lastMaterialEvent=null;
        materialReviews.push({entityId:id,reasons:comparison.reasons});
      }
    } else if(prior && prior.presenceState!=='PRESENT') {
      next.lastMaterialEvent=null;
    }
    entries[id]=next;
    // Reappearance is never treated as a new restaurant. A source refresh
    // does not create a new event for an existing CAMIS.
    if (!baseline && !prior) {
      if (eligibleCandidate(candidate)) research.push(id);
      else held.push(id);
    }
  }
  for (const [id, entry] of Object.entries(entries)) {
    if (!seen.has(id)) entries[id] = {...entry, presenceState:'OUT_OF_CURRENT_WINDOW'};
  }
  const ledger = seal({
    version:VERSION,
    initializedAt:previous ? previous.initializedAt : now,
    observedAt:now,
    graphDigest:graph.graphDigest,
    entries
  });
  return {
    status:baseline ? 'BASELINED' : (research.length || held.length || materialEvents.length || materialReviews.length) ? 'ADVANCED' : 'NO_NEW_ENTITIES',
    failures:[],
    ledger,
    newResearchCount:research.length,
    newMaterialEventCount:materialEvents.length,
    materialReviewCount:materialReviews.length,
    materialEvents,
    materialReviews,
    heldReviewCount:held.length,
    newResearchIds:research,
    heldReviewIds:held,
    candidateCount:graph.candidates.length,
    sourceGraphDigest:graph.graphDigest
  };
}

module.exports = {
  VERSION, MATERIAL_EVENT_VERSION, REQUIRED_SOURCES, stable, hash,
  instant, materialEvent, validMaterialEvent, seal, validate,
  graphFingerprint, checkGraph, eligibleCandidate, advance
};
