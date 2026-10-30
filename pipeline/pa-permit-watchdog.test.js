'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cp=require('node:child_process');
const core=require('./pa-permit-orders');
const watchdog=require('./run-pa-permit-watchdog');

const INIT='2026-10-20T03:15:00.000Z';
const SCANNED='2026-10-20T04:05:00.000Z';
const NOW='2026-10-20T05:05:00.000Z';
const original=core.empty(INIT),anchor=core.anchor(original);
const healthy=core.seal({...original,checkedAt:SCANNED});
const check=(ledger=healthy,now=NOW,monitoringEnabled=true,anchorInput=anchor)=>
  watchdog.assess({ledger,anchor:anchorInput,now,monitoringEnabled});
let x=check();
assert.equal(x.state,'MONITORING_HEALTHY');
assert.deepEqual(x.incidents,[]);
assert.equal(x.paidOrdersTotal,0);
assert.equal(x.ordersDiscoveredLast24h,0);
assert.equal(x.health.providerReadbackAgeMs,60*60*1000);
assert.equal(x.customerContactActions,0);
assert.equal(x.paymentMutations,0);
assert.equal(x.customerIdentifyingFieldsEmitted,false);
assert.equal(x.automaticRefundAllowed,false);
assert.equal(x.automaticResendAllowed,false);

x=check(healthy,NOW,false);
assert.equal(x.state,'OPERATOR_ATTENTION_REQUIRED');
assert(x.incidents.includes('PA_INTAKE_MONITORING_NOT_ENABLED'));
assert.equal(x.health,null);
x=check(healthy,'bad-date');
assert(x.incidents.includes('PA_WATCHDOG_TIME_INVALID'));
x=check(healthy,'2026-10-20T04:00:00.000Z');
assert(x.incidents.includes('PA_WATCHDOG_CLOCK_BEFORE_LAST_PROVIDER_READ'));
x=check(healthy,'2026-10-20T13:05:00.001Z');
assert(x.incidents.includes('PA_PROVIDER_POLL_STALE'));
x=check(null,NOW);
assert(x.incidents.includes('PA_PRIVATE_ORDER_PAIR_MISSING'));
x=check(healthy,NOW,true,null);
assert(x.incidents.includes('PA_PRIVATE_ORDER_PAIR_MISSING'));
const tampered=structuredClone(healthy);
tampered.checkedAt='2026-10-19T23:00:00.000Z';
x=check(tampered);
assert(x.incidents.includes('PA_PRIVATE_ORDER_INTEGRITY_INVALID'));
const wrongAnchor=structuredClone(anchor);
wrongAnchor.anchorFingerprint='f'.repeat(64);
x=check(healthy,NOW,true,wrongAnchor);
assert(x.incidents.includes('PA_PRIVATE_ORDER_INTEGRITY_INVALID'));

const ID='cs_live_watchdog_fixture_01';
const session={
  object:'checkout.session',id:ID,
  payment_link:core.LINK,livemode:true,status:'complete',
  payment_status:'paid',mode:'payment',currency:'usd',subscription:null,
  amount_subtotal:2900,amount_total:2900,
  payment_intent:'pi_live_watchdog_fixture_01',
  created:Date.parse('2026-10-20T02:40:00.000Z')/1000,
  customer:'cus_live_watchdog_fixture_01',
  customer_details:{email:'synthetic-private@fixtures.example'},
  custom_fields:[
    {key:'municipality',type:'text',text:{value:'Pottsville, Schuylkill County'}},
    {key:'projectaddress',type:'text',text:{value:'71 Private Fixture Street, Pottsville PA'}},
    {key:'projectscope',type:'text',text:{value:'Synthetic kitchen renovation research for case gating'}}
  ]
};
const paid=core.evaluate({
  checkedAt:SCANNED,previousLedger:original,complete:true,
  sessions:[session],lineItemsBySession:{
    [ID]:{object:'list',has_more:false,data:[{
      quantity:1,amount_subtotal:2900,
      price:{id:core.PRICE,currency:'usd',unit_amount:2900,recurring:null}
    }]}
  }
});
assert.equal(paid.status,'READY');
x=check(paid.ledger);
assert.equal(x.paidOrdersTotal,1);
assert.equal(x.orderPhaseCounts.RESEARCH_QUEUE,1);
assert.equal(x.ordersDiscoveredLast24h,1);
assert(x.incidents.includes('PA_PAID_ORDER_AWAITING_FIRST_HUMAN_REVIEW'));
assert.equal(x.paidOrdersAwaitingFirstReview,1);
assert.equal(x.state,'OPERATOR_ATTENTION_REQUIRED');
const reviewed=structuredClone(paid.ledger);
reviewed.orders[ID].phase='RESEARCH_SUBMITTED';
reviewed.orders[ID].research={fingerprint:'a'.repeat(64)};
const reviewedValid=core.seal(reviewed);
assert(core.validate(reviewedValid).valid);
const acknowledged=check(reviewedValid);
assert.equal(acknowledged.state,'MONITORING_HEALTHY');
assert.equal(acknowledged.paidOrdersAwaitingFirstReview,0);
const past24h=core.seal({...paid.ledger,
  checkedAt:'2026-10-21T05:05:00.000Z'});
