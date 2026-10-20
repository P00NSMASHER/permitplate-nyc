'use strict';

// Stripe READS only; no Checkout creation, subscription mutation or provider send.
const LINK='plink_1UG3RUDPW8riWrxQpZwHExK2';
const PRICE=require('./curated-stripe-onboarding').EXPECTED_PRICE_ID;
const {normalizeCheckoutTerritory}=require('./stripe-subscriber');
const {canonicalCategory}=require('./subscriber-profile');
const ORIGIN='https://api.stripe.com';
const MAX_PAGES=20;
async function jsonGET(url,key,fetchImpl=fetch){
  if(!/^https:\/\/api\.stripe\.com\/v1\/(?:checkout\/sessions|subscriptions\/|payment_links\/)/.test(url)){
    throw Error('STRIPE_ENDPOINT_NOT_ALLOWED');
  }
  if(!key||!/^rk_live_/.test(key))throw Error('STRIPE_READ_CREDENTIAL_MISSING');
  let response;
  try{
    response=await fetchImpl(url,{
      method:'GET',headers:{Authorization:'Bearer '+key},
      signal:AbortSignal.timeout(15000),redirect:'error'
    });
  }catch(error){throw Error('STRIPE_READ_TRANSPORT_FAILURE')}
  if(!response||!response.ok)throw Error('STRIPE_READ_HTTP_FAILURE');
  let data;
  try{data=await response.json()}catch(error){throw Error('STRIPE_READ_RESPONSE_INVALID')}
  if(!data||typeof data!=='object')throw Error('STRIPE_READ_RESPONSE_INVALID');
  return data;
}
function validRequiredDropdowns(fields){
  if(!Array.isArray(fields)||fields.length!==3)return false;
  const found=new Map();
  for(const field of fields){
    if(!field||!['category','territory','starter'].includes(field.key)||
       found.has(field.key)||field.type!=='dropdown'||field.optional!==false||
       !Array.isArray(field.dropdown?.options)||!field.dropdown.options.length){
      return false;
    }
    const options=field.dropdown.options.map(o=>o?.value);
    if(options.some(v=>typeof v!=='string'||!v.trim())||
       new Set(options).size!==options.length)return false;
    if(field.key==='category'&&options.some(v=>!canonicalCategory(v)))return false;
    if(field.key==='territory'&&options.some(v=>!normalizeCheckoutTerritory(v)))return false;
    if(field.key==='starter'&&
       (options.length!==2||!options.includes('yes')||!options.includes('no'))){
      return false;
    }
    const selected=field.dropdown.default_value;
    if(selected!=null&&!options.includes(selected))return false;
    found.set(field.key,true);
  }
  return found.size===3;
}
function validPriceContract(lineItems){
  if(!lineItems||lineItems.object!=='list'||lineItems.has_more!==false||
     !Array.isArray(lineItems.data)||lineItems.data.length!==1)return false;
  const item=lineItems.data[0]||{},price=item.price||{},recurring=price.recurring||{};
  return item.quantity===1&&price.id===PRICE&&price.currency==='usd'&&
    price.unit_amount===7900&&recurring.interval==='month'&&
    recurring.interval_count===1&&recurring.usage_type==='licensed';
}
async function attestPaymentLink(key,fetchImpl=fetch){
  const url=ORIGIN+'/v1/payment_links/'+encodeURIComponent(LINK);
  const record=await jsonGET(url,key,fetchImpl);
  // The connected Stripe merchant account is NOT inferred from an empty list.
  // A wrong account, test-mode key or inactive/mismatched product fails closed.
  if(record.object!=='payment_link'||record.id!==LINK||
     record.livemode!==true||record.active!==true||
     record.metadata?.project!=='permitplate_nyc'||
     record.metadata?.plan!=='monthly_79'){
    throw Error('STRIPE_PAYMENT_LINK_ACCOUNT_NOT_VERIFIED');
  }
  if(!validRequiredDropdowns(record.custom_fields)){
    throw Error('STRIPE_PAYMENT_LINK_CUSTOM_FIELDS_INVALID');
  }
  // Checkout fields alone are not enough: an old Payment Link can be edited
  // to charge an unexpected price while retaining unchanged metadata.
  const lineItems=await jsonGET(url+'/line_items?limit=100',key,fetchImpl);
  if(!validPriceContract(lineItems)){
    throw Error('STRIPE_PAYMENT_LINK_PRICE_CONTRACT_INVALID');
  }
  return {id:LINK,verified:true,preferencesVerified:true,
    recurringPriceVerified:true};
}
async function snapshot(key,fetchImpl=fetch){
  await attestPaymentLink(key,fetchImpl);
  const sessions=[],seen=new Set(),subscriptions={};
  let cursor=null,complete=false;
  for(let i=0;i<MAX_PAGES;i++){
    const u=new URL('/v1/checkout/sessions',ORIGIN);
    u.searchParams.set('payment_link',LINK);
    u.searchParams.set('status','complete');
    u.searchParams.set('limit','100');
    if(cursor)u.searchParams.set('starting_after',cursor);
    const page=await jsonGET(u.href,key,fetchImpl);
    if(!Array.isArray(page.data)||typeof page.has_more!=='boolean'||
       page.data.length>100)throw Error('STRIPE_PAGE_INCOMPLETE');
    for(const session of page.data){
      if(!session||!String(session.id||'').startsWith('cs_')||
         session.payment_link!==LINK||seen.has(session.id)){
        throw Error('STRIPE_PAGE_SESSION_INVALID');
      }
      seen.add(session.id);
      sessions.push(session);
    }
    if(page.has_more===false){complete=true;break;}
    if(!page.data.length)throw Error('STRIPE_PAGE_CURSOR_MISSING');
    cursor=page.data.at(-1).id;
  }
  if(!complete)throw Error('STRIPE_PAGE_LIMIT_EXCEEDED');
  const paid=sessions.filter(s=>s.status==='complete'&&s.payment_status==='paid');
  for(const session of paid){
    const id=typeof session.subscription==='string'?session.subscription:
      session.subscription?.id;
    if(!id||!/^sub_[A-Za-z0-9_]+$/.test(id)){
      throw Error('STRIPE_PAID_SUBSCRIPTION_REFERENCE_MISSING');
    }
    if(subscriptions[id])continue;
    const u=ORIGIN+'/v1/subscriptions/'+encodeURIComponent(id);
    const obj=await jsonGET(u,key,fetchImpl);
    if(obj.id!==id||!obj.status||!obj.items?.data){
      throw Error('STRIPE_SUBSCRIPTION_READBACK_INVALID');
    }
    subscriptions[id]=obj;
  }
  return {sessions,subscriptionById:subscriptions,complete:true,
    pageCount:Math.max(1,Math.ceil(sessions.length/100)),
    paidSessionCount:paid.length};
}
module.exports={LINK,PRICE,ORIGIN,MAX_PAGES,jsonGET,
  validRequiredDropdowns,validPriceContract,attestPaymentLink,snapshot};
