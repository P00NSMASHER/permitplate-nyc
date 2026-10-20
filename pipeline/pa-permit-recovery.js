'use strict';
// Private read-only recovery diagnostics and human-attested hold resolution.
// Never modifies Stripe, sends messages, or erases a paid obligation.
const core=require('./pa-permit-orders');
const fulfil=require('./pa-permit-fulfillment');
const MAX_AGE_MS=9*60*60*1000;
function plan(ledger,anchor,now){
  fulfil.validState(ledger,anchor);
  const at=core.iso(now);
  if(!at||at<ledger.checkedAt)throw Error('PA_RECOVERY_CHECK_TIME_INVALID');
  const age=Date.parse(at)-Date.parse(ledger.checkedAt);
  const orders=Object.values(ledger.orders);
  const overdue=orders.filter(o=>o.phase!=='DELIVERED_PROVIDER_VERIFIED'&&
    (Date.parse(at)-Date.parse(o.paidAt))>5*24*60*60*1000);
  const pending=orders.filter(o=>o.phase==='PROVIDER_DELIVERY_PENDING'&&
    Date.parse(at)-Date.parse(o.delivery?.registeredAt||at)>2*60*60*1000);
  return {
    version:'PermitPlate-PA-recovery-plan-v1.0.0',
    providerReadbackAgeMs:age,providerReadbackStale:age>MAX_AGE_MS,
    totalPaidOrders:orders.length,
    held:orders.filter(o=>o.phase.includes('HOLD')).length,
    overdueReviewOrDelivery:overdue.length,
    providerDeliveryVerificationDelayed:pending.length,
    resolutionRequiresRealHumanEvidence:true,
    automaticResendAllowed:false,automaticRefundAllowed:false,
    externalSendCalls:0
  };
}
function resolveHold(input){
  const data=input||{},o=data.ledger?.orders?.[data.sessionId];
  if(!o||!['HOLD_PROJECT_DETAILS','HOLD_POSSIBLE_DUPLICATE'].includes(o.phase)){
    throw Error('PA_CASE_NOT_IN_RESOLVABLE_HOLD');
  }
  const v=data.evidence||{};
  if(!fulfil.text(v.operatorId,3,64)||!/^[A-Za-z0-9_-]+$/.test(v.operatorId||'')||
     !core.iso(v.reviewedAt)||
     v.reviewedAt<o.paidAt||
     !fulfil.text(v.supportEvidenceReference,12,250)||
     v.originalCustomerEvidenceInspected!==true||
     v.ownerAttestation!==true){
    return {status:'REVIEW',failures:['PA_HOLD_OWNER_AND_CUSTOMER_EVIDENCE_REQUIRED']};
  }
  // The original paid Checkout identity and project are never edited, so all
  // future Stripe rechecks still compare to the true original paid order.
  const project=v.projectOverride;
  if(o.phase==='HOLD_PROJECT_DETAILS'){
    if(!core.projectHealth(project))return {
      status:'REVIEW',failures:['PA_HOLD_CORRECTED_PROJECT_INVALID']};
  }else if(v.separatePurchaseConfirmedByCustomer!==true){
    return {status:'REVIEW',failures:['PA_DUPLICATE_PURCHASE_STILL_UNRESOLVED']};
  }
  const ledger=fulfil.mutate(data,data.sessionId,(draft,at)=>{
    draft.phase='RESEARCH_QUEUE';
    draft.projectValid=true;
    if(project)draft.projectOverride=project;
    draft.holdResolution={
      operatorId:v.operatorId,reviewedAt:v.reviewedAt,
      evidenceReferenceFingerprint:core.sha(v.supportEvidenceReference),
      attestationOnly:true,independentCustomerVerificationProven:false,
      recordedAt:at
    };
    draft.history.push({at,action:'PA_HOLD_RELEASED_TO_RESEARCH_ONLY'});
  });
  return {status:'RESEARCH_QUEUE_AFTER_MANUAL_ATTESTATION',
    ledger,independentCustomerVerificationProven:false,
    automaticDeliveryAllowed:false,externalSendCalls:0};
}
module.exports={MAX_AGE_MS,plan,resolveHold};
