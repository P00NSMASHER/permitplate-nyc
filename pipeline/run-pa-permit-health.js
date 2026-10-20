'use strict';
// Aggregate-only health of a verified PRIVATE PA paid-order ledger.
// No customer names, case identifiers, project details or recipient emails.
const fs=require('node:fs');
const recovery=require('./pa-permit-recovery');
const {privateMaterialPath}=require('./run-subscriber-intake');
const VERSION='PermitPlate-PA-order-health-v1.0.0';
function check(ledger,anchor,now){
  const state=recovery.plan(ledger,anchor,now);
  const incidents=[];
  if(state.providerReadbackStale)incidents.push('PA_PROVIDER_POLL_STALE');
  if(state.paymentStatusReconciliationRequired){
    incidents.push('PA_PREVIOUSLY_PAID_CHECKOUT_REQUIRES_RECONCILIATION');
  }
  if(state.holdsAwaitingHumanReviewOver24h){
    incidents.push('PA_OPERATOR_HOLDS_OVER_24H');
  }
  if(state.overdueReviewOrDelivery){
    incidents.push('PA_UNDELIVERED_ORDER_OVER_FIVE_DAYS');
  }
  if(state.providerDeliveryVerificationDelayed){
    incidents.push('PA_PROVIDER_RECEIPT_PENDING_OVER_TWO_HOURS');
  }
  return {
    version:VERSION,
    state:incidents.length?'OPERATOR_ATTENTION_REQUIRED':'INTAKE_AND_QUEUE_HEALTHY',
    incidents,
    lastProviderCheckAt:ledger.checkedAt,
    lastProviderCheckAgeMs:state.providerReadbackAgeMs,
    counts:{
      paidOrders:state.totalPaidOrders,
      onHold:state.held,
      holdsOver24h:state.holdsAwaitingHumanReviewOver24h,
      changedPaymentStatus:state.paymentStatusReconciliationRequired,
      undeliveredOverFiveDays:state.overdueReviewOrDelivery,
      providerReceiptPendingOverTwoHours:state.providerDeliveryVerificationDelayed
    },
    customerDetailsLogged:false,
    providerPaymentMutations:0,
    automaticResendAllowed:false,
    automaticRefundAllowed:false,
    externalSendCalls:0
  };
}
function main(){
  if(process.argv.length!==4)throw Error('PA_ORDER_HEALTH_PRIVATE_LEDGER_AND_ANCHOR_REQUIRED');
  const ledgerPath=privateMaterialPath(process.argv[2]);
  const anchorPath=privateMaterialPath(process.argv[3]);
  const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
  const anchor=JSON.parse(fs.readFileSync(anchorPath,'utf8'));
  const result=check(ledger,anchor,new Date().toISOString());
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.incidents.length>0)process.exitCode=1;
}
if(require.main===module){
  try{main()}catch(error){
    const message=String(error.message||'');
    console.error(/^PA_[A-Z0-9_]+$/.test(message)?
      message:'PA_PRIVATE_ORDER_HEALTH_FAILED_CLOSED');
    process.exitCode=1;
  }
}
module.exports={VERSION,check};
