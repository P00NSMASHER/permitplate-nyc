'use strict';

// Independent, read-only Stripe financial clearance before creating a
// delivery-ready PA report. NEVER creates, captures, refunds or sends.
// A Checkout Session marked "paid" is not proof against later refunds/disputes.
const orders=require('./pa-permit-orders');

const VERSION='PermitPlate-PA-financial-clearance-v1.0.0';
const ORIGIN='https://api.stripe.com';
const MAX_READBACK_SECONDS=15*60;
function allowUrl(url,kind,id){
  const u=new URL(url);
  return u.protocol==='https:'&&u.host==='api.stripe.com'&&
    u.pathname==='/v1/'+kind+'/'+encodeURIComponent(id)&&
    !u.search&&!u.hash&&!u.username&&!u.password;
}
async function read(url,key,fetchImpl=fetch){
  if(!/^rk_live_[A-Za-z0-9_]{8,200}$/.test(key||'')){
    throw Error('PA_FINANCE_RESTRICTED_READ_KEY_REQUIRED');
  }
  let result;
  try{
    result=await fetchImpl(url,{
      method:'GET',headers:{Authorization:'Bearer '+key},
      signal:AbortSignal.timeout(15000),redirect:'error'
    });
  }catch{throw Error('PA_FINANCE_PROVIDER_TRANSPORT_FAILURE')}
  if(!result||!result.ok)throw Error('PA_FINANCE_PROVIDER_HTTP_FAILURE');
  try{
    const body=await result.json();
    if(!body||typeof body!=='object'||Array.isArray(body)){
      throw Error('PA_FINANCE_PROVIDER_INVALID_RESPONSE');
    }
    return body;
  }catch{throw Error('PA_FINANCE_PROVIDER_INVALID_RESPONSE')}
}
function evaluate(order,intent,charge,observedAt){
  const now=orders.iso(observedAt),problems=[];
  if(!order||order.verifiedPayment!==true||
     !orders.id(order.paymentIntentId,'pi')||
     !/^[a-f0-9]{64}$/.test(order.paymentFingerprint||'')){
    return {status:'FINANCIAL_RECONCILIATION_HOLD',
      failures:['PA_PAID_ORDER_IDENTITY_INVALID']};
  }
  if(!now||now<order.paidAt)problems.push('PA_FINANCE_RECHECK_TIME_INVALID');
  const chargeId=typeof intent?.latest_charge==='string'?
    intent.latest_charge:intent?.latest_charge?.id;
  if(!intent||intent.object!=='payment_intent'||
     intent.id!==order.paymentIntentId||intent.livemode!==true||
     intent.status!=='succeeded'||intent.currency!=='usd'||
     intent.amount!==order.amountTotal||
     intent.amount_received!==order.amountTotal||
     !orders.id(chargeId,'ch')||
     (order.customerId&&intent.customer!==order.customerId)){
    problems.push('PA_PAYMENT_INTENT_NOT_CURRENT_AND_COLLECTED');
  }
  if(!charge||charge.object!=='charge'||charge.id!==chargeId||
     charge.payment_intent!==order.paymentIntentId||
     charge.livemode!==true||charge.status!=='succeeded'||
     charge.paid!==true||charge.captured!==true||
     charge.refunded!==false||charge.disputed!==false||
     charge.amount_refunded!==0||
     charge.currency!=='usd'||charge.amount!==order.amountTotal||
     (order.customerId&&charge.customer!==order.customerId)){
    problems.push('PA_CHARGE_REFUND_DISPUTE_OR_AMOUNT_HOLD');
  }
  const core={
    version:VERSION,
    status:problems.length?'FINANCIAL_RECONCILIATION_HOLD':'CURRENTLY_PAID_FOR_MANUAL_REPORT',
    failures:problems,
    checkedAt:now,
    checkoutSessionId:order.checkoutSessionId,
    orderPaymentFingerprint:order.paymentFingerprint,
    paymentIntentId:order.paymentIntentId,
    verifiedChargeId:problems.length?null:chargeId,
    noAutomaticDelivery:true,
    noPaymentMutations:true,
    actualSettlementOrFutureChargebackGuaranteed:false,
    customerIdentifyingFieldsLogged:false
  };
  return {...core,receiptFingerprint:orders.sha(core)};
}
async function inspect(order,key,now,fetchImpl=fetch){
  // Exactly two Stripe GETs, tied to the immutable original paid order.
  if(!order?.verifiedPayment||!orders.id(order.paymentIntentId,'pi')||
     !orders.iso(now)||now<order.paidAt){
    throw Error('PA_FINANCE_PRECHECK_FAILED');
  }
  const intentUrl=ORIGIN+'/v1/payment_intents/'+encodeURIComponent(order.paymentIntentId);
  if(!allowUrl(intentUrl,'payment_intents',order.paymentIntentId)){
    throw Error('PA_FINANCE_ENDPOINT_REJECTED');
  }
  const intent=await read(intentUrl,key,fetchImpl);
  const chargeId=typeof intent.latest_charge==='string'?
    intent.latest_charge:intent.latest_charge?.id;
  // Never use a payment-provided URL as the next endpoint.
  if(intent.id!==order.paymentIntentId||!orders.id(chargeId,'ch')){
    throw Error('PA_FINANCE_PAYMENT_INTENT_IDENTITY_INVALID');
  }
  const chargeUrl=ORIGIN+'/v1/charges/'+encodeURIComponent(chargeId);
  if(!allowUrl(chargeUrl,'charges',chargeId)){
    throw Error('PA_FINANCE_ENDPOINT_REJECTED');
  }
  const charge=await read(chargeUrl,key,fetchImpl);
  return evaluate(order,intent,charge,now);
}
module.exports={VERSION,MAX_READBACK_SECONDS,allowUrl,read,evaluate,inspect};
