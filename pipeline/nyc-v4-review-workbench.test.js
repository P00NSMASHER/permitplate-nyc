'use strict';
const assert=require('node:assert/strict');
const adapters=require('./source-adapters');
const builder=require('./candidate-builder');
const current=require('./run-current-graph');
const research=require('./curated-research-ledger');
const scorer=require('./nyc-v4-internal-production-scoring');
const board=require('./nyc-v4-review-workbench');

const NOW='2026-10-21T16:30:00.000Z';
function batch(key,rows){
 const observation={observationId:'OBS:'+key+':'+NOW,sourceId:adapters.SOURCE_CONFIGS[key].sourceId,
  observedAt:NOW,state:'COMPLETE_NONEMPTY',sourceFresh:true,transportOk:true,cursorClosed:true,
  publisherCount:rows.length,fetchedCount:rows.length,
  supportsAbsenceConclusion:true,supportsPositiveObservation:true};
 return {observation,records:rows};
}
function input(){
 const record=(camis,dba,inspection,boro='Manhattan')=>adapters.normalizeDohmhRow({
  camis,dba,boro,building:'14',street:'SAMPLE ROAD',zipcode:'10012',
  inspection_date:inspection,
  inspection_type:inspection.startsWith('1900')?'':'Pre-permit (Non-operational) / Initial Inspection',
  record_date:'2026-10-20T06:00:27.000'
 },{observedAt:NOW});
 const batches={
  DOHMH:batch('DOHMH',[
   record('59983010','PIER RESTAURANT','2026-10-19T00:00:00.000'),
   record('59983011','UNINSPECTED RECORD','1900-01-01T00:00:00.000')]),
  DOB_NOW:batch('DOB_NOW',[]),
  SLA_PENDING:batch('SLA_PENDING',[])
 };
 const fullGraph=builder.buildCurrentGraph({
  dohmhBatch:batches.DOHMH,dobBatch:batches.DOB_NOW,
  slaBatch:batches.SLA_PENDING,reviewedIdentityBridges:[]
 });
 assert.equal(fullGraph.graphState,'COMPLETE');
 const graph={runnerVersion:'PermitPlate-current-graph-v1.0.0',
  observedAt:NOW,passed:true,graphState:'COMPLETE',graphDigest:fullGraph.graphDigest,
  metrics:fullGraph.metrics,knownRegressionChecks:{passed:true},
  sourceObservations:Object.fromEntries(Object.entries(batches).map(([k,v])=>[k,v.observation])),
  candidates:fullGraph.candidates.map(current.publicCandidate)
 };
 graph.artifactFingerprint=research.graphFingerprint(graph);
 assert.equal(research.checkGraph(graph).valid,true);
 const scores=scorer.scoreSnapshot({publicGraph:graph,fullGraph,batches,observedAt:NOW});
 assert.equal(scorer.validateSnapshot(scores).valid,true);
 assert.equal(scores.knownEventScoredCount,1);
 return {graph,scores};
}
{
 const {graph,scores}=input();
 const out=board.build({graph,scores});
 assert.equal(out.status,'READY_FOR_PRIVATE_HUMAN_REVIEW');
 assert.equal(out.receipt.sourceScoreCount,1);
 assert.equal(out.receipt.graphDigest,graph.graphDigest);
 assert.equal(out.receipt.scoreFingerprint,scores.fingerprint);
 assert.equal(out.receipt.ownerApproved,false);
 assert.equal(out.receipt.customerDeliveryAllowed,false);
 assert.equal(out.receipt.externalSendCalls,0);
 assert.equal(out.receipt.verifiedBuyerPrecision,null);
 assert.equal(out.receipt.categoryCounts.POS,1);
 assert.equal(out.receipt.displayedRowCount,8);
 assert.equal(out.receipt.distinctBusinessesDisplayed,1);
 assert.equal(out.receipt.manifestVersion,board.VERSION);
 assert.equal(out.receipt.fingerprint.length,64);
 assert(out.html.startsWith('<!doctype html>'));
 assert(out.html.includes('Source-relevance, not buyer intent'));
 assert(out.html.includes('PIER RESTAURANT'));
 assert(out.html.includes('CAMIS:59983010'));
 assert(out.html.includes('2026-10-19'));
 assert(out.html.includes('https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=59983010'));
 assert(out.html.includes('Official evidence'));
 assert(!/<script\b|<iframe\b|<form\b|https:\/\/fonts\./i.test(out.html));
 assert(out.csv.includes('Owner source verified (BLANK)'));
 assert(out.csv.includes('Buyer need independently verified (BLANK)'));
 assert(!out.csv.includes('UNINSPECTED RECORD'));
 assert.equal(out.csv.trim().split('\n').length,9);
 assert.equal(board.build(input()).receipt.fingerprint,out.receipt.fingerprint);
}
{
 assert.equal(board.escapeHtml('<img src=x onerror=alert(1)>'),
  '&lt;img src=x onerror=alert(1)&gt;');
 // Quoted CSV begins with a double quote, but the decoded field starts
 // with a protective apostrophe before the spreadsheet formula.
 assert(/^"'\s*=HYPERLINK/.test(board.csvCell('   =HYPERLINK("https://evil.test")')));
 assert(board.csvCell('\t+2+2').startsWith("'"));
 assert(!board.csvCell('Cafe & Bakery').startsWith("'"));
 assert.throws(()=>board.trustedOfficialUrl('javascript:alert(1)'),/OFFICIAL_URL/);
 assert.throws(()=>board.trustedOfficialUrl('https://evil.test/d/43nn-pn8j'),/OFFICIAL_URL/);
 assert.throws(()=>board.trustedOfficialUrl('https://data.cityofnewyork.us.evil.test/d/43nn-pn8j'),/OFFICIAL_URL/);
 assert.equal(board.trustedOfficialUrl('https://data.ny.gov/d/f8i8-k2gm'),
  'https://data.ny.gov/d/f8i8-k2gm');
}
{
 const {graph,scores}=input();
 graph.graphDigest='f'.repeat(64);
 const fail=board.build({graph,scores});
 assert.equal(fail.status,'REVIEW');
 assert(fail.failures.includes('SCORE_GRAPH_MISMATCH'));
 assert.equal(fail.html,null);
 assert.equal(fail.csv,null);
}
{
 const {graph,scores}=input();
 const changed={...scores,observedAt:'2026-10-20T16:30:00.000Z'};
 const fail=board.build({graph,scores:changed});
 assert.equal(fail.status,'REVIEW');
 assert.equal(fail.html,null);
}
{
 const {graph,scores}=input();
 graph.candidates.find(c=>c.entityId===scores.researchRows[0].entityId).deliverySuppressed=true;
 graph.artifactFingerprint=research.graphFingerprint(graph);
 const fail=board.build({graph,scores});
 assert.equal(fail.status,'REVIEW');
 assert(fail.failures.includes('WORKBENCH_SUPPRESSED_OR_MISMATCHED_SOURCE'));
}
{
 const {graph,scores}=input();
 const altered=JSON.parse(JSON.stringify(scores));
 altered.researchRows[0].scores.Equipment=100;
 const fail=board.build({graph,scores:altered});
 assert.equal(fail.status,'REVIEW');
 assert(fail.failures.includes('INTERNAL_SCORE_RECEIPT_INVALID'));
}
console.log('NYC private V4 review board: linked official source, CSV/HTML safety, provenance, no-buyer/no-send controls passed.');
