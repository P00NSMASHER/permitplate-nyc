'use strict';

// Isolated Stripe TEST-mode, READ-only provider acceptance; never fulfills or
// changes any live/test Checkout, Subscription, Payment Link or customer state.
// IDs below refer ONLY to the pre-existing $79/month PermitPlate sandbox offer.
const stripe=require('./stripe-subscriber');
const {validRequiredDropdowns}=require('./stripe-readonly-checkout-poll');
const TEST_LINK='plink_1UFTnZDDtNqPPZGwpJrLo1CH';
const TEST_PRICE='price_1UFTnGDDtNqPPZGwtVLbMFGL';
const HOST='https://api.stripe.com';
const MAX_PAGES=3;

async function read(path,key,fetchImpl){
  if(!/^rk_test_[A-Za-z0-9_]+$/.test(String(key||''))){
    throw Error('SANDBOX_RESTRICTED_READ_KEY_REQUIRED');
  }
  if(!/^\/v1\/(?:payment_links\/plink_[A-Za-z0-9_]+(?:\/line_items)?|checkout\/sessions|subscriptions\/sub_[A-Za-z0-9_]+)(?:\?.*)?$/.test(path)){
    throw Error('SANDBOX_READ_ENDPOINT_NOT_ALLOWED');
  }
  let response;
  try{
    response=await fetchImpl(HOST+path,{
      method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+key},
      signal:AbortSignal.timeout(15000)
    });
  }catch(_){throw Error('SANDBOX_PROVIDER_TRANSPORT_FAILURE')}
  if(!response?.ok)throw Error('SANDBOX_PROVIDER_HTTP_FAILURE');
  let result;
  try{result=await response.json()}catch(_){throw Error('SANDBOX_PROVIDER_RESPONSE_INVALID')}
  if(!result||typeof result!=='object')throw Error('SANDBOX_PROVIDER_RESPONSE_INVALID');
  return result;
}
function priceValid(items){
  if(items?.object!=='list'||items.has_more!==false||
      !Array.isArray(items.data)||items.data.length!==1)return false;
  const x=items.data[0],p=x?.price||{},r=p.recurring||{};
  return x.quantity===1&&p.id===TEST_PRICE&&p.currency==='usd'&&
    p.unit_amount===7900&&r.interval==='month'&&r.interval_count===1&&
    r.usage_type==='licensed';
}
async function snapshot({key,fetchImpl=fetch}={}){
  // Fail closed before a single request if a live credential was passed.
  if(!/^rk_test_[A-Za-z0-9_]+$/.test(String(key||''))){
    throw Error('SANDBOX_RESTRICTED_READ_KEY_REQUIRED');
  }
  const fetchRead=(path)=>read(path,key,fetchImpl);
  const link=await fetchRead('/v1/payment_links/'+TEST_LINK);
  if(link?.object!=='payment_link'||link.id!==TEST_LINK||
      link.livemode!==false||link.active!==true||
      link.metadata?.project!=='permitplate_nyc'||
      link.metadata?.environment!=='test'||link.metadata?.plan!=='pilot_monthly'||
      !validRequiredDropdowns(link.custom_fields)){
    throw Error('SANDBOX_PAYMENT_LINK_CONTRACT_INVALID');
  }
  const items=await fetchRead('/v1/payment_links/'+TEST_LINK+'/line_items?limit=100');
  if(!priceValid(items))throw Error('SANDBOX_PRICE_CONTRACT_INVALID');

  const seenSessions=new Set(),seenSubscriptions=new Set();
  let cursor=null,complete=false,paid=0,held=0,eligible=0;
  for(let page=0;page<MAX_PAGES;page++){
    const query=new URLSearchParams({
      payment_link:TEST_LINK,status:'complete',limit:'100'
    });
    if(cursor)query.set('starting_after',cursor);
    const listing=await fetchRead('/v1/checkout/sessions?'+query.toString());
    if(!Array.isArray(listing.data)||listing.data.length>100||
        typeof listing.has_more!=='boolean'){
      throw Error('SANDBOX_PAGE_INVALID');
    }
    for(const session of listing.data){
      if(session?.object!=='checkout.session'||session.livemode!==false||
          !/^cs_test_[A-Za-z0-9_]+$/.test(String(session.id||''))||
          session.payment_link!==TEST_LINK||session.status!=='complete'||
          session.mode!=='subscription'||seenSessions.has(session.id)){
        throw Error('SANDBOX_CHECKOUT_IDENTITY_INVALID');
      }
      seenSessions.add(session.id);
      if(session.payment_status!=='paid'){held++;continue}
      paid++;
      const subId=typeof session.subscription==='string'?
        session.subscription:session.subscription?.id;
      if(!/^sub_[A-Za-z0-9_]+$/.test(String(subId||''))||
          seenSubscriptions.has(subId)){
        throw Error('SANDBOX_SUBSCRIPTION_LINK_INVALID');
      }
      seenSubscriptions.add(subId);
      const sub=await fetchRead('/v1/subscriptions/'+subId);
      if(sub?.id!==subId||sub.livemode!==false||
          typeof sub.status!=='string'||!Array.isArray(sub.items?.data)){
        throw Error('SANDBOX_SUBSCRIPTION_READBACK_INVALID');
      }
      // Cancellation, dispute or incomplete billing cannot be fulfillment.
      if(sub.status!=='active'){held++;continue}
      const profile=stripe.profileFromCheckout({
        session,subscription:sub,expectedPaymentLink:TEST_LINK,
        expectedPriceId:TEST_PRICE
      });
      if(profile.status!=='ACTIVE'||!profile.profile){
        throw Error('SANDBOX_PAID_PROFILE_REVIEW_REQUIRED');
      }
      eligible++;
    }
    if(listing.has_more===false){complete=true;break}
    if(listing.data.length===0)throw Error('SANDBOX_PAGE_CURSOR_MISSING');
    cursor=listing.data.at(-1).id;
  }
  if(!complete)throw Error('SANDBOX_PAGE_LIMIT_EXCEEDED');
  // Deliberately no full Session/Subscription objects, PII, persistence, send,
  // charge or customer-authority return values. This is diagnostic only.
  return {
    environment:'STRIPE_TEST_ONLY',readOnly:true,linkVerified:true,
    priceVerified:true,providerPagesComplete:true,
    completedSessionCount:seenSessions.size,paidSessionCount:paid,
    eligibleProfileCount:eligible,heldCount:held,
    noSend:true,externalSendCalls:0,paymentMutations:0,
    status:eligible?'PROFILE_SOURCE_ACCEPTED_NO_SEND':'NO_ELIGIBLE_HOSTED_TEST_CHECKOUT'
  };
}
module.exports={TEST_LINK,TEST_PRICE,MAX_PAGES,priceValid,read,snapshot};
