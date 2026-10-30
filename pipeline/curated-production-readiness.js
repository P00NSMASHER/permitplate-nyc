'use strict';

// Read-only, score-independent source of truth for the actual paid product.
// Never creates a new baseline, sends a message or modifies subscriber state.
const research=require('./curated-research-ledger');
const materialChange=require('./material-change');
const {verifyBaselineAnchor}=require('./run-curated-research');

const VERSION='PermitPlate-curated-production-readiness-v1.0.0';
const MAX_GRAPH_AGE_MS=24*60*60*1000;

function evaluate(input){
  const data=input||{};
  const ledger=data.ledger||null;
  const snapshot=data.snapshot||null;
  const anchor=data.anchor||null;
  const observedAt=research.instant(data.evaluatedAt);
  const snapshotAt=research.instant(snapshot&&snapshot.observedAt);
  const expectedDigest=String(data.currentGraphDigest||'');
  const snapshotValidation=research.checkGraph(snapshot);
  const ledgerValidation=research.validate(ledger);
  const failures=[];
  if(!ledger||!snapshot||!anchor) failures.push('CURATED_PRIVATE_STATE_INCOMPLETE');
  if(!snapshotValidation.valid) failures.push('CURATED_SNAPSHOT_INVALID');
  if(!ledgerValidation.valid) failures.push('CURATED_LEDGER_INVALID');
  const anchorValidation=verifyBaselineAnchor(ledger,anchor);
  if(!anchorValidation.valid) failures.push('CURATED_BASELINE_ANCHOR_INVALID');
  if(!snapshotAt||!observedAt||
      Date.parse(snapshotAt)>Date.parse(observedAt)||
      Date.parse(observedAt)-Date.parse(snapshotAt)>MAX_GRAPH_AGE_MS) {
    failures.push('CURATED_SOURCE_SNAPSHOT_STALE');
  }
  if(!expectedDigest||!snapshot||snapshot.graphDigest!==expectedDigest) {
    failures.push('CURATED_SNAPSHOT_NOT_CURRENT_SOURCE_GRAPH');
  }
  if(!ledger||!snapshot||
      ledger.observedAt!==snapshot.observedAt||
      ledger.graphDigest!==snapshot.graphDigest) {
    failures.push('CURATED_LEDGER_SNAPSHOT_MISMATCH');
  }
  const candidates=Array.isArray(snapshot&&snapshot.candidates)?snapshot.candidates:[];
  // Paid changes require genuine versioned source semantics. Legacy private
  // snapshots without descriptors are not eligible for operational readiness;
  // the normal verified refresh migrates them without creating customer events.
  if(candidates.some(candidate=>!materialChange.valid(candidate.materiality))){
    failures.push('CURATED_SEMANTIC_EVIDENCE_MISSING');
  }
  const entries=ledger&&ledger.entries&&typeof ledger.entries==='object'?ledger.entries:{};
  const present=Object.values(entries).filter(entry=>entry&&entry.presenceState==='PRESENT').length;
  if(!snapshotValidation.valid||!ledgerValidation.valid||
      present!==candidates.length||
      candidates.some(candidate=>!entries[candidate.entityId]||
        entries[candidate.entityId].presenceState!=='PRESENT')) {
    failures.push('CURATED_PRESENT_ENTITY_COVERAGE_MISMATCH');
  }
  return {
    version:VERSION,
    valid:failures.length===0,
    failures:[...new Set(failures)],
    graphDigest:snapshot&&snapshot.graphDigest||null,
    observedAt:snapshotAt,
    sourceGraphFingerprint:snapshot&&snapshot.artifactFingerprint||null,
    ledgerFingerprint:ledger&&ledger.ledgerFingerprint||null,
    candidateCount:candidates.length,
    presentCount:present,
    sourceAgeMs:observedAt&&snapshotAt?Date.parse(observedAt)-Date.parse(snapshotAt):null
  };
}

module.exports={VERSION,MAX_GRAPH_AGE_MS,evaluate};
