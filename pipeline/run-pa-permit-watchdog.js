'use strict';
// Independent read-only PA intake watchdog. It intentionally does not call
// Stripe, alter any private file, issue refunds or send customer messages.
// Failures are generic, aggregate-only operational incident categories.
const fs=require('node:fs');
const core=require('./pa-permit-orders');
const health=require('./run-pa-permit-health');
const {privateMaterialPath}=require('./run-subscriber-intake');

const VERSION='PermitPlate-PA-independent-heartbeat-watch-v1.0.0';
const RECENT_MS=24*60*60*1000;
// A paid order still awaiting its *first* human research examination must
// surface an operator incident even when the private Stripe polling is green.
// Acknowledging a case by completing research clears this alert, never sends.
const NEEDS_FIRST_REVIEW=new Set([
  'RESEARCH_QUEUE','HOLD_PROJECT_DETAILS','HOLD_POSSIBLE_DUPLICATE'
]);
const PHASES=[
  'RESEARCH_QUEUE','HOLD_PROJECT_DETAILS','HOLD_POSSIBLE_DUPLICATE',
  'RESEARCH_SUBMITTED','QC_HOLD','READY_FOR_MANUAL_DELIVERY',
  'PROVIDER_DELIVERY_PENDING','DELIVERED_PROVIDER_VERIFIED',
  'DELIVERY_RECONCILIATION_HOLD'
];

function assess(input){
  const opts=input||{};
  const failures=[];
  if(opts.monitoringEnabled!==true){
    failures.push('PA_INTAKE_MONITORING_NOT_ENABLED');
  }
  const now=core.iso(opts.now);
  if(!now)failures.push('PA_WATCHDOG_TIME_INVALID');
  const ledger=opts.ledger,anchor=opts.anchor;
  if(!ledger||!anchor){
    failures.push('PA_PRIVATE_ORDER_PAIR_MISSING');
  }else{
    const checked=core.validate(ledger);
    if(!checked.valid||!core.verifyAnchor(ledger,anchor)){
      failures.push('PA_PRIVATE_ORDER_INTEGRITY_INVALID');
    }
  }
  const output={
    version:VERSION,
    state:'OPERATOR_ATTENTION_REQUIRED',
    incidents:[],
    checkedAt:now,
    lastProviderCheckAt:ledger&&core.iso(ledger.checkedAt)||null,
    ordersDiscoveredLast24h:0,
    paidOrdersAwaitingFirstReview:0,
    orderPhaseCounts:Object.fromEntries(PHASES.map(p=>[p,0])),
    paidOrdersTotal:0,
    health:null,
    customerIdentifyingFieldsEmitted:false,
    customerContactActions:0,
    paymentMutations:0,
    automaticResendAllowed:false,
    automaticRefundAllowed:false
  };
  if(failures.length){
    return {...output,incidents:[...new Set(failures)]};
  }
  if(now<ledger.checkedAt){
    return {...output,incidents:['PA_WATCHDOG_CLOCK_BEFORE_LAST_PROVIDER_READ']};
  }
  let detail;
  try{
    detail=health.check(ledger,anchor,now);
  }catch{
    return {...output,incidents:['PA_PRIVATE_HEALTH_CALCULATION_INVALID']};
  }
  const phaseCounts=output.orderPhaseCounts;
  let recent=0,needsReview=0;
  const threshold=Date.parse(now)-RECENT_MS;
  for(const order of Object.values(ledger.orders)){
    if(!Object.hasOwn(phaseCounts,order.phase)){
      return {...output,incidents:['PA_ORDER_PHASE_NOT_RECOGNIZED']};
    }
    phaseCounts[order.phase]++;
    if(NEEDS_FIRST_REVIEW.has(order.phase))needsReview++;
    const discovered=Date.parse(order.firstDiscoveredAt);
    if(Number.isFinite(discovered)&&
       discovered>=threshold&&discovered<=Date.parse(now))recent++;
  }
  const incidents=detail.incidents.slice();
  if(needsReview){
    incidents.push('PA_PAID_ORDER_AWAITING_FIRST_HUMAN_REVIEW');
  }
  return {
    ...output,
    state:incidents.length?'OPERATOR_ATTENTION_REQUIRED':'MONITORING_HEALTHY',
    incidents,
    ordersDiscoveredLast24h:recent,
    paidOrdersAwaitingFirstReview:needsReview,
    paidOrdersTotal:Object.keys(ledger.orders).length,
    health:{
      providerReadbackAgeMs:detail.lastProviderCheckAgeMs,
      heldCases:detail.counts.onHold,
      operatorHoldsOver24h:detail.counts.holdsOver24h,
      financialReconciliations:detail.counts.changedPaymentStatus,
      undeliveredCasesOver5Days:detail.counts.undeliveredOverFiveDays,
      deliveryReceiptsPendingOver2Hours:
        detail.counts.providerReceiptPendingOverTwoHours
    }
  };
}
function main(){
  if(process.argv.length!==4){
    throw Error('PA_WATCHDOG_PRIVATE_LEDGER_AND_ANCHOR_REQUIRED');
  }
  const lPath=privateMaterialPath(process.argv[2]);
  const aPath=privateMaterialPath(process.argv[3]);
  const ledger=JSON.parse(fs.readFileSync(lPath,'utf8'));
  const anchor=JSON.parse(fs.readFileSync(aPath,'utf8'));
  const result=assess({
    ledger,anchor,now:new Date().toISOString(),
    monitoringEnabled:process.env.PERMITPLATE_PA_ORDER_INTAKE_ENABLED==='true'
  });
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.incidents.length)process.exitCode=1;
}
if(require.main===module){
  try{main()}catch(error){
    const message=String(error.message||'');
    console.error(/^PA_[A-Z0-9_]+$/.test(message)?
      message:'PA_WATCHDOG_FAILED_CLOSED');
    process.exitCode=1;
  }
}
module.exports={VERSION,PHASES,RECENT_MS,NEEDS_FIRST_REVIEW,assess};
