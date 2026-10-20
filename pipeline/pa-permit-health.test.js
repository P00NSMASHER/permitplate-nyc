'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const core=require('./pa-permit-orders');
const health=require('./run-pa-permit-health');
const init='2026-10-10T12:00:00.000Z';
const scan='2026-10-10T13:00:00.000Z';
const now='2026-10-19T14:00:00.000Z';
const initial=core.empty(init),anchor=core.anchor(initial);
const empty=health.check(initial,anchor,'2026-10-10T13:00:00.000Z');
assert.equal(empty.state,'INTAKE_AND_QUEUE_HEALTHY');
assert.deepEqual(empty.incidents,[]);
assert.equal(empty.counts.paidOrders,0);
assert.equal(empty.customerDetailsLogged,false);
assert.equal(empty.externalSendCalls,0);
assert(!empty.automaticResendAllowed&&!empty.automaticRefundAllowed);
const stale=health.check(initial,anchor,'2026-10-11T12:00:00.000Z');
assert(stale.incidents.includes('PA_PROVIDER_POLL_STALE'));
function session(change={}){
  return {
    object:'checkout.session',id:'cs_live_health_fixture01',
    payment_intent:'pi_live_health_fixture01',
    payment_link:core.LINK,status:'complete',payment_status:'paid',
    mode:'payment',livemode:true,currency:'usd',subscription:null,
    created:Date.parse(init)/1000,amount_subtotal:2900,amount_total:2900,
    customer:'cus_health_fixture01',
    customer_details:{email:'private-fixture@example.org'},
    custom_fields:[
      {key:'municipality',type:'text',text:{value:'Pottsville, Schuylkill County'}},
      {key:'projectaddress',type:'text',text:{value:'200 Oak Street, Pottsville PA'}},
      {key:'projectscope',type:'text',text:{value:'Install new commercial kitchen ventilation'}}
    ],...change
  };
}
const lineItems={
  object:'list',has_more:false,
  data:[{quantity:1,amount_subtotal:2900,price:{
    id:core.PRICE,unit_amount:2900,currency:'usd',recurring:null
  }}]
};
const customer=session();
const first=core.evaluate({
  checkedAt:scan,complete:true,sessions:[customer],
  lineItemsBySession:{[customer.id]:lineItems},previousLedger:initial
});
assert.equal(first.status,'READY');
assert(core.validate(first.ledger).valid);
assert(core.verifyAnchor(first.ledger,anchor));
const current=core.seal({...first.ledger,checkedAt:now});
const late=health.check(current,anchor,now);
assert.equal(late.counts.paidOrders,1);
assert.equal(late.counts.undeliveredOverFiveDays,1);
assert(late.incidents.includes('PA_UNDELIVERED_ORDER_OVER_FIVE_DAYS'));
assert(!JSON.stringify(late).includes('private-fixture@example.org'));
const held=structuredClone(current.orders);
held[customer.id].phase='HOLD_PROJECT_DETAILS';
const heldLedger=core.seal({...current,orders:held});
const heldHealth=health.check(heldLedger,anchor,now);
assert(heldHealth.incidents.includes('PA_OPERATOR_HOLDS_OVER_24H'));
const pending=structuredClone(current.orders);
const order=pending[customer.id],fp='a'.repeat(64);
order.phase='PROVIDER_DELIVERY_PENDING';
order.research={fingerprint:fp};
order.quality={approvalAttested:true,researchFingerprint:fp};
order.delivery={
  messageId:'123e4567-e89b-12d3-a456-426614174000',
  recipient:order.email,sender:'PermitPlate <verified@example.org>',
  researchFingerprint:fp,reportFingerprint:'b'.repeat(64),
  verification:'PENDING_PROVIDER_READBACK',
  registeredAt:'2026-10-19T09:00:00.000Z'
};
const waiting=core.seal({...current,orders:pending});
assert(core.validate(waiting).valid);
const delayed=health.check(waiting,anchor,now);
assert(delayed.incidents.includes('PA_PROVIDER_RECEIPT_PENDING_OVER_TWO_HOURS'));
const changed=core.evaluate({
  checkedAt:'2026-10-19T14:30:00.000Z',complete:true,
  sessions:[session({payment_status:'unpaid'})],
  lineItemsBySession:{},previousLedger:current
});
assert.equal(changed.status,'READY');
const recon=health.check(changed.ledger,anchor,'2026-10-19T14:31:00.000Z');
assert(recon.incidents.includes('PA_PREVIOUSLY_PAID_CHECKOUT_REQUIRES_RECONCILIATION'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permitplate-pa-health-'));
try{
  const ledger=path.join(dir,'orders.json'),a=path.join(dir,'anchor.json');
  fs.writeFileSync(ledger,JSON.stringify(core.seal({...initial,
    checkedAt:new Date().toISOString()})),'utf8');
  fs.writeFileSync(a,JSON.stringify(anchor),'utf8');
  const stdout=execFileSync(process.execPath,
    ['pipeline/run-pa-permit-health.js',ledger,a],
    {cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  const safe=JSON.parse(stdout);
  assert.equal(safe.state,'INTAKE_AND_QUEUE_HEALTHY');
  assert.equal(safe.counts.paidOrders,0);
  fs.writeFileSync(ledger,JSON.stringify(waiting),'utf8');
  const failure=spawnSync(process.execPath,
    ['pipeline/run-pa-permit-health.js',ledger,a],
    {cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(failure.status,1);
  assert(failure.stdout.includes('PA_PROVIDER_RECEIPT_PENDING_OVER_TWO_HOURS'));
  assert(!failure.stdout.includes('private-fixture@example.org'));
  assert(!failure.stderr.includes('private-fixture@example.org'));
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('PA private health: stale, overdue, financial, operator and delivery-hold states fail closed with aggregate-only reporting.');
