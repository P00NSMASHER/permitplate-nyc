'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {scanBatches}=require('./run-source-health');
const {buildCurrentGraph}=require('./candidate-builder');
const detection=require('./detection-ledger');
const materialChange=require('./material-change');

const RUNNER_VERSION='PermitPlate-detection-ledger-runner-v1.1.0';

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function inc(obj,key){
  const k=String(key||'UNKNOWN');
  obj[k]=(obj[k]||0)+1;
}
function readLedger(filePath){
  if(!fs.existsSync(filePath)) return null;
  // Preserve malformed/uninitialized contents for the validation boundary. Do not
  // silently turn an existing history with a missing header into a fresh baseline.
  const parsed=JSON.parse(fs.readFileSync(filePath,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new Error('LEDGER_FILE_INVALID');
  return parsed;
}
function stateCounts(ledger){
  const out={};
  for(const entry of Object.values(ledger&&ledger.entries||{})) inc(out,entry.presenceState);
  return out;
}

async function run(options){
  const opts=options||{};
  const statePath=path.resolve(opts.statePath||path.join(__dirname,'..','state','detection-ledger.json'));
  const outputPath=path.resolve(opts.outputPath||path.join(__dirname,'detection-ledger-run-result.json'));
  const previous=readLedger(statePath);

  const {observedAt,batches}=await scanBatches(opts.nowIso);
  const graph=buildCurrentGraph({
    dohmhBatch:batches.DOHMH,
    slaBatch:batches.SLA_PENDING,
    dobBatch:batches.DOB_NOW,
    reviewedIdentityBridges:[]
  });

  const advanced=detection.advanceDetectionLedger(previous,graph,observedAt);
  const classes={};
  for(const receipt of advanced.receipts||[]) inc(classes,receipt.detectionClass);

  const summary={
    runnerVersion:RUNNER_VERSION,
    materialityVersion:materialChange.VERSION,
    materialityMetrics:advanced.materialityMetrics||null,
    reviewReceiptCount:(advanced.reviewReceipts||[]).length,
    observedAt,
    graphState:graph.graphState,
    graphDigest:graph.graphDigest||null,
    candidateCount:(graph.candidates||[]).length,
    priorLedgerInitialized:Boolean(previous&&previous.initializedAt),
    committed:advanced.committed===true,
    reason:advanced.reason,
    receiptCount:(advanced.receipts||[]).length,
    customerEligibleReceiptCount:(advanced.customerEligibleReceipts||[]).length,
    receiptClasses:classes,
    customerEligibleReceipts:(advanced.customerEligibleReceipts||[]),
    sampleNonCustomerReceipts:(advanced.receipts||[])
      .filter((receipt)=>receipt.customerEligible!==true)
      .slice(0,10),
    ledgerFingerprint:advanced.ledger&&advanced.ledger.ledgerFingerprint||null,
    stateCounts:stateCounts(advanced.ledger)
  };
  summary.artifactFingerprint=sha256(stableStringify(summary));

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(summary,null,2)+'\n');

  if(advanced.committed&&advanced.ledger){
    fs.mkdirSync(path.dirname(statePath),{recursive:true});
    fs.writeFileSync(statePath,JSON.stringify(advanced.ledger,null,2)+'\n');
  }

  return {summary,advanced,statePath,outputPath};
}

async function main(){
  const statePath=process.argv[2]||path.join(__dirname,'..','state','detection-ledger.json');
  const outputPath=process.argv[3]||path.join(__dirname,'detection-ledger-run-result.json');
  const {summary}=await run({statePath,outputPath});
  console.log(JSON.stringify(summary,null,2));
  if(!summary.committed) process.exitCode=1;
}

if(require.main===module){
  main().catch((error)=>{console.error(error);process.exit(1);});
}

module.exports={RUNNER_VERSION,stableStringify,sha256,readLedger,stateCounts,run};
