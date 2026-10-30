'use strict';
const fs=require('node:fs');
const path=require('node:path');
const stripePoll=require('./stripe-readonly-checkout-poll');
const intake=require('./curated-stripe-onboarding');
const {privateMaterialPath}=require('./run-subscriber-intake');

function readOptional(file){
  return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
function atomicJson(file,data){
  const dest=privateMaterialPath(file);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const temporary=dest+'.'+process.pid+'.tmp';
  try{
    fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',
      {flag:'wx',mode:0o600});
    fs.renameSync(temporary,dest);
  }finally{
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}
function checkPrior(ledger,anchor){
  if(Boolean(ledger)!==Boolean(anchor)){
    return {valid:false,failures:['STRIPE_INTAKE_STATE_PAIR_INCOMPLETE']};
  }
  if(ledger){
    const valid=intake.validate(ledger);
    if(!valid.valid)return valid;
    if(!intake.verifyAnchor(ledger,anchor)){
      return {valid:false,failures:['STRIPE_INTAKE_ANCHOR_INVALID']};
    }
  }
  return {valid:true,failures:[]};
}
async function run(input){
  const opts=input||{};
  if(!opts.ledgerPath||!opts.anchorPath){
    throw Error('STRIPE_INTAKE_PRIVATE_DESTINATION_REQUIRED');
  }
  const ledgerPath=privateMaterialPath(opts.ledgerPath);
  const anchorPath=privateMaterialPath(opts.anchorPath);
  const prior=readOptional(ledgerPath),priorAnchor=readOptional(anchorPath);
  const health=checkPrior(prior,priorAnchor);
  if(!health.valid)return {ready:false,status:'REVIEW',failures:health.failures};
  // Do not query Stripe until the private state is proven intact.
  const snapshot=await stripePoll.snapshot(opts.key,opts.fetchImpl);
  const now=opts.now||new Date().toISOString();
  const firstLedger=prior||intake.emptyLedger(now);
  const result=intake.processSnapshot({
    ...snapshot,checkedAt:now,previousLedger:firstLedger
  });
  if(result.status!=='READY')return {ready:false,status:'REVIEW',failures:result.failures};
  const newAnchor=priorAnchor||intake.anchor(firstLedger);
  atomicJson(ledgerPath,result.ledger);
  if(!priorAnchor)atomicJson(anchorPath,newAnchor);
  return {ready:true,status:'READY',
    newSubscriberCount:result.created,
    activePaidSessionCount:result.accepted,
    heldSessionCount:result.held,
    totalTrackedSubscribers:result.totalSubscribers,
    checkedAt:now,
    externalSendCalls:0,paymentMutations:0
  };
}
async function main(){
  if(process.argv.length!==4){
    throw Error('Usage: node pipeline/run-curated-stripe-onboarding.js PRIVATE_LEDGER PRIVATE_ANCHOR');
  }
  const result=await run({
    ledgerPath:process.argv[2],anchorPath:process.argv[3],
    key:process.env.PERMITPLATE_STRIPE_READ_KEY
  });
  // No subscriber names, emails, sessions or raw provider bodies in CI logs.
  console.log(JSON.stringify(result,null,2));
  if(!result.ready)process.exitCode=1;
}
if(require.main===module){
  main().catch(error=>{
    // Only the known safe error category, never raw Stripe response content.
    const message=String(error.message||'');
    const safe=/^[A-Z][A-Z0-9_]+$/.test(message)?message:'STRIPE_INTAKE_FAILED_CLOSED';
    console.error(safe);process.exitCode=1;
  });
}
module.exports={readOptional,atomicJson,checkPrior,run};
