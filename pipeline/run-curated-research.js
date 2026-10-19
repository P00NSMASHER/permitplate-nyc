'use strict';

// Private, source-only research refresh. It does not score, bill or deliver.
// The workflow publishes the ledger + graph together to a private Git commit.
const fs = require('fs');
const path = require('path');
const {replay} = require('./run-current-graph');
const ledger = require('./curated-research-ledger');
const independentReview=require('./independent-source-review');
const {privateMaterialPath} = require('./run-subscriber-intake');

const VERSION = 'PermitPlate-curated-research-runner-v1.0.0';

function readOptional(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
}
function atomicJson(file, data) {
  const target = privateMaterialPath(file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify(data,null,2) + '\n',{flag:'wx',mode:0o600});
    fs.renameSync(temporary,target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function baselineAnchor(currentLedger) {
  const core={
    version:'PermitPlate-curated-baseline-anchor-v1.0.0',
    initializedAt:currentLedger.initializedAt,
    baselineGraphDigest:currentLedger.graphDigest,
    baselineLedgerFingerprint:currentLedger.ledgerFingerprint
  };
  return {...core,anchorFingerprint:ledger.hash(core)};
}
function verifyBaselineAnchor(previous,anchor) {
  if (!previous && !anchor) return {valid:true};
  if (!previous || !anchor) return {valid:false,reason:'CURATED_BASELINE_ANCHOR_MISSING'};
  const core={
    version:anchor.version,
    initializedAt:anchor.initializedAt,
    baselineGraphDigest:anchor.baselineGraphDigest,
    baselineLedgerFingerprint:anchor.baselineLedgerFingerprint
  };
  if (core.version!=='PermitPlate-curated-baseline-anchor-v1.0.0' ||
      core.initializedAt!==previous.initializedAt ||
      ledger.hash(core)!==anchor.anchorFingerprint) {
    return {valid:false,reason:'CURATED_BASELINE_ANCHOR_INVALID'};
  }
  return {valid:true};
}
function prepare(previous, graph) {
  const advanced = ledger.advance(previous,graph);
  if (advanced.status === 'REVIEW') {
    return {status:'REVIEW',failures:advanced.failures,ready:false};
  }
  return {
    status:advanced.status,
    ready:true,
    ledger:advanced.ledger,
    graph,
    summary:{
      runnerVersion:VERSION,
      status:advanced.status,
      graphState:graph.graphState,
      graphDigest:graph.graphDigest,
      observedAt:graph.observedAt,
      sourceGraphFingerprint:graph.artifactFingerprint,
      ledgerFingerprint:advanced.ledger.ledgerFingerprint,
      candidateCount:advanced.candidateCount,
      newlyObservedResearchCount:advanced.newResearchCount,
      verifiedMaterialChangeCount:advanced.newMaterialEventCount||0,
      materialChangesHeldForReview:advanced.materialReviewCount||0,
      heldForReviewCount:advanced.heldReviewCount,
      externalSendCalls:0,
      customerDataRead:false
    }
  };
}
async function run(input) {
  const opts = input || {};
  if (!opts.ledgerPath || !opts.graphPath) {
    throw new Error('PRIVATE_LEDGER_AND_GRAPH_PATH_REQUIRED');
  }
  const ledgerPath = privateMaterialPath(opts.ledgerPath);
  const graphPath = privateMaterialPath(opts.graphPath);
  const anchorPath=path.join(path.dirname(ledgerPath),'curated-baseline-anchor.json');
  const previous=readOptional(ledgerPath);
  const anchor=readOptional(anchorPath);
  const anchorCheck=verifyBaselineAnchor(previous,anchor);
  if (!anchorCheck.valid) return {
    status:'REVIEW',ready:false,failures:[anchorCheck.reason]
  };
  const collected = await replay(opts.nowIso,{withBatches:true});
  const result = prepare(previous,collected.result);
  if (!result.ready) return result;
  // Review-only DOB/SLA evidence uses the exact source observations already
  // included in the graph. It cannot be confused with customer-ready CAMIS.
  const independent=independentReview.inspect({
    graph:result.graph,
    batches:collected.batches,
    observedAt:result.graph.observedAt
  });
  if(independent.status!=='REVIEW_ONLY') {
    return {status:'REVIEW',ready:false,failures:independent.failures||[
      'INDEPENDENT_REVIEW_NOT_READY'
    ]};
  }
  result.summary.independentReviewOnlyCount=independent.storedCount;
  result.summary.independentReviewTotalMatches=independent.totalResearchMatches;
  result.summary.independentReviewOverflow=independent.omittedByLimit;
  atomicJson(graphPath,result.graph);
  atomicJson(ledgerPath,result.ledger);
  if (!anchor) atomicJson(anchorPath,baselineAnchor(result.ledger));
  const independentPath=path.join(path.dirname(ledgerPath),'independent-source-review.json');
  atomicJson(independentPath,independent);
  return result;
}
async function main() {
  if (process.argv.length !== 4) throw new Error('Usage: node pipeline/run-curated-research.js PRIVATE_LEDGER_JSON PRIVATE_GRAPH_JSON');
  const result = await run({
    ledgerPath:process.argv[2],
    graphPath:process.argv[3]
  });
  if (!result.ready) {
    console.error(JSON.stringify({status:result.status,failures:result.failures}));
    process.exitCode=1;
  } else {
    console.log(JSON.stringify(result.summary,null,2));
  }
}
if (require.main === module) {
  main().catch(error=>{console.error(error.message);process.exitCode=1});
}
module.exports = {VERSION,readOptional,atomicJson,baselineAnchor,verifyBaselineAnchor,prepare,run};
