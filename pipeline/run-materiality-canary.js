'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {scanBatches}=require('./run-source-health');
const {buildCurrentGraph}=require('./candidate-builder');
const detection=require('./detection-ledger');
const material=require('./material-change');
const {readLedger}=require('./run-detection-ledger');
const VERSION='PermitPlate-materiality-readonly-canary-v1.0.0';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function run(options={}) {
  const statePath=options.statePath||path.join(__dirname,'..','state','detection-ledger.json');
  const stateBytes=fs.readFileSync(statePath);
  const previous=readLedger(statePath);
  const before=hash(previous);
  const {observedAt,batches}=await scanBatches(options.nowIso);
  const graph=buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW,reviewedIdentityBridges:[]});
  const proposed=detection.advanceDetectionLedger(previous,graph,observedAt);

  // Frozen-snapshot metamorphic test. This is NOT a second live source observation.
  // Only applicant pull metadata is altered in memory; source truth is not saved.
  const baseline=detection.bootstrapLedger(graph,observedAt);
  const refreshed=JSON.parse(JSON.stringify(graph));
  let transformed=0;
  for(const candidate of refreshed.candidates||[]) {
    if(candidate.primaryRecord && candidate.primaryRecord.eventType==='DOHMH_APPLICANT_RECORD') {
      const start=Date.parse(candidate.sourceLatestEffectiveAt||observedAt);
      candidate.sourceLatestEffectiveAt=new Date(start+86400000).toISOString();
      candidate.primaryRecord.facts.record_date=candidate.sourceLatestEffectiveAt;
      candidate.primaryRecord.observedAt=candidate.sourceLatestEffectiveAt;
      transformed+=1;
    }
  }
  refreshed.graphDigest='SIMULATED_REFRESH:'+hash({sourceGraph:graph.graphDigest,transformed});
  const nextAt=new Date(Date.parse(observedAt)+86400000).toISOString();
  const simulated=baseline.committed?detection.advanceDetectionLedger(baseline.ledger,refreshed,nextAt):null;
  const stateUnchanged=before===hash(previous) && stateBytes.equals(fs.readFileSync(statePath));
  const result={
    runnerVersion:VERSION,observedAt,transportMode:'NO_SEND',externalSendCalls:0,productionStateWrites:0,
    graphState:graph.graphState,graphDigest:graph.graphDigest||null,candidateCount:(graph.candidates||[]).length,
    materialityVersion:material.VERSION,
    proposedLiveMigration:{committedInMemory:proposed.committed,reason:proposed.reason,metrics:proposed.materialityMetrics||null,reviewCount:(proposed.reviewReceipts||[]).length,customerEventCount:(proposed.customerEligibleReceipts||[]).length},
    frozenSnapshotSimulation:{isSyntheticTransformation:true,transformedApplicants:transformed,customerEventCount:simulated?(simulated.customerEligibleReceipts||[]).length:null,metrics:simulated&&simulated.materialityMetrics||null},
    originalStateUnchanged:stateUnchanged
  };
  result.passed=Boolean(graph.graphState==='COMPLETE' && proposed.committed && stateUnchanged && simulated && simulated.committed && simulated.customerEligibleReceipts.length===0 && simulated.materialityMetrics.refreshOnlyCount===transformed);
  result.artifactFingerprint=hash(result);
  return result;
}

if(require.main===module) {
  const statePath=process.argv[3]||undefined;
  run({statePath}).then(result=>{
    const output=process.argv[2];
    if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');}
    console.log(JSON.stringify(result,null,2));
    if(!result.passed) process.exitCode=1;
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
module.exports={VERSION,run};
