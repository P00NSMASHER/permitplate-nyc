'use strict';
// PA Permit Pack: provider-backed private order tracking. NEVER sends, charges or scores.
const crypto=require('node:crypto');
const jurisdiction=require('./pa-jurisdiction-identity');
const LINK='plink_1ULoeQDPW8riWrxQnDvhOlWS';
const PRICE='price_1ULoeQDPW8riWrxQYrINdZAv';
const VERSION='PermitPlate-PA-order-ledger-v1.0.0';
const ANCHOR_VERSION='PermitPlate-PA-order-anchor-v1.0.0';
const PHASES=Object.freeze(['RESEARCH_QUEUE','HOLD_PROJECT_DETAILS',
  'HOLD_POSSIBLE_DUPLICATE','RESEARCH_SUBMITTED','QC_HOLD',
  'READY_FOR_MANUAL_DELIVERY','PROVIDER_DELIVERY_PENDING',
  'DELIVERED_PROVIDER_VERIFIED','DELIVERY_RECONCILIATION_HOLD']);
function stable(v){
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort()
    .map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
const sha=value=>crypto.createHash('sha256').update(
  typeof value==='string'?value:stable(value)).digest('hex');
function iso(v){
  const s=String(v||'');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s))return null;
  const n=Date.parse(s);
  return Number.isFinite(n)&&new Date(n).toISOString()===
    (s.includes('.')?s:s.replace('Z','.000Z'))?new Date(n).toISOString():null;
}
const id=(s,prefix)=>typeof s==='string'&&
  new RegExp('^'+prefix+'_[A-Za-z0-9_]{6,170}$').test(s);
const email=s=>typeof s==='string'&&s.length<=254&&
  /^[A-Za-z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)&&
  !s.includes('..')&&!s.includes('\r')&&!s.includes('\n');
