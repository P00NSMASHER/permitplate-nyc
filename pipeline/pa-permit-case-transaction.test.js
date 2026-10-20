'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const cp=require('node:child_process');
const core=require('./pa-permit-orders');
const transaction=require('./pa-permit-case-transaction');

const T0='2026-10-19T14:00:00.000Z';
const T1='2026-10-19T15:30:00.000Z';
const CASE='cs_live_pa_transaction_fixture_01';
const bareName='origin-private.git';
function git(root,args){
  const x=cp.spawnSync('git',['-C',root,...args],{
    encoding:'utf8',timeout:20000,maxBuffer:256*1024
  });
  if(x.status!==0||x.error)throw Error('FIXTURE_GIT_FAILED: '+JSON.stringify(args));
  return x.stdout.trim();
}
function session(){
  return {
    id:CASE,object:'checkout.session',livemode:true,mode:'payment',
    payment_link:core.LINK,status:'complete',payment_status:'paid',
    created:Date.parse('2026-10-19T13:00:00Z')/1000,
    amount_subtotal:2900,amount_total:2900,currency:'usd',
    payment_intent:'pi_live_pa_transaction_fixture_01',
    subscription:null,customer:'cus_pa_transaction_fixture_01',
    customer_details:{email:'not-a-real-customer@example.org'},
    custom_fields:[
      {key:'municipality',type:'text',
        text:{value:'Pottsville, Schuylkill County'}},
      {key:'projectaddress',type:'text',
        text:{value:'101 Example Avenue, Pottsville PA'}},
      {key:'projectscope',type:'text',
        text:{value:'Replace commercial restaurant kitchen ventilation'}}
    ]
  };
}
function paid(){
  const initial=core.empty(T0);
  const s=session();
  const scanned=core.evaluate({
    checkedAt:T0,previousLedger:initial,complete:true,
    sessions:[s],lineItemsBySession:{[s.id]:{
      object:'list',has_more:false,data:[{
        quantity:1,amount_subtotal:2900,
        price:{id:core.PRICE,currency:'usd',unit_amount:2900,recurring:null}
      }]
    }}
  });
  assert.equal(scanned.status,'READY');
  assert.equal(scanned.newOrders,1);
  return {ledger:scanned.ledger,anchor:core.anchor(initial)};
}
const research={
  researcherId:'fixture-researcher-1',
  preparedAt:'2026-10-19T15:00:00.000Z',
  projectSummary:'Synthetic kitchen ventilation case for testing private operator publication only.',
  jurisdiction:'Schuylkill County and municipal permitting authority to verify',
  authorityName:'The local building-code administration office requires confirmation',
  publicFeeNotes:'The correct filing fees and published schedules must be confirmed.',
  sources:[
    {sourceId:'FIXTURE-PA-DLI-01',url:'https://www.pa.gov/agencies/dli.html',
      claim:'A live researcher must independently inspect actual state guidance.',
      observedAt:'2026-10-19T14:10:00.000Z',verifiedByHuman:true},
    {sourceId:'FIXTURE-PA-DLI-02',url:'https://www.pa.gov/agencies/dli/resources.html',
      claim:'A real reviewer must verify jurisdiction and current forms separately.',
      observedAt:'2026-10-19T14:11:00.000Z',verifiedByHuman:true}
  ],
  filingSteps:[
    {action:'Inspect original state guidance to identify local building-code authority.',
      sourceUrl:'https://www.pa.gov/agencies/dli.html'},
    {action:'Contact the relevant real municipal office and confirm applicability.',
      sourceUrl:'https://www.pa.gov/agencies/dli/resources.html'}
  ],
  unresolvedQuestions:[
    'Independently determine which local permits govern this example project.'
  ],
  claimsGovernmentApproval:false,claimsLegalAdvice:false,
  claimsNoFurtherVerification:false
};

