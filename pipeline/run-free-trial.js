'use strict';

// Private operator transaction. No send, Stripe mutation, or public output.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const trials=require('./free-trial');
const customer=require('./curated-customer-brief');
const {privateMaterialPath,args}=require('./run-subscriber-intake');
function safePath(value){
  const target=privateMaterialPath(value);
  let parent=target;
  while(!fs.existsSync(parent)){
    const next=path.dirname(parent);if(next===parent)throw Error('TRIAL_PRIVATE_PATH_INVALID');parent=next;
  }
  const actual=path.join(fs.realpathSync(parent),path.relative(parent,target));
  privateMaterialPath(actual);
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('TRIAL_SYMLINK_NOT_ALLOWED');
  return actual;
}
const read=file=>JSON.parse(fs.readFileSync(safePath(file),'utf8'));
function writeNew(file,data){
  const target=safePath(file);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
}
function transact(options,update){
  const target=safePath(options.registry);
  if(options.output&&safePath(options.output)!==target)throw Error('TRIAL_CANONICAL_REGISTRY_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(options['expected-fingerprint']||''))throw Error('TRIAL_EXPECTED_REVISION_REQUIRED');
  const lock=target+'.lock',temp=target+'.'+crypto.randomUUID()+'.tmp';
  const fd=fs.openSync(lock,'wx',0o600);
  try{
    const registry=read(target);trials.validate(registry);
    if(registry.registryFingerprint!==options['expected-fingerprint'])throw Error('TRIAL_STALE_REVISION');
    const result=update(registry);trials.validate(result.registry);
    // Keep prior states for review; one canonical file is atomically replaced.
    const history=path.join(target+'.history',registry.registryFingerprint+'.json');
    if(!fs.existsSync(history))writeNew(history,registry);
    writeNew(temp,result.registry);fs.renameSync(temp,target);
    return result;
  }finally{
    if(fs.existsSync(temp))fs.unlinkSync(temp);
    fs.closeSync(fd);fs.unlinkSync(lock);
  }
}
function run(options){
  const action=options.action;
  if(action==='init'){
    if(!['TEST','LIVE'].includes(options.environment))throw Error('EXPLICIT_TRIAL_ENVIRONMENT_REQUIRED');
    writeNew(options.output,trials.createRegistry(options.environment));
    return {status:'EMPTY_REGISTRY_CREATED',environment:options.environment};
  }
  const registry=read(options.registry);trials.validate(registry);
  if(action==='enroll'){
    const input=read(options.input);
    const result=transact(options,current=>trials.enroll(current,input.request,input.approval));
    return {status:result.status,trialId:result.trialId,paymentRequired:false};
  }
  if(action==='prepare'){
    const bundle=read(options.input);
    const result=customer.prepareTrial({...bundle,trialRegistry:registry,trialId:options['trial-id'],
      preparedAt:options['prepared-at']||new Date().toISOString()});
    if(result.status==='REVIEW')throw Error(result.failures.join('|'));
    const output=safePath(options.output);
    fs.mkdirSync(output,{mode:0o700});
    writeNew(path.join(output,'prepared.json'),result);
    fs.writeFileSync(path.join(output,'message.html'),result.brief.html,{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(output,result.brief.filename),result.brief.csv,{flag:'wx',mode:0o600});
    return {status:result.status,signalCount:result.signalCount,transportAllowed:false,externalSendCalls:0};
  }
  if(action==='record-delivery'){
    const input=read(options.input);
    const result=transact(options,current=>trials.recordDelivery(current,options['trial-id'],input.prepared,input.evidence,input.attestation));
    return {status:result.status,expiresAt:result.expiresAt||null,automaticBilling:false,
      inboxDeliveryConfirmed:false};
  }
  if(action==='cancel'){
    transact(options,current=>({registry:trials.cancel(current,options['trial-id'],options.now||new Date().toISOString())}));
    return {status:'CANCELLED',automaticBilling:false};
  }
  throw Error('TRIAL_ACTION_INVALID');
}
if(require.main===module){
  try{console.log(JSON.stringify(run(args(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={safePath,read,writeNew,transact,run};