function seal(value){
  const {ledgerFingerprint,...body}=value;
  return {...body,ledgerFingerprint:sha(body)};
}
function empty(now){
  if(!iso(now))throw Error('PA_LEDGER_TIME_INVALID');
  return seal({version:VERSION,initializedAt:now,checkedAt:now,orders:{}});
}
function anchor(ledger){
  const core={version:ANCHOR_VERSION,initializedAt:ledger.initializedAt,
    baselineFingerprint:ledger.ledgerFingerprint};
  return {...core,anchorFingerprint:sha(core)};
}
function verifyAnchor(ledger,value){
  if(!ledger||!value||value.version!==ANCHOR_VERSION||
     value.initializedAt!==ledger.initializedAt||
     !/^[a-f0-9]{64}$/.test(value.baselineFingerprint||'')||
     value.baselineFingerprint!==empty(ledger.initializedAt).ledgerFingerprint)return false;
  const {anchorFingerprint,...core}=value;
  return anchorFingerprint===sha(core);
}
function validate(ledger){
  const failures=[];
  if(!ledger||ledger.version!==VERSION||
     !iso(ledger.initializedAt)||!iso(ledger.checkedAt)||
     Date.parse(ledger.initializedAt)>Date.parse(ledger.checkedAt)||
     !ledger.orders||Array.isArray(ledger.orders)||
     typeof ledger.orders!=='object')return {valid:false,failures:['PA_LEDGER_SHAPE_INVALID']};
  const {ledgerFingerprint,...body}=ledger;
  if(ledgerFingerprint!==sha(body))failures.push('PA_LEDGER_FINGERPRINT_INVALID');
  const intents=new Set();
  for(const [key,o] of Object.entries(ledger.orders)){
    if(!id(key,'cs')||!o||o.checkoutSessionId!==key||
       !id(o.paymentIntentId,'pi')||!email(o.email)||
       o.priceId!==PRICE||o.livemode!==true||o.currency!=='usd'||
       o.amountSubtotal!==2900||!Number.isInteger(o.amountTotal)||
       o.amountTotal<2900||o.amountTotal>4200||
       o.verifiedPayment!==true||
       !iso(o.paidAt)||!iso(o.firstDiscoveredAt)||
       !PHASES.includes(o.phase)||!(o.project===null||
         (typeof o.project==='object'&&!Array.isArray(o.project)))||
       !/^[a-f0-9]{64}$/.test(o.paymentFingerprint||'')||
       !/^[a-f0-9]{64}$/.test(o.projectFingerprint||'')||
       o.transportAllowed!==false||
       o.automaticDeliveryAllowed!==false||
       !Array.isArray(o.history)||o.history.length>50){
      failures.push('PA_ORDER_SHAPE_INVALID');continue;
    }
    // A reference-text check is not geocoding. Its recorded status is derived
    // solely from the immutable original customer-supplied municipality field.
    if(o.jurisdictionReferenceStatus!==undefined&&
       o.jurisdictionReferenceStatus!==
         jurisdiction.assess(o.project?.municipality).status){
      failures.push('PA_JURISDICTION_REFERENCE_STATUS_MISMATCH');
    }
    if(o.jurisdictionBoundaryIndependentlyVerified===true){
      failures.push('PA_AUTOMATED_GEOGRAPHIC_BOUNDARY_VERIFICATION_FORBIDDEN');
    }
    if(intents.has(o.paymentIntentId))failures.push('PA_DUPLICATE_PAYMENT_INTENT');
    intents.add(o.paymentIntentId);
    if(['RESEARCH_SUBMITTED','QC_HOLD','READY_FOR_MANUAL_DELIVERY',
        'PROVIDER_DELIVERY_PENDING','DELIVERED_PROVIDER_VERIFIED'].includes(o.phase)&&
       (!o.research||!/^[a-f0-9]{64}$/.test(o.research.fingerprint||''))){
      failures.push('PA_RESEARCH_STATE_INVALID');
    }
    if(['READY_FOR_MANUAL_DELIVERY','PROVIDER_DELIVERY_PENDING',
        'DELIVERED_PROVIDER_VERIFIED'].includes(o.phase)&&
       (o.quality?.approvalAttested!==true||
        o.quality?.researchFingerprint!==o.research?.fingerprint)){
      failures.push('PA_QUALITY_STATE_INVALID');
    }
    if(['PROVIDER_DELIVERY_PENDING','DELIVERED_PROVIDER_VERIFIED'].includes(o.phase)&&
       (!o.delivery||!/^[0-9a-fA-F-]{30,40}$/.test(o.delivery.messageId||'')||
        o.delivery.recipient!==o.email||
        typeof o.delivery.sender!=='string'||o.delivery.sender.length>160||
        o.delivery.researchFingerprint!==o.research?.fingerprint||
        !/^[a-f0-9]{64}$/.test(o.delivery.reportFingerprint||''))){
      failures.push('PA_DELIVERY_STATE_INVALID');
    }
    if(o.phase==='PROVIDER_DELIVERY_PENDING'&&
       o.delivery?.verification!=='PENDING_PROVIDER_READBACK'){
      failures.push('PA_DELIVERY_UNVERIFIED_STATE_INVALID');
    }
    if(o.phase==='DELIVERED_PROVIDER_VERIFIED'&&
       (o.delivery?.verification!=='PROVIDER_READBACK_VERIFIED'||
        !['delivered','opened','clicked'].includes(o.delivery?.providerLastEvent)||
        !iso(o.delivery?.providerReadbackAt)||
        !/^[a-f0-9]{64}$/.test(o.delivery?.providerReceiptFingerprint||''))){
      failures.push('PA_DELIVERY_PROOF_INVALID');
    }
  }
  return {valid:failures.length===0,failures:[...new Set(failures)]};
}
function field(session,key){
  const values=(session.custom_fields||[]).filter(f=>f&&f.key===key);
  if(values.length!==1||values[0].type!=='text')return null;
  return values[0].text?.value??null;
}
function safeText(value,max){
  if(typeof value!=='string'||value.length>max||
     /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))return null;
  const trimmed=value.trim().normalize('NFC');
  if(trimmed.length>max||/[<>]/.test(trimmed)||/https?:\/\//i.test(trimmed))return null;
  return trimmed;
}
function customerProject(session){
  if(!Array.isArray(session.custom_fields)||session.custom_fields.length!==3||
     new Set(session.custom_fields.map(f=>f.key)).size!==3)return null;
  const municipality=safeText(field(session,'municipality'),100);
  const projectAddress=safeText(field(session,'projectaddress'),200);
  const projectScope=safeText(field(session,'projectscope'),255);
  if(municipality===null||projectAddress===null||projectScope===null)return null;
  return {municipality,projectAddress,projectScope};
}
function projectHealth(p){
  if(!p||typeof p.municipality!=='string'||
     typeof p.projectAddress!=='string'||typeof p.projectScope!=='string')return false;
  if(p.municipality.length<2||p.projectAddress.length<5||
     p.projectScope.length<5||!/county|,\s*PA\b|philadelphia/i.test(p.municipality))return false;
  // A government project listing often names only a facility or county, not
  // an actual site. Those records are valuable research leads but cannot
  // be treated as valid customer-supplied project addresses. Hold for
  // clarification rather than inventing an address or permit jurisdiction.
  const address=p.projectAddress.trim();
  if(!/^[1-9][0-9]{0,6}[A-Za-z]?(?:-[0-9]{1,6})?\s+\S.{3,}$/.test(address)||
     /\b(?:TBD|TO BE DETERMINED|UNKNOWN|PLACEHOLDER)\b/i.test(address))return false;
  // A county/name/type contradiction in our bounded official source sample
  // is an operator clarification HOLD. Unknown statewide jurisdictions remain
  // unverified and still need genuine human source checks before delivery.
  if(jurisdiction.requiresClarification(p.municipality))return false;
  const combined=Object.values(p).join(' ');
  if(/(?:\b\d{3}[- ]?\d{2}[- ]?\d{4}\b)|(?:\b(?:\d[ -]?){15,19}\b)|(?:BEGIN PRIVATE KEY)|(?:\bpassword\s*:)/i.test(combined))return false;
  return true;
}
function verifiedLineItems(value){
  if(!value||value.object!=='list'||value.has_more!==false||
     !Array.isArray(value.data)||value.data.length!==1)return false;
  const row=value.data[0]||{},price=row.price||{};
  return row.quantity===1&&price.id===PRICE&&price.unit_amount===2900&&
    price.currency==='usd'&&!price.recurring&&
    (row.amount_subtotal===2900||row.amount_subtotal==null);
}
function immutablePayment(session,project){
  return {
    checkoutSessionId:session.id,paymentIntentId:session.payment_intent,
    priceId:PRICE,livemode:true,currency:'usd',
    amountSubtotal:session.amount_subtotal,amountTotal:session.amount_total,
    email:(session.customer_details?.email||'').trim().toLowerCase(),
    customerId:typeof session.customer==='string'?session.customer:null,
    project
  };
}
function evaluate(input){
  const data=input||{},now=iso(data.checkedAt);
  const failures=[];
  if(!now||data.complete!==true||!Array.isArray(data.sessions)||
     !data.lineItemsBySession||typeof data.lineItemsBySession!=='object'||
     Array.isArray(data.lineItemsBySession)){
    return {status:'REVIEW',failures:['PA_PROVIDER_SNAPSHOT_INCOMPLETE']};
  }
  const old=data.previousLedger||empty(now);
  const ok=validate(old);
  if(!ok.valid)failures.push(...ok.failures);
  if(Date.parse(now)<Date.parse(old.checkedAt))failures.push('PA_CHECKED_AT_NON_MONOTONIC');
  if(failures.length)return {status:'REVIEW',failures};
  const orders=structuredClone(old.orders);
  const sessionIds=new Set(),intentIds=new Set(
    Object.values(orders).map(o=>o.paymentIntentId));
  let paid=0,newOrders=0,held=0,unpaid=0;
  const sorted=data.sessions.slice().sort((a,b)=>
    Number(a?.created||0)-Number(b?.created||0)||
    String(a?.id||'').localeCompare(String(b?.id||'')));
  for(const session of sorted){
    if(!session||!id(session.id,'cs')||session.object!=='checkout.session'||
       session.payment_link!==LINK||session.status!=='complete'||
       session.livemode!==true||sessionIds.has(session.id)){
      failures.push('PA_PROVIDER_SESSION_IDENTITY_INVALID');continue;
    }
    sessionIds.add(session.id);
    if(!['paid','unpaid','no_payment_required'].includes(session.payment_status)){
      failures.push('PA_PROVIDER_PAYMENT_STATUS_INVALID');continue;
    }
    // Stripe Checkout's documented status values are exhaustive. A new or
    // malformed provider status is not equivalent to a verified unpaid order.
    if(!['paid','unpaid','no_payment_required'].includes(session.payment_status)){
      failures.push('PA_PROVIDER_PAYMENT_STATUS_INVALID');
      continue;
    }
    if(session.payment_status!=='paid'){
      unpaid++;
      // A previously paid Checkout no longer reported paid is an incident,
      // not permission to silently continue research or delivery.
      // Refunds/disputes may NOT change Checkout payment_status; these
      // still require separate authorized accounting reconciliation.
      const registered=orders[session.id];
      if(registered){
        if(registered.paymentIntentId!==session.payment_intent){
          failures.push('PA_PREVIOUS_PAID_PAYMENT_ID_CHANGED');continue;
        }
        if(registered.phase!=='DELIVERY_RECONCILIATION_HOLD'){
          registered.history.push({
            at:now,action:'PREVIOUSLY_PAID_CHECKOUT_NOW_UNPAID',
            precedingPhase:registered.phase
          });
          registered.phase='DELIVERY_RECONCILIATION_HOLD';
          if(registered.history.length>50){
            failures.push('PA_ORDER_HISTORY_LIMIT');
          }
        }
      }
      continue;
    }
    paid++;
    if(!id(session.payment_intent,'pi')||
       (intentIds.has(session.payment_intent)&&
        orders[session.id]?.paymentIntentId!==session.payment_intent)||
       session.mode!=='payment'||session.currency!=='usd'||
       session.amount_subtotal!==2900||
       !Number.isInteger(session.amount_total)||
       session.amount_total<2900||session.amount_total>4200||
       (session.subscription!==null&&session.subscription!==undefined)||
       !email(session.customer_details?.email)||!Number.isInteger(session.created)||
       session.created<=0||session.created*1000>Date.parse(now)||
       !verifiedLineItems(data.lineItemsBySession[session.id])){
      failures.push('PA_PAID_PROVIDER_CONTRACT_INVALID');continue;
    }
    intentIds.add(session.payment_intent);
    const project=customerProject(session);
    const identity=immutablePayment(session,project);
    const fp=sha(identity);
    if(orders[session.id]){
      if(orders[session.id].paymentFingerprint!==fp){
        failures.push('PA_EXISTING_PAID_ORDER_DRIFT');continue;
      }
      continue;
    }
    const projectFingerprint=sha({
      email:identity.email,project:project&&Object.fromEntries(
        Object.entries(project).map(([k,v])=>[k,v.toLowerCase().replace(/\s+/g,' ')]))
    });
    const duplicate=Object.values(orders).some(x=>x.projectFingerprint===projectFingerprint);
    const good=projectHealth(project);
    const phase=duplicate?'HOLD_POSSIBLE_DUPLICATE':
      good?'RESEARCH_QUEUE':'HOLD_PROJECT_DETAILS';
    if(phase!=='RESEARCH_QUEUE')held++;
    const paidAt=new Date(session.created*1000).toISOString();
    orders[session.id]={
      ...identity,verifiedPayment:true,paidAt,firstDiscoveredAt:now,
      jurisdictionReferenceStatus:jurisdiction.assess(project?.municipality).status,
      jurisdictionBoundaryIndependentlyVerified:false,
      paymentFingerprint:fp,projectFingerprint,
      phase,projectValid:good,
      research:null,quality:null,delivery:null,
      history:[{at:now,action:'PROVIDER_PAID_ORDER_REGISTERED',phase}],
      transportAllowed:false,automaticDeliveryAllowed:false
    };
    newOrders++;
  }
  for(const key of Object.keys(old.orders)){
    if(!sessionIds.has(key))failures.push('PA_PREVIOUS_ORDER_ABSENT_FROM_COMPLETE_PROVIDER_SCAN');
  }
  if(failures.length)return {status:'REVIEW',failures:[...new Set(failures)]};
  const ledger=seal({version:VERSION,initializedAt:old.initializedAt,
    checkedAt:now,orders});
  return {status:'READY',ledger,newOrders,paid,unpaid,
    totalOrders:Object.keys(orders).length,
    heldOrders:Object.values(orders).filter(o=>o.phase.startsWith('HOLD_')||
      o.phase.endsWith('_HOLD')).length,
    deliveriesVerified:Object.values(orders).filter(o=>o.phase==='DELIVERED_PROVIDER_VERIFIED').length,
    externalSendCalls:0,paymentMutations:0,scoringPromotionAllowed:false};
}
module.exports={LINK,PRICE,VERSION,ANCHOR_VERSION,PHASES,sha,stable,iso,id,email,
  seal,empty,anchor,verifyAnchor,validate,customerProject,projectHealth,
  verifiedLineItems,evaluate};
