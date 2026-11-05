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
// A Checkout selection must be unique and come from this very Payment Link's
// verified required dropdown options, not just be a plausible product value.
// Any historical/current link mismatch is held for human review, not trusted.
function checkoutFieldsMatchLink(fields,configured){
  if(!Array.isArray(fields)||fields.length!==3||!Array.isArray(configured))return false;
  const offered=new Map(configured.map(field=>[
    field.key,new Set(field.dropdown.options.map(option=>option.value))
  ]));
  const seen=new Set();
  for(const field of fields){
    if(field?.type!=='dropdown'||!offered.has(field.key)||
        seen.has(field.key)||!offered.get(field.key).has(field.dropdown?.value)){
      return false;
    }
    seen.add(field.key);
  }
  return seen.size===3;
}
async function inspect({key,fetchImpl=fetch}={},privateMode=false){
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
  // Private associations exist only in the opt-in, in-memory TEST-only path.
  // Never log or publish them; they contain the synthetic or provider identity.
  const privateRecords=[];
  let cursor=null,complete=false,paid=0,held=0,eligible=0,paidHeld=0;
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
      // Stripe embeds a paginated subscription-item list. An incomplete page
      // can hide a second price, while changed quantity can break $79/seat
      // terms. Require one fully enumerated item at exactly one unit.
      const subItems=sub?.items;
      if(sub?.id!==subId||sub.livemode!==false||
          typeof sub.status!=='string'||subItems?.object!=='list'||
          subItems.has_more!==false||!Array.isArray(subItems.data)||
          subItems.data.length!==1||subItems.data[0]?.quantity!==1||
          subItems.data[0]?.price?.id!==TEST_PRICE){
        throw Error('SANDBOX_SUBSCRIPTION_READBACK_INVALID');
      }
      // Stripe pause_collection leaves status='active' while future invoices
      // are not collected. Do not mistake paused billing for an ongoing paid
      // subscription or expose its profile in the private NO_SEND handoff.
      if(sub.status!=='active'||sub.pause_collection!=null){
        held++;paidHeld++;continue
      }
      if(!checkoutFieldsMatchLink(session.custom_fields,link.custom_fields)){
        throw Error('SANDBOX_CHECKOUT_PREFERENCE_FIELDS_INVALID');
      }
      const profile=stripe.profileFromCheckout({
        session,subscription:sub,expectedPaymentLink:TEST_LINK,
        expectedPriceId:TEST_PRICE
      });
      if(profile.status!=='ACTIVE'||!profile.profile){
        throw Error('SANDBOX_PAID_PROFILE_REVIEW_REQUIRED');
      }
      eligible++;
      if(privateMode){
        const row=stripe.toPrivateSheetRow(profile);
        privateRecords.push({
          environment:'STRIPE_TEST_ONLY',
          checkoutSessionId:profile.checkoutSessionId,
          subscriptionId:profile.subscriptionId,
          idempotencyKey:stripe.sha256(stripe.stableStringify({
            checkoutSessionId:profile.checkoutSessionId,
            subscriptionId:profile.subscriptionId,
            profileFingerprint:profile.profileFingerprint
          })),
          privateSheetRow:row,
          state:'PENDING_FOUNDER_REVIEW',
          transportAllowed:false,ownerAuthorizationGranted:false
        });
      }
    }
    if(listing.has_more===false){complete=true;break}
    if(listing.data.length===0)throw Error('SANDBOX_PAGE_CURSOR_MISSING');
    cursor=listing.data.at(-1).id;
  }
  if(!complete)throw Error('SANDBOX_PAGE_LIMIT_EXCEEDED');
  // Deliberately no full Session/Subscription objects, PII, persistence, send,
  // charge or customer-authority return values. This is diagnostic only.
  const summary={
    environment:'STRIPE_TEST_ONLY',readOnly:true,linkVerified:true,
    priceVerified:true,providerPagesComplete:true,
    completedSessionCount:seenSessions.size,paidSessionCount:paid,
    eligibleProfileCount:eligible,heldCount:held,paidHeldCount:paidHeld,
    noSend:true,externalSendCalls:0,paymentMutations:0,
    // Even if another paid checkout qualifies, a paid-but-inactive subscription
    // must not be silently hidden behind an overall accepted receipt.
    status:paidHeld?'PAID_CHECKOUT_REVIEW_REQUIRED':
      held?'CHECKOUT_REVIEW_REQUIRED':
      eligible?'PROFILE_SOURCE_ACCEPTED_NO_SEND':'NO_ELIGIBLE_HOSTED_TEST_CHECKOUT'
  };
  if(!privateMode)return summary;
  // No partial private association when *any* completed checkout is on hold.
  // A zero-session read is NOT an end-to-end sandbox fulfillment receipt.
  const safe=paid>0&&eligible===paid&&held===0&&paidHeld===0;
  return {
    environment:'STRIPE_TEST_ONLY',readOnly:true,noSend:true,
    status:safe?'PRIVATE_ASSOCIATION_READY_NO_SEND':
      (held||paidHeld?'CHECKOUT_REVIEW_REQUIRED':'NO_COMPLETED_PAID_HOSTED_CHECKOUT'),
    summary,privateAssociations:safe?privateRecords:[],
    transportAllowed:false,ownerAuthorizationGranted:false,
    externalSendCalls:0,paymentMutations:0
  };
}
function snapshot(options){return inspect(options,false)}
// Private diagnostic only: returns source-bound in-memory handoffs, NO_SEND,
// with no disk, email, entitlement, Stripe writes or customer provisioning.
function privateNoSendHandoff(options){return inspect(options,true)}
module.exports={TEST_LINK,TEST_PRICE,MAX_PAGES,priceValid,read,snapshot,privateNoSendHandoff};
