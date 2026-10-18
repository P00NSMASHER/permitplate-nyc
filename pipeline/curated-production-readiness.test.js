'use strict';
const assert=require('node:assert/strict');
const research=require('./curated-research-ledger');
const {baselineAnchor}=require('./run-curated-research');
const readiness=require('./curated-production-readiness');

const observedAt='2026-10-18T19:00:00.000Z';
const evaluatedAt='2026-10-18T20:00:00.000Z';
const candidate={
  entityId:'CAMIS:50110000',camis:'50110000',
  canonicalName:'Example Restaurant',address:'100 Test Street',
  borough:'Brooklyn',lifecycleStage:'JUST FILED',
  sourceLatestEffectiveAt:'2026-10-18T17:00:00.000Z',
  deliverySuppressed:false,crossCamisOperationalConflicts:[]
};
function graph(){
  const observations={};
  for(const key of research.REQUIRED_SOURCES){
    observations[key]={
      observationId:'OBS:'+key,observedAt,state:'COMPLETE_NONEMPTY',
      sourceFresh:true,transportOk:true,supportsAbsenceConclusion:true,
      fetchedCount:1,publisherCount:1
    };
  }
  const g={
    runnerVersion:'PermitPlate-current-graph-v1.0.0',
    observedAt,graphState:'COMPLETE',passed:true,
    graphDigest:'a'.repeat(64),sourceObservations:observations,
    metrics:{candidateCount:1},knownRegressionChecks:{passed:true},
    candidates:[{...candidate}]
  };
  g.artifactFingerprint=research.graphFingerprint(g);
  return g;
}
const snapshot=graph();
const baseline=research.advance(null,snapshot);
assert.equal(baseline.status,'BASELINED');
const ledger=baseline.ledger;
const anchor=baselineAnchor(ledger);
const base={
  snapshot,ledger,anchor,
  currentGraphDigest:snapshot.graphDigest,
  evaluatedAt
};
assert.equal(readiness.evaluate(base).valid,true);
const wrongDigest=readiness.evaluate({...base,currentGraphDigest:'b'.repeat(64)});
assert.equal(wrongDigest.valid,false);
assert(wrongDigest.failures.includes('CURATED_SNAPSHOT_NOT_CURRENT_SOURCE_GRAPH'));
const stale=readiness.evaluate({...base,evaluatedAt:'2026-10-20T20:00:00.000Z'});
assert(stale.failures.includes('CURATED_SOURCE_SNAPSHOT_STALE'));
const future=readiness.evaluate({...base,evaluatedAt:'2026-10-18T18:00:00.000Z'});
assert(future.failures.includes('CURATED_SOURCE_SNAPSHOT_STALE'));
const tampered=JSON.parse(JSON.stringify(snapshot));
tampered.candidates[0].address='Unverified changed address';
assert(readiness.evaluate({...base,snapshot:tampered}).failures.includes('CURATED_SNAPSHOT_INVALID'));
const missing=readiness.evaluate({...base,anchor:null});
assert(missing.failures.includes('CURATED_PRIVATE_STATE_INCOMPLETE'));
assert(missing.failures.includes('CURATED_BASELINE_ANCHOR_INVALID'));
const missingEntry=JSON.parse(JSON.stringify(ledger));
delete missingEntry.entries[candidate.entityId];
const resealed=research.seal(missingEntry);
assert(readiness.evaluate({...base,ledger:resealed}).failures.includes('CURATED_PRESENT_ENTITY_COVERAGE_MISMATCH'));
const mismatch=JSON.parse(JSON.stringify(ledger));
mismatch.graphDigest='c'.repeat(64);
assert(readiness.evaluate({...base,ledger:research.seal(mismatch)}).failures.includes('CURATED_LEDGER_SNAPSHOT_MISMATCH'));
console.log('Curated private production acceptance gates passed.');
