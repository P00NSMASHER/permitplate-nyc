'use strict';

// Operator-only durable case update. Refuses stale or unverified local copies,
// preserves the Stripe-paid identity, and publishes only after an exact remote
// main compare-and-swap. No customer send, refund, or provider POST.
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const core=require('./pa-permit-orders');
const workbench=require('./run-pa-permit-workbench');
const {privateMaterialPath}=require('./run-subscriber-intake');

const VERSION='PermitPlate-PA-private-operator-transaction-v1.0.0';
const PRIVATE_REMOTE=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)P00NSMASHER\/permitplate-state(?:\.git)?$/;
const SOURCE_REMOTE=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)P00NSMASHER\/permitplate-nyc(?:\.git)?$/;
const MODES=Object.freeze(['research','qc','resolve-hold','record-accepted','verify-delivery']);

function git(cwd,argv){
  const result=cp.spawnSync('git',['-C',cwd,...argv],{
    encoding:'utf8',timeout:25000,maxBuffer:256*1024,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}
  });
  if(result.error||result.status!==0||typeof result.stdout!=='string'){
    throw Error('PA_PRIVATE_GIT_COMMAND_FAILED');
  }
  return result.stdout.trim();
}
function normalizePath(p){
  const full=fs.realpathSync(p);
  return process.platform==='win32'?full.toLowerCase():full;
}
function verifyRepo(root,expectedRemote,allowedTestRemote){
  const real=normalizePath(root);
  if(!fs.statSync(real).isDirectory())throw Error('PA_PRIVATE_REPO_DIRECTORY_REQUIRED');
  if(normalizePath(git(real,['rev-parse','--show-toplevel']))!==real){
    throw Error('PA_PRIVATE_GIT_TOPLEVEL_REQUIRED');
  }
  if(git(real,['branch','--show-current'])!=='main'){
    throw Error('PA_PRIVATE_MAIN_BRANCH_REQUIRED');
  }
  const remote=git(real,['remote','get-url','origin']);
  if(!expectedRemote.test(remote)&&remote!==allowedTestRemote){
    throw Error('PA_PRIVATE_TRUSTED_REMOTE_REQUIRED');
  }
  if(git(real,['status','--porcelain=v1','--untracked-files=all'])!==''){
    throw Error('PA_PRIVATE_WORKTREE_NOT_CLEAN');
  }
  const head=git(real,['rev-parse','HEAD']);
  const remoteLine=git(real,['ls-remote','--exit-code','origin','refs/heads/main']);
  const remoteHead=remoteLine.split(/\s+/)[0];
  if(!/^[a-f0-9]{40}$/.test(remoteHead)||head!==remoteHead){
    throw Error('PA_PRIVATE_REMOTE_MAIN_CHANGED');
  }
  return {root:real,head};
}
function assertLedgerFiles(root){
  const ledger=path.join(root,'state','pa-permit-orders.json');
  const anchor=path.join(root,'state','pa-permit-anchor.json');
  for(const file of [ledger,anchor]){
    if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||
       !fs.statSync(file).isFile()){
      throw Error('PA_PRIVATE_STATE_FILE_MISSING_OR_UNTRUSTED');
    }
    const relative=path.relative(root,normalizePath(file));
    if(relative.startsWith('..')||path.isAbsolute(relative)){
      throw Error('PA_PRIVATE_STATE_PATH_OUTSIDE_REPO');
    }
  }
  return {ledger,anchor};
}
function immutablePayments(before,after){
  if(before.initializedAt!==after.initializedAt||
     before.checkedAt!==after.checkedAt||
     Object.keys(before.orders).length!==Object.keys(after.orders).length){
    return false;
  }
  const keys=['checkoutSessionId','paymentIntentId','priceId','livemode',
    'currency','amountSubtotal','amountTotal','email','customerId','project',
    'paidAt','firstDiscoveredAt','paymentFingerprint','projectFingerprint',
    'verifiedPayment','transportAllowed','automaticDeliveryAllowed'];
  return Object.keys(before.orders).every(id=>{
    const x=before.orders[id],y=after.orders[id];
    return y&&keys.every(key=>core.stable(x[key])===core.stable(y[key]));
  });
}
async function apply(input){
  const opts=input||{};
  if(!MODES.includes(opts.mode)||!core.id(opts.sessionId,'cs')){
    throw Error('PA_PRIVATE_CASE_OPERATION_INVALID');
  }
  const root=privateMaterialPath(opts.privateRoot||'');
  const repo=verifyRepo(root,PRIVATE_REMOTE,opts.testOnlyRemote);
  // The CLI always checks current audited public main. Test fixtures may
  // skip this condition only when calling this module programmatically.
  if(opts.testOnlyRemote===undefined){
    verifyRepo(path.resolve(__dirname,'..'),SOURCE_REMOTE,undefined);
  }
  const paths=assertLedgerFiles(repo.root);
  const rawBefore=fs.readFileSync(paths.ledger,'utf8');
  const rawAnchor=fs.readFileSync(paths.anchor,'utf8');
  const before=JSON.parse(rawBefore),anchor=JSON.parse(rawAnchor);
  if(!core.validate(before).valid||!core.verifyAnchor(before,anchor)){
    throw Error('PA_PRIVATE_INTEGRITY_INVALID');
  }
  if(opts.expectedLedgerFingerprint&&
     opts.expectedLedgerFingerprint!==before.ledgerFingerprint){
    throw Error('PA_PRIVATE_EXPECTED_LEDGER_REVISION_MISMATCH');
  }
  if(!before.orders[opts.sessionId]){
    throw Error('PA_PRIVATE_PAID_ORDER_NOT_REGISTERED');
  }
  const packet=opts.packetPath||'-';
  if(opts.mode!=='verify-delivery'&&packet==='-'){
    throw Error('PA_PRIVATE_EVIDENCE_PACKET_REQUIRED');
  }
  if(packet!=='-'){
    const p=privateMaterialPath(packet);
    if(!fs.existsSync(p)||!fs.statSync(p).isFile()||
       fs.lstatSync(p).isSymbolicLink()){
      throw Error('PA_PRIVATE_EVIDENCE_PACKET_INVALID');
    }
  }
  // This returns only aggregate state changes. Workbench has no mail sender.
  const result=await workbench.run([
    opts.mode,paths.ledger,paths.anchor,opts.sessionId,packet
  ],opts.now||new Date().toISOString());
  if(result.status==='REVIEW'||!result.stateCommittedToLocalPrivateFile){
    if(fs.readFileSync(paths.ledger,'utf8')!==rawBefore||
       fs.readFileSync(paths.anchor,'utf8')!==rawAnchor){
      throw Error('PA_PRIVATE_REVIEW_MODIFIED_STATE_UNEXPECTEDLY');
    }
    return {version:VERSION,status:result.status,
      published:false,sendCalls:0,paymentMutations:0};
  }
  if(fs.readFileSync(paths.anchor,'utf8')!==rawAnchor){
    throw Error('PA_PRIVATE_ANCHOR_MUTATION_FORBIDDEN');
  }
  const after=JSON.parse(fs.readFileSync(paths.ledger,'utf8'));
  if(!core.validate(after).valid||!core.verifyAnchor(after,anchor)||
     !immutablePayments(before,after)){
    throw Error('PA_PRIVATE_OPERATOR_CHANGED_PAID_IDENTITY');
  }
  const changed=git(repo.root,['status','--porcelain=v1','--untracked-files=all']);
  if(changed!==' M state/pa-permit-orders.json'){
    throw Error('PA_PRIVATE_OPERATOR_UNEXPECTED_FILE_CHANGE');
  }
  // Prevent publication if another legitimate source or private writer has
  // moved main while this human operation was in progress.
  const nextRemote=git(repo.root,['ls-remote','--exit-code','origin',
    'refs/heads/main']).split(/\s+/)[0];
  if(nextRemote!==repo.head){
    throw Error('PA_PRIVATE_REMOTE_MAIN_CHANGED_DURING_REVIEW');
  }
  git(repo.root,['add','--','state/pa-permit-orders.json']);
  const staged=git(repo.root,['diff','--cached','--name-only']);
  if(staged!=='state/pa-permit-orders.json'){
    throw Error('PA_PRIVATE_STAGING_NOT_EXACT');
  }
  git(repo.root,['diff','--cached','--check']);
  git(repo.root,['-c','user.name=PermitPlate PA Owner Session',
    '-c','user.email=actions@users.noreply.github.com','commit',
    '-m','pa: preserve reviewed private case state (NO SEND)']);
  const commit=git(repo.root,['rev-parse','HEAD']);
  // Normal non-force Git push is the final remote CAS. If concurrent main
  // moved, this fails without overwriting any legitimate private state.
  git(repo.root,['push','origin','HEAD:refs/heads/main']);
  const confirmed=git(repo.root,['ls-remote','--exit-code','origin',
    'refs/heads/main']).split(/\s+/)[0];
  if(confirmed!==commit)throw Error('PA_PRIVATE_OPERATOR_REMOTE_PUSH_UNVERIFIED');
  return {version:VERSION,status:'PRIVATE_CASE_PUBLISHED_FOR_NEXT_INTAKE',
    operation:opts.mode,privateCommit:commit,published:true,
    independentHumanAuthenticationProven:false,
    customerDeliveryAutomaticallyAuthorized:false,
    externalSendCalls:0,paymentMutations:0};
}
async function main(){
  if(process.argv.length!==8){
    throw Error('PA_PRIVATE_CASE_TRANSACTION_USAGE_INVALID');
  }
  const out=await apply({
    mode:process.argv[2],privateRoot:process.argv[3],
    sessionId:process.argv[4],packetPath:process.argv[5],
    expectedLedgerFingerprint:process.argv[6],now:process.argv[7]
  });
  process.stdout.write(JSON.stringify(out,null,2)+'\n');
  if(!out.published&&out.status==='REVIEW')process.exitCode=1;
}
if(require.main===module){
  main().catch(error=>{
    const raw=String(error.message||'');
    console.error(/^PA_[A-Z0-9_]+$/.test(raw)?raw:
      'PA_PRIVATE_OPERATOR_TRANSACTION_FAILED_CLOSED');
    process.exitCode=1;
  });
}
module.exports={VERSION,MODES,git,verifyRepo,assertLedgerFiles,immutablePayments,apply};
