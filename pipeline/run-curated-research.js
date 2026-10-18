'use strict';

// Private, source-only research refresh. It does not score, bill or deliver.
// The workflow publishes the ledger + graph together to a private Git commit.
const fs = require('fs');
const path = require('path');
const {replay} = require('./run-current-graph');
const ledger = require('./curated-research-ledger');
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
  const liveGraph = await replay(opts.nowIso);
  const result = prepare(readOptional(ledgerPath),liveGraph);
  if (!result.ready) return result;
  atomicJson(graphPath,result.graph);
  atomicJson(ledgerPath,result.ledger);
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
module.exports = {VERSION,readOptional,atomicJson,prepare,run};
