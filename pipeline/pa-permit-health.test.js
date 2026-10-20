'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const core=require('./pa-permit-orders');
const recovery=require('./pa-permit-recovery');
const health=require('./run-pa-permit-health');
const init='2026-10-10T12:00:00.000Z';
const scan='2026-10-10T13:00:00.000Z';
const now='2026-10-19T14:00:00.000Z';
const zero=core.empty(init),anchor=core.anchor(zero);
const ok=health.check(zero,anchor,scan);
assert.equal(ok.state,'INTAKE_AND_QUEUE_HEALTHY');
assert.deepEqual(ok.incidents,[]);
assert.equal(ok.counts.paidOrders,0);
assert.equal(ok.customerDetailsLogged,false);
assert.equal(ok.externalSendCalls,0);
assert.equal(ok.automaticResendAllowed,false);
assert.equal(ok.automaticRefundAllowed,false);
assert(health.check(zero,anchor,'2026-10-11T12:00:00.000Z')
  .incidents.includes('PA_PROVIDER_POLL_STALE'));
function session(patch={}){
  return {
    object:'checkout.session',id:'cs_live_health_fixture01',
    payment_intent:'pi_live_health_fixture01',payment_link:core.LINK,
    status:'complete',payment_status:'paid',mode:'payment',livemode:true,
    currency:'usd',subscription:null,created:Date.parse(init)/1000,
    amount_subtotal:2900,amount_total:2900,customer:'cus_health_fixture01',
    customer_details:{email:'private-fixture@example.org'},
    custom_fields:[
      {key:'municipality',type:'text',text:{value:'Pottsville, Schuylkill County'}},
      {key:'projectaddress',type:'text',text:{value:'200 Oak Street, Pottsville PA'}},
      {key:'projectscope',type:'text',text:{value:'Install new commercial kitchen ventilation'}}
    ],...patch
  };
}
const items={
  object:'list',has_more:false,
  data:[{quantity:1,amount_subtotal:2900,
    price:{id:core.PRICE,unit_amount:2900,currency:'usd',recurring:null}}]
};
const paidSession=session();
const first=core.evaluate({
  checkedAt:scan,complete:true,sessions:[paidSession],
  lineItemsBySession:{[paidSession.id]:items},previousLedger:zero
});
assert.equal(first.status,'READY');
assert(core.validate(first.ledger).valid);
assert(core.verifyAnchor(first.ledger,anchor));
const current=core.seal({...first.ledger,checkedAt:now});
const overdue=health.check(current,anchor,now);
assert.equal(overdue.counts.paidOrders,1);
assert.equal(overdue.counts.undeliveredOverFiveDays,1);
assert(overdue.incidents.includes('PA_UNDELIVERED_ORDER_OVER_FIVE_DAYS'));
assert(!JSON.stringify(overdue).includes('private-fixture@example.org'));
const held=structuredClone(current.orders);
held[paidSession.id].phase='HOLD_PROJECT_DETAILS';
const oldHold=health.check(core.seal({...current,orders:held}),anchor,now);
assert(oldHold.incidents.includes('PA_OPERATOR_HOLDS_OVER_24H'));
const pending=structuredClone(current.orders);
const x=pending[paidSession.id],fingerprint='a'.repeat(64);
x.phase='PROVIDER_DELIVERY_PENDING';
x.research={fingerprint};
x.quality={approvalAttested:true,researchFingerprint:fingerprint};
x.delivery={
  messageId:'123e4567-e89b-12d3-a456-426614174000',
  recipient:x.email,sender:'PermitPlate <verified@example.org>',
  researchFingerprint:fingerprint,reportFingerprint:'b'.repeat(64),
  verification:'PENDING_PROVIDER_READBACK',
  registeredAt:'2026-10-19T09:00:00.000Z'
};
const waiting=core.seal({...current,orders:pending});
assert(core.validate(waiting).valid);
const late=health.check(waiting,anchor,now);
assert(late.incidents.includes('PA_PROVIDER_RECEIPT_PENDING_OVER_TWO_HOURS'));
const changed=core.evaluate({
  checkedAt:'2026-10-19T14:30:00.000Z',complete:true,
  sessions:[session({payment_status:'unpaid'})],
  lineItemsBySession:{},previousLedger:current
});
assert.equal(changed.status,'READY');
const hold=health.check(changed.ledger,anchor,'2026-10-19T14:31:00.000Z');
assert(hold.incidents.includes('PA_PREVIOUSLY_PAID_CHECKOUT_REQUIRES_RECONCILIATION'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-pa-health-'));
try{
  const ledgerFile=path.join(dir,'orders.json');
  const anchorFile=path.join(dir,'anchor.json');
  fs.writeFileSync(ledgerFile,JSON.stringify(core.seal({
    ...zero,checkedAt:new Date().toISOString()
  })),'utf8');
  fs.writeFileSync(anchorFile,JSON.stringify(anchor),'utf8');
  const pass=spawnSync(process.execPath,[
    'pipeline/run-pa-permit-health.js',ledgerFile,anchorFile
  ],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(pass.status,0);
  const passState=JSON.parse(pass.stdout);
  assert.equal(passState.state,'INTAKE_AND_QUEUE_HEALTHY');
  assert.equal(passState.counts.paidOrders,0);
  fs.writeFileSync(ledgerFile,JSON.stringify(waiting),'utf8');
  const fail=spawnSync(process.execPath,[
    'pipeline/run-pa-permit-health.js',ledgerFile,anchorFile
  ],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(fail.status,1);
  assert(fail.stdout.includes('PA_PROVIDER_RECEIPT_PENDING_OVER_TWO_HOURS'));
  assert(!fail.stdout.includes('private-fixture@example.org'));
  assert(!fail.stderr.includes('private-fixture@example.org'));
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('Private PA paid-order monitoring detects stale, overdue, hold and provider-readback incidents without PII or sends.');
