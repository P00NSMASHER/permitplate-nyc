'use strict';

// CLI only. The default action prepares a blind review kit from public sources.
// It has no transport/provider calls and never writes live state or scoring policy.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const c=require('./calibration-cohort');
const e=require('./calibration-evaluation');
const {renderWorkbench}=require('./calibration-workbench');
const clock=require('./event-time');
const ROOT=path.resolve(__dirname,'..');
const INPUT_FILES=['pipeline/shadow-scoring-v3.js','pipeline/shadow-scoring-v4.js','pipeline/event-time.js',
  'pipeline/commercial-fit.js','model-v7.js','pipeline/candidate-builder.js','pipeline/material-change.js',
  'pipeline/source-adapters.js','pipeline/calibration-cohort.js','pipeline/calibration-evaluation.js',
  'pipeline/calibration-workbench.js'];
const STATE_FILES=['state/detection-ledger.json','state/opportunity-ledger.json'];
function fileHash(file){return fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;}
function hashes(files){return Object.fromEntries(files.map(f=>[f,fileHash(path.join(ROOT,f))]));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function reviewers(files){return files.map(read);}
function safeOutput(dir){
  const out=path.resolve(dir||'');
  if(!dir||out===ROOT||out.startsWith(path.join(ROOT,'state')+path.sep)||out===path.join(ROOT,'state')||out.startsWith(path.join(ROOT,'scoring')+path.sep))throw new Error('SEPARATE_OUTPUT_DIRECTORY_REQUIRED');
  if(fs.existsSync(out)&&fs.readdirSync(out).length)throw new Error('OUTPUT_DIRECTORY_MUST_BE_EMPTY');
  fs.mkdirSync(out,{recursive:true});return out;
}
function savePacket(out,packet){
  write(path.join(out,'review-packet.json'),packet);
  write(path.join(out,'review-workbench.html'),renderWorkbench(packet));
}
async function prepare(output){
  const out=safeOutput(output),before=hashes(STATE_FILES);
  const {scanBatches}=require('./run-source-health');
  const {buildCurrentGraph}=require('./candidate-builder');
  const {observedAt,batches}=await scanBatches();
  const graph=buildCurrentGraph({dohmhBatch:batches.DOHMH,slaBatch:batches.SLA_PENDING,dobBatch:batches.DOB_NOW,reviewedIdentityBridges:[]});
  const cohort=c.buildCohort({graph,batches,observedAt,sourceRevision:process.env.GITHUB_SHA||process.env.SOURCE_COMMIT,
    codeHashes:hashes(INPUT_FILES)});
  const packet=c.blindPacket(cohort);
  const blocked=e.lockThresholds(cohort,[],observedAt);
  write(path.join(out,'operator','cohort.json'),cohort);
  write(path.join(out,'operator','label-readiness.json'),blocked);
  savePacket(path.join(out,'reviewer'),packet);
  const observations=Object.fromEntries(Object.entries(batches).map(([key,b])=>[key,{
    observationId:b.observation?.observationId,state:b.observation?.state,
    observedAt:b.observation?.observedAt,queryScopeHash:b.observation?.queryScopeHash,
    publisherCount:b.observation?.publisherCount,fetchedCount:b.observation?.fetchedCount,
    schemaFingerprint:b.observation?.schemaFingerprint,rawPageHashes:b.observation?.rawPageHashes
  }]));
  write(path.join(out,'operator','source-provenance.json'),observations);
  const after=hashes(STATE_FILES),unchanged=c.stable(before)===c.stable(after);
  const summary=c.sealed({version:c.VERSION,observedAt,sourceRevision:cohort.sourceRevision,
    graphState:graph.graphState,graphDigest:cohort.graphDigest,cohortId:cohort.cohortId,cohortFingerprint:cohort.fingerprint,
    counts:cohort.counts,categories:cohort.categories,initialVisibleReviewCases:packet.cards.length,
    initialVisibleJudgmentsPerReviewer:packet.cards.length*packet.categories.length,
    independentReviewsReceived:0,thresholdLockStatus:blocked.status,holdoutReleased:false,
    currentProductionMode:require('./scoring-policy').PRODUCTION_SCORING_MODE,
    productionAuthorized:false,externalSendCalls:0,productionStateWrites:0,
    productionStateUnchanged:unchanged,transportMode:'NO_SEND',
    frozenInputHashes:cohort.codeHashes,sourceObservations:observations,
    passed:unchanged&&blocked.status==='BLOCKED'&&packet.cards.every(card=>!('predictions' in card)),
    limitation:'This is a review instrument, not completed buyer calibration. No relevance labels, calibrated thresholds, customer outcomes, or longitudinal validation are claimed.'});
  write(path.join(out,'summary.json'),summary);
  write(path.join(out,'README.txt'),`PermitPlate blind calibration kit\n\nNo send or production policy changes.\n\nShare only reviewer/ with each independent domain reviewer. Do NOT share operator/: it contains model scores and hidden holdout cases. Reviewers open review-workbench.html, judge sources without model scores, and export completed JSON locally. No labels are prefilled. Keep completed reviews private.\n\nThe first phase includes tuning and diagnostic cases. Diagnostics are excluded from threshold metrics. Holdout cases are NOT in the first reviewer packet. Two complete independent reviews are required.\n\nRun from the matching source revision:\nnode pipeline/calibration-runner.js lock operator/cohort.json threshold-lock.json reviewer-a.json reviewer-b.json\nnode pipeline/calibration-runner.js holdout operator/cohort.json threshold-lock.json heldout-reviewer\nnode pipeline/calibration-runner.js evaluate operator/cohort.json threshold-lock.json holdout-result.json holdout-a.json holdout-b.json\n\nA lock failure is expected until real labels exist; changing cutoffs to match old volume is not allowed. No command enables production or sends mail. Reviewer attestations require manual identity/independence verification. This snapshot sample estimates evidence relevance within sampled site groups, not delivered-feed quality or purchasing. Actual longitudinal evidence and an explicit promotion are separate gates.\n`);
  return summary;
}
async function main(args=process.argv.slice(2)){
  const [command,...a]=args;
  if(command==='prepare'){
    const summary=await prepare(a[0]);console.log(JSON.stringify(summary,null,2));if(!summary.passed)process.exitCode=1;return summary;
  }
  if(command==='lock'){
    const [cohortFile,output,...reviews]=a,cohort=read(cohortFile);
    const result=e.lockThresholds(cohort,reviewers(reviews),new Date().toISOString());
    write(output,result);console.log(JSON.stringify(result,null,2));if(result.status==='BLOCKED')process.exitCode=2;return result;
  }
  if(command==='holdout'){
    const [cohortFile,lockFile,dir]=a;
    const packet=c.blindPacket(read(cohortFile),'HOLDOUT',read(lockFile));savePacket(safeOutput(dir),packet);
    console.log(JSON.stringify({phase:packet.phase,cases:packet.cards.length,productionAuthorized:false}));return packet;
  }
  if(command==='evaluate'){
    const [cohortFile,lockFile,output,...reviews]=a;
    const result=e.evaluateHoldout(read(cohortFile),read(lockFile),reviewers(reviews));write(output,result);
    console.log(JSON.stringify(result,null,2));if(result.status!=='ELIGIBLE_FOR_MANUAL_REVIEW_ONLY')process.exitCode=2;return result;
  }
  throw new Error('Usage: calibration-runner.js prepare OUTPUT | lock COHORT OUTPUT REVIEW_A REVIEW_B | holdout COHORT LOCK OUTPUT_DIR | evaluate COHORT LOCK OUTPUT REVIEW_A REVIEW_B');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={INPUT_FILES,STATE_FILES,fileHash,hashes,safeOutput,prepare,main};
