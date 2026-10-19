'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const adapter=require('./curated-stripe-onboarding');
const polling=require('./stripe-readonly-checkout-poll');
const runner=require('./run-curated-stripe-onboarding');
const stripe=require('./stripe-subscriber');

const NOW='2026-10-19T14:00:00.000Z';
const AFTER='2026-10-20T14:00:00.000Z';
const SESSION='cs_live_permitplate_unit';
const SUB='sub_permitplate_unit';
function session(overrides={}){
  return {
    id:SESSION,object:'checkout.session',
    payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
    status:'complete',payment_status:'paid',mode:'subscription',
    customer:'cus_permitplate_unit',
    customer_details:{email:'internal-buyer@example.com'},
    metadata:{project:'permitplate_nyc'},
    subscription:SUB,
    custom_fields:[
      {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
      {key:'territory',type:'dropdown',dropdown:{value:'Brooklyn'}},
      {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
    ],...overrides
  };
}
function subscription(overrides={}){
  return {
    id:SUB,status:'active',customer:'cus_permitplate_unit',
    created:Date.parse(NOW)/1000,
    items:{data:[{price:{id:adapter.EXPECTED_PRICE_ID}}]},
    ...overrides
  };
}
const empty=adapter.processSnapshot({
  checkedAt:NOW,complete:true,
  sessions:Array.from({length:16},(_,i)=>session({
    id:'cs_expired_'+i,status:'expired',payment_status:'unpaid',subscription:null
  })),
  subscriptionById:{}
});
assert.equal(empty.status,'READY');
assert.equal(empty.created,0);
assert.equal(empty.accepted,0);
assert.equal(empty.skipped,16);
assert.equal(empty.totalSubscribers,0);
assert.equal(empty.externalSendCalls,0);
assert.equal(empty.paymentMutations,0);
assert(adapter.validate(empty.ledger).valid);
const initialAnchor=adapter.anchor(empty.ledger);
assert(adapter.verifyAnchor(empty.ledger,initialAnchor));
assert(!runner.checkPrior(empty.ledger,null).valid);
assert(!runner.checkPrior(null,initialAnchor).valid);
assert(runner.checkPrior(empty.ledger,initialAnchor).valid);

const first=adapter.processSnapshot({
  checkedAt:AFTER,complete:true,
  previousLedger:empty.ledger,
  sessions:[session()],
  subscriptionById:{[SUB]:subscription()}
});
assert.equal(first.status,'READY');
assert.equal(first.created,1);
assert.equal(first.accepted,1);
const saved=first.ledger.subscriptions[SUB];
assert.equal(saved.category,'Equipment');
assert.deepEqual(saved.boroughs,['Brooklyn']);
assert.equal(saved.starterSnapshotEnabled,true);
assert.equal(saved.firstBriefTargetDate,'2026-10-26');
assert.equal(saved.state,'PENDING_FOUNDER_REVIEW');
assert.equal(saved.transportAllowed,false);
assert.equal(saved.ownerAuthorizationGranted,false);
assert(saved.recipientEmail.includes('@'));
assert(adapter.verifyAnchor(first.ledger,initialAnchor));
assert.equal(adapter.firstBriefBusinessDate('2026-10-16T19:00:00.000Z'),'2026-10-23');
const repeated=adapter.processSnapshot({
  checkedAt:'2026-10-20T16:00:00Z',complete:true,
  previousLedger:first.ledger,
  sessions:[session()],
  subscriptionById:{[SUB]:subscription()}
});
assert.equal(repeated.status,'READY');
assert.equal(repeated.created,0);
assert.equal(repeated.totalSubscribers,1);
assert.equal(repeated.ledger.subscriptions[SUB].firstDiscoveredAt,AFTER);

const stopped=adapter.processSnapshot({
  checkedAt:'2026-10-20T17:00:00Z',complete:true,
  previousLedger:repeated.ledger,
  sessions:[session()],subscriptionById:{[SUB]:subscription({status:'canceled'})}
});
assert.equal(stopped.status,'READY');
assert.equal(stopped.held,1);
assert.equal(stopped.ledger.subscriptions[SUB].state,'HOLD_SUBSCRIPTION_CHANGED');
assert.equal(stopped.ledger.subscriptions[SUB].transportAllowed,false);
const resumed=adapter.processSnapshot({
  checkedAt:'2026-10-20T18:00:00Z',complete:true,
  previousLedger:stopped.ledger,
  sessions:[session()],subscriptionById:{[SUB]:subscription()}
});
assert.equal(resumed.ledger.subscriptions[SUB].state,'PENDING_FOUNDER_REVIEW');

const wrongPrice=adapter.processSnapshot({
  checkedAt:AFTER,complete:true,previousLedger:empty.ledger,
  sessions:[session()],subscriptionById:{[SUB]:subscription({
    items:{data:[{price:{id:'price_wrong'}}]}
  })}
});
assert.equal(wrongPrice.status,'REVIEW');
assert(wrongPrice.failures.includes('STRIPE_PAID_CUSTOMER_INTAKE_INVALID'));
const missing=adapter.processSnapshot({
  checkedAt:AFTER,complete:true,previousLedger:empty.ledger,
  sessions:[session()],subscriptionById:{}
});
assert.equal(missing.status,'REVIEW');
assert(missing.failures.includes('STRIPE_PAID_SESSION_SUBSCRIPTION_MISSING'));
assert.equal(adapter.processSnapshot({
  checkedAt:AFTER,complete:false,sessions:[],subscriptionById:{}
}).status,'REVIEW');
const drift=adapter.processSnapshot({
  checkedAt:'2026-10-20T19:00:00Z',complete:true,previousLedger:first.ledger,
  sessions:[session({custom_fields:[
    {key:'category',type:'dropdown',dropdown:{value:'insurance'}},
    {key:'territory',type:'dropdown',dropdown:{value:'Brooklyn'}},
    {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
  ]})],subscriptionById:{[SUB]:subscription()}
});
assert.equal(drift.status,'REVIEW');
assert(drift.failures.includes('STRIPE_SUBSCRIBER_IDENTITY_CHANGED'));
const modified=structuredClone(first.ledger);
modified.subscriptions[SUB].recipientEmail='somebodyelse@example.com';
assert(adapter.validate(modified).failures.includes('INTAKE_LEDGER_FINGERPRINT_INVALID'));
assert.equal(adapter.processSnapshot({
  checkedAt:NOW,complete:true,previousLedger:first.ledger,
  sessions:[],subscriptionById:{}
}).status,'REVIEW');
const noFunds=adapter.processSnapshot({
  checkedAt:AFTER,complete:true,previousLedger:empty.ledger,
  sessions:[session({payment_status:'no_payment_required'})],
  subscriptionById:{}
});
assert.equal(noFunds.status,'READY');
assert.equal(noFunds.accepted,0);
assert.equal(noFunds.held,1);

async function main(){
  const verifiedLink={
    object:'payment_link',id:stripe.PERMITPLATE_PAYMENT_LINK,
    livemode:true,active:true,
    metadata:{project:'permitplate_nyc',plan:'monthly_79'}
  };
  const fake=async(url,args)=>{
    assert.equal(args.method,'GET');
    assert.equal(args.redirect,'error');
    assert.equal(args.headers.Authorization,'Bearer rk_live_unitfixture');
    const u=new URL(url);
    if(u.pathname==='/v1/payment_links/'+stripe.PERMITPLATE_PAYMENT_LINK){
      return {ok:true,json:async()=>verifiedLink};
    }
    if(u.pathname==='/v1/checkout/sessions'){
      assert.equal(u.searchParams.get('payment_link'),stripe.PERMITPLATE_PAYMENT_LINK);
      return {ok:true,json:async()=>({data:[session()],has_more:false})};
    }
    if(u.pathname==='/v1/subscriptions/'+SUB)return {
      ok:true,json:async()=>subscription()
    };
    throw Error('UNEXPECTED_PROVIDER_REQUEST');
  };
  const snapshot=await polling.snapshot('rk_live_unitfixture',fake);
  assert.equal(snapshot.complete,true);
  assert.equal(snapshot.paidSessionCount,1);
  assert.equal(snapshot.sessions.length,1);
  assert.equal(snapshot.subscriptionById[SUB].status,'active');

  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-intake-'));
  try{
    const ledgerFile=path.join(tmp,'onboarding-ledger.json');
    const anchorFile=path.join(tmp,'onboarding-anchor.json');
    const result=await runner.run({
      ledgerPath:ledgerFile,anchorPath:anchorFile,
      now:NOW,key:'rk_live_unitfixture',fetchImpl:fake
    });
    assert(result.ready);
    assert.equal(result.newSubscriberCount,1);
    assert.equal(result.externalSendCalls,0);
    assert(fs.existsSync(ledgerFile));
    assert(fs.existsSync(anchorFile));
    const persisted=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
    assert.equal(Object.keys(persisted.subscriptions).length,1);
    const again=await runner.run({
      ledgerPath:ledgerFile,anchorPath:anchorFile,
      now:AFTER,key:'rk_live_unitfixture',fetchImpl:fake
    });
    assert.equal(again.newSubscriberCount,0);
    assert.equal(again.totalTrackedSubscribers,1);
    fs.unlinkSync(anchorFile);
    const blocked=await runner.run({
      ledgerPath:ledgerFile,anchorPath:anchorFile,
      now:'2026-10-21T00:00:00Z',key:'rk_live_unitfixture',fetchImpl:fake
    });
    assert.equal(blocked.ready,false);
    assert(blocked.failures.includes('STRIPE_INTAKE_STATE_PAIR_INCOMPLETE'));
  }finally{fs.rmSync(tmp,{recursive:true,force:true})}
  const noPaid=await polling.snapshot('rk_live_unitfixture',async url=>({
    ok:true,json:async()=>String(url).includes('/v1/payment_links/')?
      verifiedLink:{data:[],has_more:false}
  }));
  assert.equal(noPaid.sessions.length,0);
  await assert.rejects(polling.snapshot('rk_test_key',fake),/STRIPE_READ_CREDENTIAL_MISSING/);
  await assert.rejects(polling.snapshot('sk_live_overprivileged_key',fake),/STRIPE_READ_CREDENTIAL_MISSING/);
  await assert.rejects(polling.snapshot('rk_live_unitfixture',async url=>({
    ok:true,json:async()=>String(url).includes('/v1/payment_links/')?
      verifiedLink:{data:[],has_more:true}
  })),/STRIPE_PAGE_CURSOR_MISSING/);
  await assert.rejects(polling.snapshot('rk_live_unitfixture',async()=>({
    ok:true,json:async()=>({...verifiedLink,id:'plink_wrong'})
  })),/STRIPE_PAYMENT_LINK_ACCOUNT_NOT_VERIFIED/);
  await assert.rejects(polling.snapshot('rk_live_unitfixture',async()=>({
    ok:true,json:async()=>({...verifiedLink,active:false})
  })),/STRIPE_PAYMENT_LINK_ACCOUNT_NOT_VERIFIED/);
  await assert.rejects(polling.snapshot('rk_live_unitfixture',async()=>({
    ok:true,json:async()=>({data:[],has_more:false})
  })),/STRIPE_PAYMENT_LINK_ACCOUNT_NOT_VERIFIED/);
  console.log('Verified private Stripe onboarding, idempotency, billing holds and no-send.');
}
main().catch(err=>{console.error(err);process.exitCode=1});
