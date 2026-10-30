'use strict';
// Main-only GitHub Actions private-state writer. No customer email, payment
// mutation, public logs with PII, generated customer artifact, or score.
const fs=require('node:fs');
const path=require('node:path');
const core=require('./pa-permit-orders');
const stripe=require('./pa-permit-stripe');
const {privateMaterialPath}=require('./run-subscriber-intake');
function optional(file){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null}
function writeAtomic(dest,obj){
  const full=privateMaterialPath(dest);
  fs.mkdirSync(path.dirname(full),{recursive:true});
  const temp=full+'.'+process.pid+'.tmp';
  try{
    fs.writeFileSync(temp,JSON.stringify(obj,null,2)+'\n',{mode:0o600,flag:'wx'});
    fs.renameSync(temp,full);
  }finally{
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
function priorHealth(ledger,anchor){
  if(Boolean(ledger)!==Boolean(anchor)){
    return {valid:false,failures:['PA_PRIVATE_STATE_PAIR_INCOMPLETE']};
  }
  if(!ledger)return {valid:true,failures:[]};
  const valid=core.validate(ledger);
  if(!valid.valid)return valid;
  if(!core.verifyAnchor(ledger,anchor)){
    return {valid:false,failures:['PA_PRIVATE_ANCHOR_INVALID']};
  }
  return {valid:true,failures:[]};
}
async function run(opts){
  const o=opts||{};
  if(!o.ledgerPath||!o.anchorPath){
    throw Error('PA_PRIVATE_DESTINATION_REQUIRED');
  }
  const ledgerPath=privateMaterialPath(o.ledgerPath);
  const anchorPath=privateMaterialPath(o.anchorPath);
  const old=optional(ledgerPath),oldAnchor=optional(anchorPath);
  const health=priorHealth(old,oldAnchor);
  if(!health.valid)return {ready:false,status:'REVIEW',failures:health.failures};
  const snapshot=await stripe.snapshot(o.key,o.fetchImpl);
  const now=o.now||new Date().toISOString();
  const baseline=old||core.empty(now);
  const processed=core.evaluate({...snapshot,previousLedger:baseline,checkedAt:now});
  if(processed.status!=='READY')return {
    ready:false,status:'REVIEW',failures:processed.failures
  };
  const check=core.validate(processed.ledger);
  if(!check.valid)return {ready:false,status:'REVIEW',failures:check.failures};
  const newAnchor=oldAnchor||core.anchor(baseline);
  // For a first run a torn pair must be rejected next time rather than seeded
  // over or mistaken for a successfully initialized private state.
  if(!oldAnchor)writeAtomic(anchorPath,newAnchor);
  writeAtomic(ledgerPath,processed.ledger);
  return {
    ready:true,status:'PRIVATE_ORDER_LEDGER_UPDATED',
    checkedAt:now,newOrders:processed.newOrders,
    paidProviderVerified:processed.paid,unpaidCompleted:processed.unpaid,
    totalOrders:processed.totalOrders,ordersOnHold:processed.heldOrders,
    providerVerifiedDeliveries:processed.deliveriesVerified,
    externalSendCalls:0,paymentMutations:0,automaticDeliveryAllowed:false
  };
}
async function main(){
  if(process.argv.length!==4){
    throw Error('PA_PRIVATE_LEDGER_AND_ANCHOR_PATH_REQUIRED');
  }
  const result=await run({
    ledgerPath:process.argv[2],anchorPath:process.argv[3],
    key:process.env.PERMITPLATE_STRIPE_READ_KEY
  });
  // Aggregate-only output: never log raw Stripe sessions, project scope or PII.
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.ready)process.exitCode=1;
}
if(require.main===module){
  main().catch(e=>{
    const message=String(e.message||'');
    console.error(/^PA_[A-Z0-9_]+$/.test(message)?message:'PA_ORDER_INTAKE_FAILED_CLOSED');
    process.exitCode=1;
  });
}
module.exports={optional,writeAtomic,priorHealth,run};
