'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const core=require('./pa-permit-orders');
const finance=require('./pa-permit-financial-readback');
const fulfil=require('./pa-permit-fulfillment');
const workbench=require('./run-pa-permit-workbench');
const transaction=require('./pa-permit-case-transaction');

const PAID='2026-10-19T13:00:00.000Z';
const SCAN='2026-10-19T14:00:00.000Z';
const NOW='2026-10-19T14:50:00.000Z';
const SESSION='cs_live_pa_finance_fixture001';
const PI='pi_live_pa_finance_fixture001';
const CH='ch_live_pa_finance_fixture001';
const CUSTOMER='cus_live_pa_finance_fixture';
const KEY='rk_live_finance_fixture_for_testing_only_123';
const priceItem={
  object:'list',has_more:false,data:[{
    quantity:1,amount_subtotal:2900,
    price:{id:core.PRICE,unit_amount:2900,currency:'usd',recurring:null}
  }]
};
const session={
  object:'checkout.session',id:SESSION,livemode:true,mode:'payment',
  status:'complete',payment_status:'paid',payment_link:core.LINK,
  created:Date.parse(PAID)/1000,payment_intent:PI,
  currency:'usd',amount_subtotal:2900,amount_total:2900,subscription:null,
  customer:CUSTOMER,customer_details:{email:'synthetic-buyer@example.org'},
  custom_fields:[
    {key:'municipality',type:'text',
      text:{value:'Pottsville, Schuylkill County'}},
    {key:'projectaddress',type:'text',
      text:{value:'123 Example Street, Pottsville, PA'}},
    {key:'projectscope',type:'text',
      text:{value:'Commercial restaurant hood replacement and renovation'}}
  ]
};
const initial=core.empty(SCAN),anchor=core.anchor(initial);
const processed=core.evaluate({
  checkedAt:SCAN,complete:true,previousLedger:initial,
  sessions:[session],lineItemsBySession:{[SESSION]:priceItem}
});
assert.equal(processed.status,'READY');
const order=processed.ledger.orders[SESSION];
const paymentIntent={
  object:'payment_intent',id:PI,livemode:true,status:'succeeded',
  currency:'usd',amount:2900,amount_received:2900,customer:CUSTOMER,
  latest_charge:CH
};
const charge={
  object:'charge',id:CH,livemode:true,status:'succeeded',
  payment_intent:PI,currency:'usd',amount:2900,customer:CUSTOMER,
  paid:true,captured:true,refunded:false,disputed:false,amount_refunded:0
};
function fake(pi=paymentIntent,ch=charge){
  let reads=0;
  const fetchImpl=async(url,opts)=>{
    reads++;
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer '+KEY);
    assert(opts.signal);
    const u=new URL(url);
    assert.equal(u.hostname,'api.stripe.com');
    if(u.pathname==='/v1/payment_intents/'+PI){
      return {ok:true,json:async()=>structuredClone(pi)};
    }
    if(u.pathname==='/v1/charges/'+CH){
      return {ok:true,json:async()=>structuredClone(ch)};
    }
    throw Error('UNEXPECTED_STRIPE_ENDPOINT');
  };
  return {fetchImpl,reads:()=>reads};
}
assert(finance.allowUrl('https://api.stripe.com/v1/payment_intents/'+PI,'payment_intents',PI));
assert(!finance.allowUrl('http://api.stripe.com/v1/payment_intents/'+PI,'payment_intents',PI));
assert(!finance.allowUrl('https://evil.example/v1/payment_intents/'+PI,'payment_intents',PI));
assert(!finance.allowUrl('https://api.stripe.com/v1/payment_intents/'+PI+'?expand[]=foo',
  'payment_intents',PI));
assert(!finance.allowUrl('https://api.stripe.com/v1/charges/'+CH,
  'payment_intents',PI));
