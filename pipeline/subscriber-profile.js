'use strict';

const crypto=require('crypto');

const SUBSCRIBER_PROFILE_VERSION='PermitPlate-subscriber-profile-v1.0.0';
const CATEGORY_ORDER=Object.freeze([
  'POS','Insurance','Equipment','Hood/Fire','Waste','Pest','Linen','Distribution'
]);
const BOROUGH_ORDER=Object.freeze([
  'Manhattan','Brooklyn','Queens','Bronx','Staten Island'
]);

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
function parseList(value){
  if(Array.isArray(value)) return value.flatMap(parseList);
  return text(value).split(/[;,]/).map((item)=>item.trim()).filter(Boolean);
}
function canonicalCategory(value){
  const key=text(value).toUpperCase().replace(/[^A-Z]/g,'');
  const map={
    POS:'POS',
    POSPAYMENTS:'POS',
    PAYMENTS:'POS',
    INSURANCE:'Insurance',
    EQUIPMENT:'Equipment',
    RESTAURANTEQUIPMENT:'Equipment',
    HOODFIRE:'Hood/Fire',
    HOOD:'Hood/Fire',
    FIRESUPPRESSION:'Hood/Fire',
    WASTE:'Waste',
    PEST:'Pest',
    LINEN:'Linen',
    DISTRIBUTION:'Distribution',
    FOODDISTRIBUTION:'Distribution'
  };
  return map[key]||null;
}
function canonicalBorough(value){
  const key=text(value).toUpperCase().replace(/[^A-Z]/g,'');
  const map={
    MANHATTAN:'Manhattan',
    NEWYORK:'Manhattan',
    NEWYORKCOUNTY:'Manhattan',
    BROOKLYN:'Brooklyn',
    KINGS:'Brooklyn',
    KINGSCOUNTY:'Brooklyn',
    QUEENS:'Queens',
    QUEENSCOUNTY:'Queens',
    BRONX:'Bronx',
    BRONXCOUNTY:'Bronx',
    STATENISLAND:'Staten Island',
    RICHMOND:'Staten Island',
    RICHMONDCOUNTY:'Staten Island',
    ALLNYC:'ALL NYC',
    NYC:'ALL NYC',
    ALL:'ALL NYC'
  };
  return map[key]||null;
}
function validInstant(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function validEmail(value){
  const email=text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function uniqueOrdered(values,order){
  const set=new Set(values);
  return order.filter((value)=>set.has(value));
}
function normalizeProfile(input){
  const data=input||{};
  const failures=[];
  const subscriberId=text(data.subscriberId||data.stripeSubscriptionId||data.subscriptionId);
  if(!subscriberId) failures.push('SUBSCRIBER_ID_MISSING');

  const recipientEmail=validEmail(data.recipientEmail||data.email);
  if(!recipientEmail) failures.push('RECIPIENT_EMAIL_INVALID');

  const baselineAt=validInstant(data.baselineAt);
  if(!baselineAt) failures.push('BASELINE_INVALID');

  const requestedCategories=parseList(data.categories||data.category);
  const categories=uniqueOrdered(
    requestedCategories.map(canonicalCategory).filter(Boolean),
    CATEGORY_ORDER
  );
  if(!requestedCategories.length) failures.push('CATEGORY_REQUIRED');
  if(requestedCategories.length&&categories.length!==new Set(requestedCategories.map((v)=>text(v).toUpperCase())).size){
    const invalid=requestedCategories.filter((value)=>!canonicalCategory(value));
    if(invalid.length) failures.push('CATEGORY_INVALID:'+invalid.join('|'));
  }
  if(!categories.length) failures.push('NO_VALID_CATEGORY');

  const requestedBoroughs=parseList(data.boroughs||data.territory);
  let boroughs;
  if(!requestedBoroughs.length){
    boroughs=BOROUGH_ORDER.slice();
  }else{
    const normalized=requestedBoroughs.map(canonicalBorough);
    const invalid=requestedBoroughs.filter((_,index)=>!normalized[index]);
    if(invalid.length) failures.push('BOROUGH_INVALID:'+invalid.join('|'));
    boroughs=normalized.includes('ALL NYC')?
      BOROUGH_ORDER.slice():
      uniqueOrdered(normalized.filter((value)=>value&&value!=='ALL NYC'),BOROUGH_ORDER);
  }
  if(!boroughs.length) failures.push('NO_VALID_BOROUGH');

  const minRaw=data.minimumScore==null||data.minimumScore===''?60:Number(data.minimumScore);
  if(!Number.isInteger(minRaw)||minRaw<0||minRaw>100) failures.push('MINIMUM_SCORE_INVALID');
  const minimumScore=Number.isInteger(minRaw)&&minRaw>=0&&minRaw<=100?minRaw:null;

  const starterSnapshotEnabled=data.starterSnapshotEnabled===true ||
    String(data.starterSnapshotEnabled||'').toLowerCase()==='true';
  const starterDaysRaw=data.starterDays==null||data.starterDays===''?7:Number(data.starterDays);
  const starterLimitRaw=data.starterLimit==null||data.starterLimit===''?10:Number(data.starterLimit);
  const maxSignalsRaw=data.maxSignals==null||data.maxSignals===''?25:Number(data.maxSignals);
  if(!Number.isInteger(starterDaysRaw)||starterDaysRaw<0||starterDaysRaw>7){
    failures.push('STARTER_DAYS_INVALID');
  }
  if(!Number.isInteger(starterLimitRaw)||starterLimitRaw<0||starterLimitRaw>10){
    failures.push('STARTER_LIMIT_INVALID');
  }
  if(!Number.isInteger(maxSignalsRaw)||maxSignalsRaw<1||maxSignalsRaw>25){
    failures.push('MAX_SIGNALS_INVALID');
  }

  const subscriptionStatus=text(data.subscriptionStatus||data.status).toLowerCase();
  if(subscriptionStatus&&!['active','trialing','canary'].includes(subscriptionStatus)){
    failures.push('SUBSCRIPTION_STATUS_NOT_ELIGIBLE');
  }

  if(failures.length){
    return {
      profileVersion:SUBSCRIBER_PROFILE_VERSION,
      status:'REVIEW',
      failures,
      profile:null,
      profileFingerprint:sha256(stableStringify({
        version:SUBSCRIBER_PROFILE_VERSION,
        failures:failures.slice().sort()
      }))
    };
  }

  const profile={
    profileVersion:SUBSCRIBER_PROFILE_VERSION,
    subscriberId,
    recipientEmail,
    baselineAt,
    categories,
    boroughs,
    minimumScore,
    starterSnapshotEnabled,
    starterDays:starterDaysRaw,
    starterLimit:starterLimitRaw,
    maxSignals:maxSignalsRaw,
    subscriptionStatus:subscriptionStatus||'active',
    stripeCustomerId:text(data.stripeCustomerId)||null,
    stripeSubscriptionId:text(data.stripeSubscriptionId)||null,
    priceId:text(data.priceId)||null,
    updatedAt:validInstant(data.updatedAt)||baselineAt
  };
  const profileFingerprint=sha256(stableStringify(profile));
  return {
    profileVersion:SUBSCRIBER_PROFILE_VERSION,
    status:'ACTIVE',
    failures:[],
    profile,
    profileFingerprint
  };
}

function fromSheetRow(row){
  const r=row||{};
  return normalizeProfile({
    subscriberId:r['Stripe Subscription']||r.stripeSubscriptionId||r['Subscriber ID'],
    recipientEmail:r.Email||r.email,
    baselineAt:r['Baseline At']||r.baselineAt,
    categories:r.Categories||r.categories,
    boroughs:r['Boroughs/Territory']||r.boroughs,
    minimumScore:r['Minimum Score']??r.minimumScore,
    starterSnapshotEnabled:Boolean(r['Starter Snapshot Enabled']??r.starterSnapshotEnabled),
    starterDays:r['Starter Days']??r.starterDays,
    starterLimit:r['Starter Limit']??r.starterLimit,
    maxSignals:r['Max Signals']??r.maxSignals,
    subscriptionStatus:r.Status||r.status||'active',
    stripeCustomerId:r['Stripe Customer']||r.stripeCustomerId,
    stripeSubscriptionId:r['Stripe Subscription']||r.stripeSubscriptionId,
    priceId:r['Price ID']||r.priceId,
    updatedAt:r['Updated At']||r.updatedAt
  });
}

module.exports={
  SUBSCRIBER_PROFILE_VERSION,
  CATEGORY_ORDER,
  BOROUGH_ORDER,
  stableStringify,
  sha256,
  text,
  parseList,
  canonicalCategory,
  canonicalBorough,
  validInstant,
  validEmail,
  normalizeProfile,
  fromSheetRow
};
