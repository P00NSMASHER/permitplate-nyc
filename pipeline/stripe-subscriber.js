'use strict';

const crypto=require('crypto');
const profiles=require('./subscriber-profile');

const STRIPE_SUBSCRIBER_ADAPTER_VERSION='PermitPlate-stripe-subscriber-v1.0.0';
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

function profileFromCheckout(input){
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

  const category=customFieldValue(session,'category');
  if(!category) failures.push('CATEGORY_CUSTOM_FIELD_MISSING');

  const territory=customFieldValue(session,'territory')||'ALL NYC';
  const starterRaw=customFieldValue(session,'starter');
  if(!['yes','no'].includes(text(starterRaw).toLowerCase())){
    failures.push('STARTER_CUSTOM_FIELD_MISSING');
  }

  if(failures.length){
    return {
      adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
      status:'REVIEW',
      failures,
      checkoutSessionId:text(session.id)||null,
      subscriptionId:subId,
      profile:null,
      profileFingerprint:null,
      adapterFingerprint:sha256(stableStringify({
        version:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
        checkoutSessionId:text(session.id)||null,
        subscriptionId:subId,
        failures:failures.slice().sort()
      }))
    };
  }

  const normalized=profiles.normalizeProfile({
    subscriberId:subId,
    recipientEmail:email,
    baselineAt,
    categories:[category],
    boroughs:territory,
    minimumScore:data.minimumScore==null?60:data.minimumScore,
    starterSnapshotEnabled:text(starterRaw).toLowerCase()==='yes',
    starterDays:7,
    starterLimit:10,
    maxSignals:25,
    subscriptionStatus:status,
    stripeCustomerId:customerId(session,subscription),
    stripeSubscriptionId:subId,
    priceId:priceId(subscription)||text(data.expectedPriceId)||null,
    updatedAt:baselineAt
  });

  if(normalized.status!=='ACTIVE'){
    return {
      adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
      status:'REVIEW',
      failures:['PROFILE_NORMALIZATION_FAILED',...(normalized.failures||[])],
      checkoutSessionId:text(session.id)||null,
      subscriptionId:subId,
      profile:null,
      profileFingerprint:normalized.profileFingerprint,
      adapterFingerprint:sha256(stableStringify({
        version:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
        checkoutSessionId:text(session.id)||null,
        subscriptionId:subId,
        failures:['PROFILE_NORMALIZATION_FAILED',...(normalized.failures||[])].sort()
      }))
    };
  }

  const result={
    adapterVersion:STRIPE_SUBSCRIBER_ADAPTER_VERSION,
    status:'ACTIVE',
    failures:[],
    checkoutSessionId:text(session.id),
    subscriptionId:subId,
    customerId:customerId(session,subscription),
    profile:normalized.profile,
    profileFingerprint:normalized.profileFingerprint
  };
  result.adapterFingerprint=sha256(stableStringify(result));
  return result;
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
  profileFromCheckout,
  toPrivateSheetRow
};
