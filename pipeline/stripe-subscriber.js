'use strict';

const crypto=require('crypto');
const profiles=require('./subscriber-profile');

const STRIPE_SUBSCRIBER_ADAPTER_VERSION='PermitPlate-stripe-subscriber-v1.1.0';
const PERMITPLATE_PAYMENT_LINK='plink_1UG3RUDPW8riWrxQpZwHExK2';

function stableStringify(value){
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  if(value&&typeof value==='object'){
    return '{'+Object.keys(value).sort()
      .map((key)=>JSON.stringify(key)+':'+stableStringify(value[key])).join(',')+'}';
  }
  return JSON.stringify(value);
}
function sha256(value){
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function text(value){
  return value==null?'':String(value).trim();
}
function unixIso(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0) return null;
  return new Date(n*1000).toISOString();
}
function customFieldValue(session,key){
  const field=(session&&session.custom_fields||[])
    .find((item)=>text(item&&item.key)===String(key));
  if(!field) return null;
  const type=text(field.type);
  if(type==='dropdown') return field.dropdown&&field.dropdown.value!=null?
    String(field.dropdown.value):null;
  if(type==='text') return field.text&&field.text.value!=null?
    String(field.text.value):null;
  if(type==='numeric') return field.numeric&&field.numeric.value!=null?
    String(field.numeric.value):null;
  return null;
}
function subscriptionId(value){
  if(!value) return null;
  if(typeof value==='string') return value;
  return text(value.id)||null;
}
function customerId(session,subscription){
  const fromSession=typeof (session&&session.customer)==='string'?
    session.customer:session&&session.customer&&session.customer.id;
  const fromSub=typeof (subscription&&subscription.customer)==='string'?
    subscription.customer:subscription&&subscription.customer&&subscription.customer.id;
  return text(fromSession||fromSub)||null;
}
function priceId(subscription){
  const items=subscription&&subscription.items&&subscription.items.data||[];
  if(items.length!==1) return null;
  return text(items[0]&&items[0].price&&items[0].price.id)||null;
}
function recipientEmail(session){
  return text(
    session&&session.customer_details&&session.customer_details.email ||
    session&&session.customer_email
  ).toLowerCase()||null;
}
function projectMarker(session,subscription){
  return text(
    session&&session.metadata&&session.metadata.project ||
    subscription&&subscription.metadata&&subscription.metadata.project
  ).toLowerCase();
}
function reviewResult(session,subId,failures,extra){
  const base={
    adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
    status:'REVIEW',
    failures,
    checkoutSessionId:text(session&&session.id)||null,
    subscriptionId:subId||null,
    profile:null,
    profileFingerprint:null
  };
  Object.assign(base,extra||{});
  base.adapterFingerprint=sha256(stableStringify({
    version:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
    checkoutSessionId:base.checkoutSessionId,
    subscriptionId:base.subscriptionId,
    failures:failures.slice().sort(),
    extra:extra||null
  }));
  return base;
}

function checkoutSubscriptionContext(input){
  const data=input||{};
  const session=data.session||{};
  const subscription=data.subscription||
    (session.subscription&&typeof session.subscription==='object'?session.subscription:null);
  const failures=[];

  if(session.object&&session.object!=='checkout.session') failures.push('CHECKOUT_OBJECT_INVALID');
  if(text(session.payment_link)!==text(data.expectedPaymentLink||PERMITPLATE_PAYMENT_LINK)){
    failures.push('PAYMENT_LINK_MISMATCH');
  }
  if(text(session.mode)!=='subscription') failures.push('CHECKOUT_MODE_NOT_SUBSCRIPTION');
  if(text(session.status)!=='complete') failures.push('CHECKOUT_NOT_COMPLETE');
  if(!['paid','no_payment_required'].includes(text(session.payment_status))){
    failures.push('CHECKOUT_PAYMENT_NOT_CONFIRMED');
  }
  if(projectMarker(session,subscription)!=='permitplate_nyc') failures.push('PROJECT_MARKER_MISMATCH');

  const subId=subscriptionId(session.subscription)||subscriptionId(subscription);
  if(!subId) failures.push('SUBSCRIPTION_ID_MISSING');
  if(!subscription||text(subscription.id)!==subId) failures.push('SUBSCRIPTION_OBJECT_REQUIRED');

  const baselineAt=subscription&&unixIso(subscription.created);
  if(!baselineAt) failures.push('SUBSCRIPTION_CREATED_MISSING');

  const status=text(subscription&&subscription.status).toLowerCase();
  if(!['active','trialing'].includes(status)) failures.push('SUBSCRIPTION_STATUS_NOT_ELIGIBLE');

  const email=recipientEmail(session);
  if(!email) failures.push('CHECKOUT_EMAIL_MISSING');

  const actualPriceId=priceId(subscription);
  const expectedPriceId=text(data.expectedPriceId);
  if(!actualPriceId) failures.push('PRICE_ID_MISSING');
  if(expectedPriceId&&actualPriceId&&actualPriceId!==expectedPriceId){
    failures.push('PRICE_ID_MISMATCH');
  }

  if(failures.length){
    return reviewResult(session,subId,failures,{
      email:email||null,
      baselineAt:baselineAt||null,
      subscriptionStatus:status||null,
      priceId:actualPriceId||null
    });
  }

  const result={
    adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
    status:'VALID_SUBSCRIPTION',
    failures:[],
    checkoutSessionId:text(session.id),
    subscriptionId:subId,
    customerId:customerId(session,subscription),
    email,
    baselineAt,
    subscriptionStatus:status,
    priceId:actualPriceId
  };
  result.contextFingerprint=sha256(stableStringify(result));
  return result;
}

