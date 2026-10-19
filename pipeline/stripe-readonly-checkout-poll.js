'use strict';

// Stripe READS only; no Checkout creation, subscription mutation or provider send.
const LINK='plink_1UG3RUDPW8riWrxQpZwHExK2';
const ORIGIN='https://api.stripe.com';
const MAX_PAGES=20;
async function jsonGET(url,key,fetchImpl=fetch){
  if(!/^https:\/\/api\.stripe\.com\/v1\/(?:checkout\/sessions|subscriptions\/)/.test(url)){
    throw Error('STRIPE_ENDPOINT_NOT_ALLOWED');
  }
  if(!key||!/^(sk_|rk_)/.test(key))throw Error('STRIPE_READ_CREDENTIAL_MISSING');
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
async function snapshot(key,fetchImpl=fetch){
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
module.exports={LINK,ORIGIN,MAX_PAGES,jsonGET,snapshot};