const ready=finance.evaluate(order,paymentIntent,charge,NOW);
assert.equal(ready.status,'CURRENTLY_PAID_FOR_MANUAL_REPORT');
assert.equal(ready.noAutomaticDelivery,true);
assert.equal(ready.actualSettlementOrFutureChargebackGuaranteed,false);
assert.equal(ready.customerIdentifyingFieldsLogged,false);
assert(!JSON.stringify(ready).includes('synthetic-buyer@example.org'));
assert(/^[a-f0-9]{64}$/.test(ready.receiptFingerprint));
const badInputs=[
  [{...paymentIntent,status:'processing'},charge],
  [{...paymentIntent,amount_received:0},charge],
  [{...paymentIntent,amount:2800},charge],
  [{...paymentIntent,livemode:false},charge],
  [{...paymentIntent,customer:'cus_other'},charge],
  [{...paymentIntent,id:'pi_other'},charge],
  [{...paymentIntent,latest_charge:'ch_unknown_charge'},charge],
  [paymentIntent,{...charge,paid:false}],
  [paymentIntent,{...charge,captured:false}],
  [paymentIntent,{...charge,refunded:true}],
  [paymentIntent,{...charge,amount_refunded:100}],
  [paymentIntent,{...charge,disputed:true}],
  [paymentIntent,{...charge,status:'pending'}],
  [paymentIntent,{...charge,amount:3000}],
  [paymentIntent,{...charge,currency:'eur'}],
  [paymentIntent,{...charge,livemode:false}],
  [paymentIntent,{...charge,customer:'cus_other'}],
  [paymentIntent,{...charge,payment_intent:'pi_other'}],
  [paymentIntent,{...charge,id:'ch_mismatch'}]
];
for(const [pi,ch] of badInputs){
  const x=finance.evaluate(order,pi,ch,NOW);
  assert.equal(x.status,'FINANCIAL_RECONCILIATION_HOLD');
  assert(x.failures.length);
  assert.equal(x.noAutomaticDelivery,true);
}
const research={
  researcherId:'real_reviewer_fixture',preparedAt:'2026-10-19T14:10:00.000Z',
  projectSummary:'A hypothetical restaurant kitchen alteration needs independent municipal code review.',
  jurisdiction:'Pottsville municipality and Schuylkill County code jurisdiction',
  authorityName:'Actual local Pennsylvania code-enforcement authority to confirm',
  publicFeeNotes:'Published municipal and statewide fee amounts need direct source verification.',
  sources:[
    {sourceId:'OFFICIAL_PA_DLI_01',url:'https://www.pa.gov/agencies/dli.html',
      claim:'The PA Labor and Industry official state page explains UCC administration context.',
      observedAt:'2026-10-19T14:05:00.000Z',verifiedByHuman:true},
    {sourceId:'OFFICIAL_PA_DLI_02',url:'https://www.pa.gov/agencies/dli/resources.html',
      claim:'The reviewer must confirm official local applicability and current office contact.',
      observedAt:'2026-10-19T14:06:00.000Z',verifiedByHuman:true}
  ],
  filingSteps:[
    {action:'Verify UCC administration and local building permit classification.',
      sourceUrl:'https://www.pa.gov/agencies/dli.html'},
    {action:'Confirm current municipal authority and the submission procedure.',
      sourceUrl:'https://www.pa.gov/agencies/dli/resources.html'}
  ],
  unresolvedQuestions:['Does this particular commercial project require additional hood and fire approvals?'],
  claimsGovernmentApproval:false,claimsLegalAdvice:false,
  claimsNoFurtherVerification:false
};
const reviewed=fulfil.submitResearch({
  ledger:processed.ledger,anchor,sessionId:SESSION,research,
  now:'2026-10-19T14:15:00.000Z'
});
assert.equal(reviewed.status,'RESEARCH_RECORDED_NO_SEND');
const quality=fulfil.qc({
  ledger:reviewed.ledger,anchor,sessionId:SESSION,
  review:{
    reviewerId:'separate_qc_fixture',reviewedAt:'2026-10-19T14:25:00.000Z',
    expectedResearchFingerprint:core.sha(research),
    limitations:'Unverified official application and local code authority must be checked.',
    sourceUrlsIndependentlyChecked:true,
    projectAddressIndependentlyChecked:true,
    authorityJurisdictionConfirmed:true,
    restrictionsAcknowledged:true,approve:true
  },
  now:'2026-10-19T14:30:00.000Z'
});
assert.equal(quality.status,'QC_ATTESTED_MANUAL_SEND_ONLY');
async function main(){
  const input=fake();
  const check=await finance.inspect(order,KEY,NOW,input.fetchImpl);
  assert.equal(check.status,'CURRENTLY_PAID_FOR_MANUAL_REPORT');
  assert.equal(input.reads(),2);
  assert.equal(check.verifiedChargeId,CH);
  await assert.rejects(finance.inspect(order,'sk_live_invalid',NOW,fake().fetchImpl),
    /PA_FINANCE_RESTRICTED_READ_KEY_REQUIRED/);
  await assert.rejects(finance.inspect(order,KEY,NOW,async()=>{throw Error('network-failed')}),
    /PA_FINANCE_PROVIDER_TRANSPORT_FAILURE/);
  await assert.rejects(finance.inspect(order,KEY,NOW,async()=>({ok:false})),
    /PA_FINANCE_PROVIDER_HTTP_FAILURE/);
  await assert.rejects(finance.inspect(order,KEY,NOW,async()=>({ok:true,json:async()=>[]})),
    /PA_FINANCE_PROVIDER_INVALID_RESPONSE/);
  await assert.rejects(finance.inspect(order,KEY,NOW,
    fake({...paymentIntent,latest_charge:'ch_wrong_charge_id'}).fetchImpl),
    /PA_FINANCE_PROVIDER_TRANSPORT_FAILURE|PA_FINANCE_PAYMENT_INTENT_IDENTITY_INVALID/);

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-pa-finance-'));
  try{
    const ledgerPath=path.join(dir,'private-ledger.json');
    const anchorPath=path.join(dir,'private-anchor.json');
    const reportPath=path.join(dir,'reviewed-report.md');
    fs.writeFileSync(ledgerPath,JSON.stringify(quality.ledger),'utf8');
    fs.writeFileSync(anchorPath,JSON.stringify(anchor),'utf8');
    // A finance-key failure cannot produce an apparently deliverable report.
    await assert.rejects(workbench.run([
      'report',ledgerPath,anchorPath,SESSION,'-',reportPath
    ],NOW,{financialKey:'',fetchImpl:fake().fetchImpl}),
    /PA_FINANCE_RESTRICTED_READ_KEY_REQUIRED/);
    assert.equal(fs.existsSync(reportPath),false);
    const hold=await workbench.run([
      'report',ledgerPath,anchorPath,SESSION,'-',reportPath
    ],NOW,{financialKey:KEY,fetchImpl:fake(paymentIntent,
      {...charge,disputed:true}).fetchImpl});
    assert.equal(hold.status,'FINANCIAL_RECONCILIATION_HOLD');
    assert.equal(fs.existsSync(reportPath),false);
    const success=await workbench.run([
      'report',ledgerPath,anchorPath,SESSION,'-',reportPath
    ],NOW,{financialKey:KEY,fetchImpl:fake().fetchImpl});
    assert.equal(success.status,'PRIVATE_QC_REPORT_GENERATED');
    assert.equal(success.financialReadbackVerified,true);
    assert.equal(success.paymentSettlementGuaranteed,false);
    assert.equal(success.transportAllowed,false);
    assert.equal(success.externalSendCalls,0);
    assert(fs.readFileSync(reportPath,'utf8').includes('Not a government permit decision'));
    // A financial reversal or pre-QC case cannot create a new report, even
    // with forged CURRENT paid provider fixture responses.
    const beforeQcPath=path.join(dir,'pre-qc-report.md');
    fs.writeFileSync(ledgerPath,JSON.stringify(processed.ledger),'utf8');
    await assert.rejects(workbench.run([
      'report',ledgerPath,anchorPath,SESSION,'-',beforeQcPath
    ],NOW,{financialKey:KEY,fetchImpl:fake().fetchImpl}),
      /PA_REPORT_NOT_QC_READY/);
    assert.equal(fs.existsSync(beforeQcPath),false);
    const changed=core.seal({...quality.ledger,orders:{
      ...quality.ledger.orders,[SESSION]:{
        ...quality.ledger.orders[SESSION],phase:'DELIVERY_RECONCILIATION_HOLD'
      }
    }});
    fs.writeFileSync(ledgerPath,JSON.stringify(changed),'utf8');
    await assert.rejects(workbench.run([
      'report',ledgerPath,anchorPath,SESSION,'-',beforeQcPath
    ],NOW,{financialKey:KEY,fetchImpl:fake().fetchImpl}),
      /PA_REPORT_NOT_QC_READY/);
    assert.equal(fs.existsSync(beforeQcPath),false);

    // The real operator path must also bind report creation to an exact,
    // clean private main commit and current ledger fingerprint.
    const bare=path.join(dir,'origin-private.git');
    const privateRepo=path.join(dir,'owner-main');
    fs.mkdirSync(bare);
    fs.mkdirSync(privateRepo);
    function git(cwd,args){
      const x=cp.spawnSync('git',['-C',cwd,...args],{
        encoding:'utf8',timeout:20000,maxBuffer:256*1024
      });
      if(x.error||x.status!==0)throw Error('SYNTHETIC_GIT_FAILED');
      return x.stdout.trim();
    }
    git(dir,['init','--bare','-q',bare]);
    git(dir,['init','-q','-b','main',privateRepo]);
    const stateDir=path.join(privateRepo,'state');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(path.join(stateDir,'pa-permit-orders.json'),
      JSON.stringify(quality.ledger,null,2)+'\n','utf8');
    fs.writeFileSync(path.join(stateDir,'pa-permit-anchor.json'),
      JSON.stringify(anchor,null,2)+'\n','utf8');
    git(privateRepo,['add','--','state/pa-permit-orders.json',
      'state/pa-permit-anchor.json']);
    git(privateRepo,['-c','user.name=Fixture',
      '-c','user.email=fixture@example.org','commit','-q','-m','synthetic state']);
    git(privateRepo,['remote','add','origin',bare]);
    git(privateRepo,['push','-q','origin','main']);
    git(bare,['symbolic-ref','HEAD','refs/heads/main']);
    const gitBefore=git(privateRepo,['rev-parse','HEAD']);
    const guardedOut=path.join(dir,'guarded-report.md');
    const guarded=await transaction.apply({
      privateRoot:privateRepo,testOnlyRemote:bare,mode:'report',
      sessionId:SESSION,packetPath:guardedOut,
      expectedLedgerFingerprint:quality.ledger.ledgerFingerprint,
      testOnlyFinanceKey:KEY,testFinanceFetchImpl:fake().fetchImpl,now:NOW
    });
    assert.equal(guarded.status,'PRIVATE_QC_REPORT_GENERATED');
    assert.equal(guarded.published,false);
    assert.equal(guarded.financialReadbackVerified,true);
    assert.equal(guarded.actualFinancialSettlementGuaranteed,false);
    assert(fs.existsSync(guardedOut));
    assert.equal(guarded.privateStateRevision,quality.ledger.ledgerFingerprint);
    assert.equal(git(privateRepo,['status','--porcelain']),'');
    assert.equal(git(privateRepo,['rev-parse','HEAD']),gitBefore);
    assert.equal(git(bare,['rev-parse','refs/heads/main']),gitBefore);
    await assert.rejects(transaction.apply({
      privateRoot:privateRepo,testOnlyRemote:bare,mode:'report',
      sessionId:SESSION,packetPath:guardedOut,
      expectedLedgerFingerprint:quality.ledger.ledgerFingerprint,
      testOnlyFinanceKey:KEY,testFinanceFetchImpl:fake().fetchImpl,now:NOW
    }),/PA_PRIVATE_REPORT_OUTPUT_DIRECTORY_INVALID/);
    const financeHoldOut=path.join(dir,'finance-hold-report.md');
    const blocked=await transaction.apply({
      privateRoot:privateRepo,testOnlyRemote:bare,mode:'report',
      sessionId:SESSION,packetPath:financeHoldOut,
      expectedLedgerFingerprint:quality.ledger.ledgerFingerprint,
      testOnlyFinanceKey:KEY,testFinanceFetchImpl:fake(
        paymentIntent,{...charge,refunded:true}).fetchImpl,now:NOW
    });
    assert.equal(blocked.status,'FINANCIAL_RECONCILIATION_HOLD');
    assert.equal(fs.existsSync(financeHoldOut),false);
    assert.equal(git(privateRepo,['status','--porcelain']),'');
    assert.equal(git(privateRepo,['rev-parse','HEAD']),gitBefore);

  }finally{fs.rmSync(dir,{recursive:true,force:true})}
  console.log('PA financial clearance: 2 provider GETs, refund/dispute/amount/identity holds and report no-send gates passed.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