function profileFromPreferences(input){
  const data=input||{};
  const context=data.context;
  const preferences=data.preferences||{};
  if(!context||context.status!=='VALID_SUBSCRIPTION'){
    return reviewResult(
      data.session||{},
      context&&context.subscriptionId||null,
      ['VALID_SUBSCRIPTION_CONTEXT_REQUIRED']
    );
  }

  const categories=preferences.categories||
    (preferences.category?[preferences.category]:[]);
  const boroughs=preferences.boroughs||preferences.territory||'ALL NYC';
  const starter=preferences.starterSnapshotEnabled===true;

  const normalized=profiles.normalizeProfile({
    subscriberId:context.subscriptionId,
    recipientEmail:context.email,
    baselineAt:context.baselineAt,
    categories,
    boroughs,
    minimumScore:preferences.minimumScore==null?60:preferences.minimumScore,
    starterSnapshotEnabled:starter,
    starterDays:preferences.starterDays==null?7:preferences.starterDays,
    starterLimit:preferences.starterLimit==null?10:preferences.starterLimit,
    maxSignals:preferences.maxSignals==null?25:preferences.maxSignals,
    subscriptionStatus:context.subscriptionStatus,
    stripeCustomerId:context.customerId,
    stripeSubscriptionId:context.subscriptionId,
    priceId:context.priceId,
    updatedAt:context.baselineAt
  });

  if(normalized.status!=='ACTIVE'){
    return reviewResult(
      {id:context.checkoutSessionId},
      context.subscriptionId,
      ['PROFILE_NORMALIZATION_FAILED',...(normalized.failures||[])],
      {
        preferenceSource:text(data.preferenceSource)||null,
        preferenceReceiptId:text(data.preferenceReceiptId)||null
      }
    );
  }

  const result={
    adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
    status:'ACTIVE',
    failures:[],
    checkoutSessionId:context.checkoutSessionId,
    subscriptionId:context.subscriptionId,
    customerId:context.customerId,
    subscriptionContextFingerprint:context.contextFingerprint,
    preferenceSource:text(data.preferenceSource)||null,
    preferenceReceiptId:text(data.preferenceReceiptId)||null,
    profile:normalized.profile,
    profileFingerprint:normalized.profileFingerprint
  };
  result.adapterFingerprint=sha256(stableStringify(result));
  return result;
}

function profileFromCheckout(input){
  const data=input||{};
  const context=checkoutSubscriptionContext(data);
  if(context.status!=='VALID_SUBSCRIPTION') return context;

  const session=data.session||{};
  const category=customFieldValue(session,'category');
  const territory=customFieldValue(session,'territory')||'ALL NYC';
  const starterRaw=customFieldValue(session,'starter');
  const failures=[];
  if(!category) failures.push('CATEGORY_CUSTOM_FIELD_MISSING');
  if(!['yes','no'].includes(text(starterRaw).toLowerCase())){
    failures.push('STARTER_CUSTOM_FIELD_MISSING');
  }
  if(failures.length){
    return reviewResult(session,context.subscriptionId,failures,{
      subscriptionContextFingerprint:context.contextFingerprint
    });
  }

  return profileFromPreferences({
    context,
    preferences:{
      category,
      territory,
      starterSnapshotEnabled:text(starterRaw).toLowerCase()==='yes',
      minimumScore:data.minimumScore==null?60:data.minimumScore,
      starterDays:7,
      starterLimit:10,
      maxSignals:25
    },
    preferenceSource:'STRIPE_CUSTOM_FIELDS',
    preferenceReceiptId:text(session.id)
  });
}

function profileFromCheckoutAndPreferences(input){
  const data=input||{};
  const context=checkoutSubscriptionContext(data);
  if(context.status!=='VALID_SUBSCRIPTION') return context;

  return profileFromPreferences({
    context,
    preferences:data.preferences||{},
    preferenceSource:data.preferenceSource||'EXTERNAL_PREFERENCE_RECEIPT',
    preferenceReceiptId:data.preferenceReceiptId||null
  });
}

function toPrivateSheetRow(adapterResult){
  if(!adapterResult||adapterResult.status!=='ACTIVE'||!adapterResult.profile){
    throw new Error('ACTIVE Stripe subscriber profile required');
  }
  const p=adapterResult.profile;
  return {
    Email:p.recipientEmail,
    Categories:p.categories.join('; '),
    'Boroughs/Territory':p.boroughs.length===profiles.BOROUGH_ORDER.length?
      'ALL NYC':p.boroughs.join('; '),
    'Minimum Score':p.minimumScore,
    'Baseline At':p.baselineAt,
    'Starter Snapshot Enabled':p.starterSnapshotEnabled,
    'Starter Days':p.starterDays,
    'Starter Limit':p.starterLimit,
    'Max Signals':p.maxSignals,
    Status:p.subscriptionStatus,
    'Stripe Customer':p.stripeCustomerId||'',
    'Stripe Subscription':p.stripeSubscriptionId||'',
    'Price ID':p.priceId||'',
    'Profile Fingerprint':adapterResult.profileFingerprint,
    'Checkout Session':adapterResult.checkoutSessionId,
    'Updated At':p.updatedAt
  };
}

module.exports={
  STRIPE_SUBSCRIBER_ADAPTER_VERSION,
  PERMITPLATE_PAYMENT_LINK,
  stableStringify,
  sha256,
  text,
  unixIso,
  customFieldValue,
  subscriptionId,
  customerId,
  priceId,
  recipientEmail,
  projectMarker,
  checkoutSubscriptionContext,
  profileFromPreferences,
  profileFromCheckout,
  profileFromCheckoutAndPreferences,
  toPrivateSheetRow
};
