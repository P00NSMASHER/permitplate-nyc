'use strict';

const fs=require('fs');
const path=require('path');
const opportunity=require('./opportunity-ledger');

const RUNNER_VERSION='PermitPlate-opportunity-ledger-runner-v1.0.0';

function readJson(filePath){
  if(!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath,'utf8'));
}
function readLedger(filePath){
  const parsed=readJson(filePath);
  return parsed&&parsed.initializedAt?parsed:null;
}

function run(options){
  const opts=options||{};
  const packagePath=path.resolve(opts.packagePath||path.join(__dirname,'opportunity-packages-result.json'));
  const statePath=path.resolve(opts.statePath||path.join(__dirname,'..','state','opportunity-ledger.json'));
  const outputPath=path.resolve(opts.outputPath||path.join(__dirname,'opportunity-ledger-run-result.json'));
  const packageResult=readJson(packagePath);
  if(!packageResult) throw new Error('opportunity package result missing: '+packagePath);

  const previous=readLedger(statePath);
  const observedAt=packageResult.observedAt ||
    packageResult.detectionObservedAt ||
    new Date().toISOString();
  const appended=opportunity.appendOpportunityPackages(previous,packageResult,observedAt);

  const summary={
    runnerVersion:RUNNER_VERSION,
    observedAt,
    committed:appended.committed===true,
    reason:appended.reason,
    priorLedgerInitialized:Boolean(previous&&previous.initializedAt),
    packageArtifactFingerprint:packageResult.artifactFingerprint||null,
    packageCount:Number(packageResult.packageCount||0),
    readyCount:Number(packageResult.readyCount||0),
    reviewCount:Number(packageResult.reviewCount||0),
    addedCount:(appended.added||[]).length,
    addedEventKeys:appended.added||[],
    totalEntries:appended.ledger?
      Object.keys(appended.ledger.entries||{}).length:
      previous?Object.keys(previous.entries||{}).length:0,
    ledgerFingerprint:appended.ledger&&appended.ledger.ledgerFingerprint||null,
    errors:appended.errors||[]
  };

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(summary,null,2)+'\n');

  if(appended.committed&&appended.ledger){
    fs.mkdirSync(path.dirname(statePath),{recursive:true});
    fs.writeFileSync(statePath,JSON.stringify(appended.ledger,null,2)+'\n');
  }

  return {summary,appended};
}

function main(){
  const packagePath=process.argv[2]||path.join(__dirname,'opportunity-packages-result.json');
  const statePath=process.argv[3]||path.join(__dirname,'..','state','opportunity-ledger.json');
  const outputPath=process.argv[4]||path.join(__dirname,'opportunity-ledger-run-result.json');
  const {summary}=run({packagePath,statePath,outputPath});
  console.log(JSON.stringify(summary,null,2));
  if(!summary.committed) process.exitCode=1;
}

if(require.main===module){
  try{main();}catch(error){console.error(error);process.exit(1);}
}

module.exports={RUNNER_VERSION,readJson,readLedger,run};
