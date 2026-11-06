'use strict';

const crypto=require('crypto');
const profiles=require('./subscriber-profile');

const STRIPE_SUBSCRIBER_ADAPTER_VERSION='PermitPlate-stripe-subscriber-v1.2.0';
const PERMITPLATE_PAYMENT_LINK='plink_1UG3RUDPW8riWrxQpZwHExK2';
// Canonical production paid-price contract for the known PermitPlate link.
// An omitted caller expectation must NEVER mean every recurring Price is valid.
const PERMITPLATE_PAID_PRICE='price_1UFjcWDPW8riWrxQhnrPX6nc';

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
function normalizeCheckoutTerritory(value){
  const raw=text(value);
  if(!raw) return null;
  const direct=profiles.canonicalBorough(raw);
  if(direct) return direct;
  const key=raw.toUpperCase().replace(/[^A-Z]/g,'');
  if(key==='ALLNYC') return 'ALL NYC';

  let remaining=key;
  const matched=[];
  for(const borough of profiles.BOROUGH_ORDER){
    const token=borough.toUpperCase().replace(/[^A-Z]/g,'');
    if(remaining.startsWith(token)){
      matched.push(borough);
      remaining=remaining.slice(token.length);
    }
  }
  return !remaining&&matched.length?matched.join(', '):null;
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
  // Stripe's subscription items are paginated. One visible matching price
  // cannot prove single-seat $79/month terms if there are unseen items or
  // more than one unit. Require a complete one-item provider snapshot.
  const list=subscription&&subscription.items;
  if(list?.object!=='list'||list.has_more!==false||
      !Array.isArray(list.data)||list.data.length!==1||
      list.data[0]?.quantity!==1)return null;
  return text(list.data[0]?.price?.id)||null;
}
// A paid status is not enough to prove this offer's $79 first payment:
// Stripe permits discounted or tax-adjusted invoices on the same recurring
// Price. Only a fully reconciled USD $79 base amount can create paid profiles.
function validPaidFirstCheckoutAmount(session){
  const s=session||{},total=s.amount_total,subtotal=s.amount_subtotal;
  const details=s.total_details;
  if(s.currency!=='usd'||!Number.isSafeInteger(total)||total<7900)return false;
  if(details==null)return total===7900&&
    (subtotal==null||subtotal===7900);
  return subtotal===7900&&Number.isSafeInteger(details.amount_tax)&&
    details.amount_tax>=0&&details.amount_discount===0&&
    details.amount_shipping===0&&total===subtotal+details.amount_tax;
}
function recipientEmail(session){
  return text(
    session&&session.customer_details&&session.customer_details.email ||
    session&&session.customer_email
  ).toLowerCase()||null;
}
function projectMarker(session,subscription){
  const sessionProject=text(session&&session.metadata&&session.metadata.project).toLowerCase();
  const subscriptionProject=text(subscription&&subscription.metadata&&subscription.metadata.project).toLowerCase();
  // A correctly marked Checkout Session must not mask a conflicting
  // Subscription marker from the same provider snapshot.
  if(sessionProject&&subscriptionProject&&sessionProject!==subscriptionProject) return '';
  return sessionProject||subscriptionProject;
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
  // Paid subscriber profiles must have a provider-confirmed paid Checkout.
  // A completed Checkout with 'no_payment_required' can represent a zero-cost
  // trial or discounted first invoice; supervised trials remain separate.
  if(text(session.payment_status)!=='paid'){
    failures.push('CHECKOUT_PAYMENT_NOT_CONFIRMED');
  }
  if(!validPaidFirstCheckoutAmount(session)){
    failures.push('CHECKOUT_FIRST_PAYMENT_AMOUNT_INVALID');
  }
  if(projectMarker(session,subscription)!=='permitplate_nyc') failures.push('PROJECT_MARKER_MISMATCH');

  // A completed Checkout Session must itself identify the Subscription.
  // Do not treat an unrelated supplied Subscription object as proof of linkage.
  const checkoutSubId=subscriptionId(session.subscription);
  const subId=checkoutSubId||subscriptionId(subscription);
  if(!checkoutSubId) failures.push('CHECKOUT_SUBSCRIPTION_ID_MISSING');
  if(!subId) failures.push('SUBSCRIPTION_ID_MISSING');
  if(!subscription||text(subscription.id)!==subId) failures.push('SUBSCRIPTION_OBJECT_REQUIRED');

  const baselineAt=subscription&&unixIso(subscription.created);
  if(!baselineAt) failures.push('SUBSCRIPTION_CREATED_MISSING');

  const status=text(subscription&&subscription.status).toLowerCase();
  // The $79 paid entitlement requires an active billing subscription.
  // A subscription still in Stripe trialing state belongs in review even
  // when its Checkout shows an initial paid amount; the supervised trial is
  // separate from this recurring paid enrollment path.
  if(status!=='active') failures.push('SUBSCRIPTION_STATUS_NOT_ELIGIBLE');
  // Stripe may keep status='active' while pause_collection stops invoice
  // collection. A past paid Checkout does not authorize new paid onboarding
  // during paused billing, regardless of preference source.
  if(subscription?.pause_collection!=null) failures.push('SUBSCRIPTION_COLLECTION_PAUSED');

  // Provider session and subscription must refer to the same paying customer.
  // A mismatch (or missing side) cannot authorize a paid onboarding profile.
  const sessionCustomer=customerId(session,null);
  const subscriptionCustomer=customerId(null,subscription);
  if(!sessionCustomer||!subscriptionCustomer){
    failures.push('STRIPE_CUSTOMER_ID_MISSING');
  }else if(sessionCustomer!==subscriptionCustomer){
    failures.push('STRIPE_CUSTOMER_ID_MISMATCH');
  }

  const email=recipientEmail(session);
  if(!email) failures.push('CHECKOUT_EMAIL_MISSING');
  const clientReferenceId=text(session.client_reference_id)||null;

  const actualPriceId=priceId(subscription);
  const expectedLink=text(data.expectedPaymentLink||PERMITPLATE_PAYMENT_LINK);
  const callerPriceId=text(data.expectedPriceId);
  // Pin the known production Payment Link to its exact advertised Price even
  // when a caller omits expectedPriceId. Test-only alternate links require
  // an explicit expected Price and their own trusted provider readback.
  const expectedPriceId=expectedLink===PERMITPLATE_PAYMENT_LINK?
    PERMITPLATE_PAID_PRICE:callerPriceId;
  if(!actualPriceId) failures.push('PRICE_ID_MISSING');
  if(!expectedPriceId) failures.push('PRICE_ID_EXPECTATION_MISSING');
  if((callerPriceId&&callerPriceId!==expectedPriceId)||
      (actualPriceId&&expectedPriceId&&actualPriceId!==expectedPriceId)){
    failures.push('PRICE_ID_MISMATCH');
  }

  if(failures.length){
    return reviewResult(session,subId,failures,{
      email:email||null,
      baselineAt:baselineAt||null,
      subscriptionStatus:status||null,
      priceId:actualPriceId||null,
      clientReferenceId
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
    clientReferenceId,
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
  // The advertised $79 paid plan allows up to ten signals per brief. The
  // external-receipt path must never grant the general profile's 25-signal
  // allowance; explicit over-limit values require founder review.
  const maxSignals=preferences.maxSignals==null?10:Number(preferences.maxSignals);
  if(!Number.isInteger(maxSignals)||maxSignals<1||maxSignals>10){
    return reviewResult({id:context.checkoutSessionId},context.subscriptionId,
      ['PAID_PLAN_MAX_SIGNALS_INVALID'],{
        preferenceSource:text(data.preferenceSource)||null,
        preferenceReceiptId:text(data.preferenceReceiptId)||null
      });
  }

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
    maxSignals,
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
  const territoryRaw=customFieldValue(session,'territory');
  const territory=normalizeCheckoutTerritory(territoryRaw);
  const starterRaw=customFieldValue(session,'starter');
  const failures=[];
  // The direct fulfillment adapter must enforce the same unique three-field
  // Checkout contract as the restricted TEST-only provider reader. Otherwise
  // taking the first duplicate can activate a contradictory paid preference.
  const required=['category','territory','starter'];
  const fields=Array.isArray(session.custom_fields)?session.custom_fields:[];
  if(fields.length!==required.length||!required.every(key=>
    fields.filter(field=>text(field?.key)===key&&field?.type==='dropdown').length===1
  )){
    failures.push('CHECKOUT_REQUIRED_DROPDOWNS_INVALID');
  }
  if(!category) failures.push('CATEGORY_CUSTOM_FIELD_MISSING');
  if(!territoryRaw) failures.push('TERRITORY_CUSTOM_FIELD_MISSING');
  else if(!territory) failures.push('TERRITORY_CUSTOM_FIELD_INVALID');
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
      // Public $79/month customer contract promises up to ten signals/brief.
      // A private Stripe handoff must not inherit the old 25-signal profile.
      maxSignals:10
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
  normalizeCheckoutTerritory,
  subscriptionId,
  customerId,
  priceId,
  validPaidFirstCheckoutAmount,
  recipientEmail,
  projectMarker,
  checkoutSubscriptionContext,
  profileFromPreferences,
  profileFromCheckout,
  profileFromCheckoutAndPreferences,
  toPrivateSheetRow
};