async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pa-private-op-'));
  try{
    const bare=path.join(root,bareName);
    const local=path.join(root,'owner');
    const stale=path.join(root,'stale');
    const evidence=path.join(root,'evidence-private.json');
    fs.mkdirSync(bare,{recursive:true});
    fs.mkdirSync(local,{recursive:true});
    git(root,['init','--bare','-q',bare]);
    git(root,['init','-q','-b','main',local]);
    const state=path.join(local,'state');
    fs.mkdirSync(state);
    const baseline=paid();
    fs.writeFileSync(path.join(state,'pa-permit-orders.json'),
      JSON.stringify(baseline.ledger,null,2)+'\n');
    fs.writeFileSync(path.join(state,'pa-permit-anchor.json'),
      JSON.stringify(baseline.anchor,null,2)+'\n');
    fs.writeFileSync(evidence,JSON.stringify(research,null,2)+'\n');
    git(local,['add','--','state/pa-permit-orders.json','state/pa-permit-anchor.json']);
    git(local,['-c','user.name=Fixture','-c',
      'user.email=fixture@example.org','commit','-q','-m','synthetic fixture']);
    git(local,['remote','add','origin',bare]);
    git(local,['push','-q','origin','main']);
    git(bare,['symbolic-ref','HEAD','refs/heads/main']);
    git(root,['clone','-q','--branch','main',bare,stale]);
    const expected=baseline.ledger.ledgerFingerprint;
    assert.equal(transaction.immutablePayments(baseline.ledger,
      baseline.ledger),true);
    assert.equal(transaction.immutablePayments(baseline.ledger,{
      ...baseline.ledger,orders:{
        ...baseline.ledger.orders,
        [CASE]:{...baseline.ledger.orders[CASE],
          email:'malicious@example.org'}
      }
    }),false);
    await assert.rejects(transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:'f'.repeat(64),now:T1
    }),/PA_PRIVATE_EXPECTED_LEDGER_REVISION_MISMATCH/);
    assert.equal(git(local,['status','--porcelain']),'');

    const published=await transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:expected,now:T1
    });
    assert.equal(published.published,true);
    assert.equal(published.status,'PRIVATE_CASE_PUBLISHED_FOR_NEXT_INTAKE');
    assert.equal(published.operation,'research');
    assert.equal(published.customerDeliveryAutomaticallyAuthorized,false);
    assert.equal(published.externalSendCalls,0);
    assert.equal(published.paymentMutations,0);
    assert(/^[a-f0-9]{40}$/.test(published.privateCommit));
    assert.equal(git(local,['status','--porcelain']),'');
    assert.equal(git(local,['rev-parse','HEAD']),
      git(bare,['rev-parse','refs/heads/main']));
    // The production private repository, not merely an operator's copy, must
    // receive the exact matching private ledger and unchanged anchor.
    const updated=JSON.parse(fs.readFileSync(path.join(local,'state',
      'pa-permit-orders.json'),'utf8'));
    assert.equal(updated.orders[CASE].phase,'RESEARCH_SUBMITTED');
    assert.equal(updated.orders[CASE].email,'not-a-real-customer@example.org');
    const second=await transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:updated.ledgerFingerprint,
      now:'2026-10-19T15:45:00.000Z'
    });
    assert.equal(second.status,'UNCHANGED');
    assert.equal(second.published,false);
    assert.equal(git(local,['rev-parse','HEAD']),published.privateCommit);
    await assert.rejects(transaction.apply({
      privateRoot:stale,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:expected,now:T1
    }),/PA_PRIVATE_REMOTE_MAIN_CHANGED/);
    assert.equal(git(stale,['status','--porcelain']),'');
    const lock=path.join(local,'.git','permitplate-pa-operator.lock');
    fs.writeFileSync(lock,'fixture lock');
    await assert.rejects(transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:updated.ledgerFingerprint,
      now:T1
    }),/PA_PRIVATE_LOCAL_OPERATOR_LOCK_UNAVAILABLE/);
    fs.unlinkSync(lock);
    fs.writeFileSync(path.join(local,'unexpected.txt'),'fixture');
    await assert.rejects(transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'research',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:updated.ledgerFingerprint,
      now:T1
    }),/PA_PRIVATE_WORKTREE_NOT_CLEAN/);
    assert.equal(fs.existsSync(lock),false);
    fs.unlinkSync(path.join(local,'unexpected.txt'));
    await assert.rejects(transaction.apply({
      privateRoot:local,testOnlyRemote:bare,mode:'status',sessionId:CASE,
      packetPath:evidence,expectedLedgerFingerprint:updated.ledgerFingerprint,
      now:T1
    }),/PA_PRIVATE_CASE_OPERATION_INVALID/);
    const wrongRemote=path.join(root,'unexpected-remote');
    fs.mkdirSync(wrongRemote);
    git(root,['init','--bare','-q',wrongRemote]);
    await assert.rejects(transaction.apply({
      privateRoot:local,testOnlyRemote:wrongRemote,mode:'research',
      sessionId:CASE,packetPath:evidence,
      expectedLedgerFingerprint:updated.ledgerFingerprint,now:T1
    }),/PA_PRIVATE_TRUSTED_REMOTE_REQUIRED/);
    assert.equal(fs.existsSync(lock),false);
    assert.equal(git(bare,['rev-parse','refs/heads/main']),published.privateCommit);
    console.log('PA private case transaction: real local Git CAS, stale-head refusal, strict paid identity, no-send, local lock and idempotent review passed.');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