const stillPending=check(past24h,'2026-10-21T05:05:00.000Z');
assert.equal(stillPending.ordersDiscoveredLast24h,0);
assert.equal(stillPending.paidOrdersAwaitingFirstReview,1);
assert(stillPending.incidents.includes('PA_PAID_ORDER_AWAITING_FIRST_HUMAN_REVIEW'));
const output=JSON.stringify(x);
for(const secret of [session.customer_details.email,session.custom_fields[1].text.value,
  session.payment_intent,session.id]){
  assert(!output.includes(secret),'watchdog output cannot contain personal data');
}
const held=structuredClone(paid.ledger);
held.orders[ID].phase='HOLD_PROJECT_DETAILS';
held.checkedAt='2026-10-21T10:30:00.000Z';
const heldValid=core.seal(held);
x=check(heldValid,'2026-10-21T10:35:00.000Z');
assert(x.incidents.includes('PA_OPERATOR_HOLDS_OVER_24H'));
assert.equal(x.health.heldCases,1);
assert.equal(x.health.operatorHoldsOver24h,1);
const canceled=structuredClone(paid.ledger);
canceled.orders[ID].phase='DELIVERY_RECONCILIATION_HOLD';
canceled.checkedAt='2026-10-20T05:00:00.000Z';
x=check(core.seal(canceled));
assert(x.incidents.includes('PA_PREVIOUSLY_PAID_CHECKOUT_REQUIRES_RECONCILIATION'));
assert.equal(x.health.financialReconciliations,1);
const all=Object.values(x.orderPhaseCounts).reduce((a,b)=>a+b,0);
assert.equal(all,x.paidOrdersTotal);

// CLI: no private data may be copied into public Actions logs under any path.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pa-watchdog-fixture-'));
try{
  const aPath=path.join(dir,'anchor.json');
  const lPath=path.join(dir,'ledger.json');
  fs.writeFileSync(aPath,JSON.stringify(anchor),'utf8');
  const invoke=flag=>cp.spawnSync(process.execPath,[
    path.join(__dirname,'run-pa-permit-watchdog.js'),lPath,aPath
  ],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',
     env:{...process.env,PERMITPLATE_PA_ORDER_INTAKE_ENABLED:flag}});
  const present=core.seal({...original,checkedAt:new Date().toISOString()});
  fs.writeFileSync(lPath,JSON.stringify(present),'utf8');
  let result=invoke('true');
  assert.equal(result.status,0);
  assert.equal(JSON.parse(result.stdout).state,'MONITORING_HEALTHY');
  result=invoke('false');
  assert.equal(result.status,1);
  assert(result.stdout.includes('PA_INTAKE_MONITORING_NOT_ENABLED'));
  fs.writeFileSync(lPath,JSON.stringify(paid.ledger),'utf8');
  result=invoke('true');
  assert.equal(result.status,1);
  assert(result.stdout.includes('PA_PAID_ORDER_AWAITING_FIRST_HUMAN_REVIEW'));
  assert(!result.stdout.includes('synthetic-private@fixtures.example'));
  assert(!result.stdout.includes(session.id));
  const financialHold=structuredClone(paid.ledger);
  financialHold.orders[ID].phase='DELIVERY_RECONCILIATION_HOLD';
  fs.writeFileSync(lPath,JSON.stringify(core.seal(financialHold)),'utf8');
  result=invoke('true');
  assert.equal(result.status,1); // financial reconciliation required
  assert(result.stdout.includes('PA_PREVIOUSLY_PAID_CHECKOUT_REQUIRES_RECONCILIATION'));
  assert(!result.stdout.includes('synthetic-private@fixtures.example'));
  assert(!result.stderr.includes('synthetic-private@fixtures.example'));
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
console.log('Independent PA monitoring: live heartbeat, opt-in, privacy, stale state, bad anchor and operator holds are fail-closed.');
