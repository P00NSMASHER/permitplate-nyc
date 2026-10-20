'use strict';
// Stripe GET only. Every completed paid PA Checkout is independently verified
// against the exact live Payment Link, one-time price and session line items.
const core=require('./pa-permit-orders');
const ORIGIN='https://api.stripe.com';
const MAX_PAGES=20;
const CONFIG=Object.freeze({
  municipality:[2,100],projectaddress:[5,200],projectscope:[5,255]
});
async function get(url,key,fetchImpl=fetch){
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='api.stripe.com'||u.port||
     !/^\/v1\/(?:payment_links\/plink_[A-Za-z0-9_]+(?:\/line_items)?|checkout\/sessions(?:\/cs_[A-Za-z0-9_]+\/line_items)?)$/.test(u.pathname)){
    throw Error('PA_STRIPE_ENDPOINT_NOT_ALLOWED');
  }
  if(!/^rk_live_[A-Za-z0-9_]+$/.test(key||'')){
    throw Error('PA_STRIPE_RESTRICTED_LIVE_CREDENTIAL_REQUIRED');
  }
  let response;
  try{
    response=await fetchImpl(url,{
      method:'GET',headers:{Authorization:'Bearer '+key},
      signal:AbortSignal.timeout(15000),redirect:'error'
    });
  }catch(e){throw Error('PA_STRIPE_READ_TRANSPORT_FAILURE')}
  if(!response?.ok)throw Error('PA_STRIPE_READ_HTTP_FAILURE');
  let value;
  try{value=await response.json()}catch(e){throw Error('PA_STRIPE_READ_JSON_INVALID')}
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw Error('PA_STRIPE_READ_JSON_INVALID');
  }
  return value;
}
function linkFields(fields){
  if(!Array.isArray(fields)||fields.length!==3)return false;
  const seen=new Set();
  for(const f of fields){
    if(!f||!Object.hasOwn(CONFIG,f.key)||seen.has(f.key)||
       f.type!=='text'||f.optional!==false||
       f.text?.minimum_length!==CONFIG[f.key][0]||
       f.text?.maximum_length!==CONFIG[f.key][1])return false;
    seen.add(f.key);
  }
  return seen.size===3;
}
function priceItems(value){
  if(!value||value.object!=='list'||value.has_more!==false||
     !Array.isArray(value.data)||value.data.length!==1)return false;
  const item=value.data[0]||{},price=item.price||{};
  return item.quantity===1&&price.id===core.PRICE&&
    price.unit_amount===2900&&price.currency==='usd'&&!price.recurring;
}
async function verifyLink(key,fetchImpl=fetch){
  const base=ORIGIN+'/v1/payment_links/'+core.LINK;
  const link=await get(base,key,fetchImpl);
  if(link.object!=='payment_link'||link.id!==core.LINK||
     link.active!==true||link.livemode!==true||
     link.metadata?.project!=='permitplate_pa'||
     link.metadata?.offer!=='permit_pack_29'||
     link.metadata?.source!=='direct_payment_link'||!linkFields(link.custom_fields)){
    throw Error('PA_STRIPE_PAYMENT_LINK_CONTRACT_INVALID');
  }
  const items=await get(base+'/line_items?limit=100',key,fetchImpl);
  if(!priceItems(items))throw Error('PA_STRIPE_PAYMENT_LINK_PRICE_DRIFT');
  return {providerVerified:true,priceId:core.PRICE};
}
async function snapshot(key,fetchImpl=fetch){
  await verifyLink(key,fetchImpl);
  const sessions=[],lineItemsBySession={},seen=new Set();
  let cursor=null,complete=false;
  for(let page=0;page<MAX_PAGES;page++){
    const url=new URL('/v1/checkout/sessions',ORIGIN);
    url.searchParams.set('payment_link',core.LINK);
    url.searchParams.set('status','complete');
    url.searchParams.set('limit','100');
    if(cursor)url.searchParams.set('starting_after',cursor);
    const data=await get(url.href,key,fetchImpl);
    if(data.object!=='list'||!Array.isArray(data.data)||
       typeof data.has_more!=='boolean'||data.data.length>100){
      throw Error('PA_STRIPE_SESSIONS_PAGE_INVALID');
    }
    for(const session of data.data){
      if(!session||session.object!=='checkout.session'||
         !core.id(session.id,'cs')||
         session.payment_link!==core.LINK||
         seen.has(session.id)||session.status!=='complete'){
        throw Error('PA_STRIPE_PROVIDER_SESSION_INVALID');
      }
      seen.add(session.id);
      sessions.push(session);
    }
    if(!data.has_more){complete=true;break;}
    if(!data.data.length)throw Error('PA_STRIPE_SESSIONS_CURSOR_MISSING');
    cursor=data.data.at(-1).id;
  }
  if(!complete)throw Error('PA_STRIPE_SESSIONS_EXHAUSTIVENESS_UNVERIFIED');
  for(const session of sessions){
    if(session.payment_status!=='paid')continue;
    const url=ORIGIN+'/v1/checkout/sessions/'+encodeURIComponent(session.id)+'/line_items?limit=100';
    const items=await get(url,key,fetchImpl);
    if(!core.verifiedLineItems(items)){
      throw Error('PA_STRIPE_PAID_LINE_ITEM_INVALID');
    }
    lineItemsBySession[session.id]=items;
  }
  return {complete:true,providerVerified:true,sessions,lineItemsBySession,
    paidSessionCount:Object.keys(lineItemsBySession).length,rawPublicOutput:false};
}
module.exports={ORIGIN,MAX_PAGES,CONFIG,get,linkFields,priceItems,verifyLink,snapshot};
