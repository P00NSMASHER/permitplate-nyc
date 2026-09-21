'use strict';

const crypto=require('crypto');
const delivery=require('./delivery-plan');
const {resolveDeliveryStateEvidence}=require('./delivery-state-evidence');

const PRIVATE_SHEET_MAPPING_VERSION='PermitPlate-private-sheet-mapping-v1.2.0';
const SUBSCRIBER_PROFILE_HEADERS=Object.freeze([
  'Email','Categories','Boroughs/Territory','Minimum Score','Updated At','Notes',
  'Baseline At','Starter Snapshot Sent At','Starter Snapshot Through','Delivery Policy Version',
  'Starter Snapshot Enabled','Starter Days','Starter Limit','Max Signals','Status',
  'Stripe Customer','Stripe Subscription','Price ID','Profile Fingerprint','Checkout Session',
  'Preference Receipt ID','Preference Source','Subscription Context Fingerprint',
  'Onboarding Match Fingerprint','Activation Fingerprint'
]);
const DELIVERY_STATE_HEADERS=Object.freeze([
  'Recipient Email','Lead Key','Delivered At','Stripe Customer','Stripe Subscription',
  'Gmail Message ID','Attempt ID','Delivery Status','Message Identity','Artifact Fingerprint',
  'Profile Fingerprint','Delivery Class','Provider Status','Last Reconciled At','Package ID',
  'Authorization ID','Provider Receipt Fingerprint','Provider Evidence Kind','Transport Started At'
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
function rowArray(headers,row){
  return headers.map((header)=>row[header]===undefined?null:row[header]);
}
function subscriberProfileAuthority(input){
  if(input&&input.status==='ACTIVE'&&input.subscriber&&
      input.subscriber.status==='ACTIVE'&&input.subscriber.profile){
    return {adapterResult:input.subscriber,activationResult:input};
  }
  if(input&&input.status==='ACTIVE'&&input.profile){
    return {adapterResult:input,activationResult:null};
  }
  throw new Error('ACTIVE subscriber activation or adapter result required');
}

function subscriberProfileRow(input){
  const authority=subscriberProfileAuthority(input);
  const adapterResult=authority.adapterResult;
  const activationResult=authority.activationResult;
  const p=adapterResult.profile;
  const allBoroughs=['Manhattan','Brooklyn','Queens','Bronx','Staten Island'];
  const territory=p.boroughs.length===allBoroughs.length &&
    allBoroughs.every((b)=>p.boroughs.includes(b))?
      'ALL NYC':p.boroughs.join('; ');

  const row={
    'Email':p.recipientEmail,
    'Categories':p.categories.join('; '),
    'Boroughs/Territory':territory,
    'Minimum Score':p.minimumScore,
    'Updated At':p.updatedAt,
    'Notes':'Stripe checkout profile; no automatic outreach.',
    'Baseline At':p.baselineAt,
    'Starter Snapshot Sent At':'',
    'Starter Snapshot Through':'',
    'Delivery Policy Version':delivery.DELIVERY_PLANNER_VERSION,
    'Starter Snapshot Enabled':p.starterSnapshotEnabled,
    'Starter Days':p.starterDays,
    'Starter Limit':p.starterLimit,
    'Max Signals':p.maxSignals,
    'Status':p.subscriptionStatus,
    'Stripe Customer':p.stripeCustomerId||'',
    'Stripe Subscription':p.stripeSubscriptionId||'',
    'Price ID':p.priceId||'',
    'Profile Fingerprint':adapterResult.profileFingerprint,
    'Checkout Session':adapterResult.checkoutSessionId,
    'Preference Receipt ID':adapterResult.preferenceReceiptId||'',
    'Preference Source':adapterResult.preferenceSource||'',
    'Subscription Context Fingerprint':
      adapterResult.subscriptionContextFingerprint||
      activationResult&&activationResult.stripeContextFingerprint||'',
    'Onboarding Match Fingerprint':
      activationResult&&activationResult.onboardingMatchFingerprint||'',
    'Activation Fingerprint':
      activationResult&&activationResult.activationFingerprint||''
  };
  return {
    mappingVersion:PRIVATE_SHEET_MAPPING_VERSION,
    sheet:'Subscriber Profiles',
    key:p.stripeSubscriptionId,
    row,
    values:rowArray(SUBSCRIBER_PROFILE_HEADERS,row),
    rowFingerprint:sha256(stableStringify(row))
  };
}

function packageBySignal(artifact){
  const map=new Map();
  for(const row of artifact&&artifact.csvRows||[]){
    const key=text(row['Signal Key']);
    if(!key) continue;
    map.set(key,{
      deliveryClass:text(row['Delivery Class']),
      packageId:text(row['Package ID'])
    });
  }
  return map;
}
function normalizeProviderStatus(value){
  const v=text(value).toUpperCase();
  return ['NOT_SENT','UNKNOWN','ACCEPTED','REJECTED','BOUNCED'].includes(v)?v:null;
}
function normalizeDeliveryStatus(value){
  const v=text(value).toUpperCase();
  return ['PLANNED','PENDING','FINALIZED','REJECTED','REVIEW'].includes(v)?v:null;
}
function deliveryStateRows(input){
  const data=input||{};
  const artifact=data.artifact;
  const attempt=data.attempt;
  const profile=data.profile&&data.profile.profile?data.profile.profile:data.profile;
  const profileFingerprint=data.profile&&data.profile.profileFingerprint?
    data.profile.profileFingerprint:data.profileFingerprint;

  if(!artifact||artifact.status!=='READY') throw new Error('READY subscriber artifact required');
  if(!attempt||attempt.state!=='PLANNED') throw new Error('PLANNED delivery attempt required');
  if(!profile||!profile.recipientEmail) throw new Error('subscriber profile required');
  if(text(attempt.recipient).toLowerCase()!==text(profile.recipientEmail).toLowerCase()){
    throw new Error('ATTEMPT_RECIPIENT_PROFILE_MISMATCH');
  }
  if(text(attempt.planFingerprint)!==text(artifact.artifactFingerprint)){
    throw new Error('ATTEMPT_ARTIFACT_FINGERPRINT_MISMATCH');
  }
  const artifactKeys=(artifact.signalKeys||[]).map(String);
  const attemptKeys=(attempt.signalKeys||[]).map(String);
  if(stableStringify(artifactKeys)!==stableStringify(attemptKeys)){
    throw new Error('ATTEMPT_SIGNAL_SET_MISMATCH');
  }

  const packageMap=packageBySignal(artifact);
  if(packageMap.size!==artifactKeys.length || artifactKeys.some(key=>!packageMap.has(key))){
    throw new Error('ARTIFACT_ROW_SIGNAL_SET_MISMATCH');
  }
  const evidence=resolveDeliveryStateEvidence(data);
  const {
    deliveryStatus,providerStatus,deliveredAt,providerMessageId,reconciledAt,
    authorizationId,transportStartedAt
  }=evidence;
  const providerReceiptFingerprint=evidence.receipt&&evidence.receipt.receiptFingerprint||'';
  const providerEvidenceKind=evidence.receipt&&evidence.receipt.evidenceKind||'';

  const rows=artifactKeys.map((signalKey)=>{
    const packageInfo=packageMap.get(signalKey);
    const row={
      'Recipient Email':profile.recipientEmail,
      'Lead Key':signalKey,
      // Legacy column name: this is provider acceptance time, not inbox proof.
      'Delivered At':deliveredAt,
      'Stripe Customer':profile.stripeCustomerId||'',
      'Stripe Subscription':profile.stripeSubscriptionId||profile.subscriberId||'',
      'Gmail Message ID':providerMessageId,
      'Attempt ID':attempt.attemptId,
      'Delivery Status':deliveryStatus,
      'Message Identity':attempt.messageIdentity,
      'Artifact Fingerprint':artifact.artifactFingerprint,
      'Profile Fingerprint':profileFingerprint||'',
      'Delivery Class':packageInfo.deliveryClass,
      'Provider Status':providerStatus,
      'Last Reconciled At':reconciledAt,
      'Package ID':packageInfo.packageId,
      'Authorization ID':authorizationId,
      'Provider Receipt Fingerprint':providerReceiptFingerprint,
      'Provider Evidence Kind':providerEvidenceKind,
      'Transport Started At':transportStartedAt||''
    };
    return {
      key:text(profile.recipientEmail).toLowerCase()+'|'+signalKey,
      row,
      values:rowArray(DELIVERY_STATE_HEADERS,row),
      rowFingerprint:sha256(stableStringify(row))
    };
  });

  return {
    mappingVersion:PRIVATE_SHEET_MAPPING_VERSION,
    sheet:'Delivery State',
    deliveryStatus,
    providerStatus,
    attemptId:attempt.attemptId,
    messageIdentity:attempt.messageIdentity,
    artifactFingerprint:artifact.artifactFingerprint,
    providerReceipt:evidence.receipt,
    retryAllowed:evidence.retryAllowed,
    deliveryConfirmed:evidence.deliveryConfirmed,
    rows,
    batchFingerprint:sha256(stableStringify(rows.map((item)=>item.row)))
  };
}

module.exports={
  PRIVATE_SHEET_MAPPING_VERSION,
  SUBSCRIBER_PROFILE_HEADERS,
  DELIVERY_STATE_HEADERS,
  stableStringify,
  sha256,
  text,
  rowArray,
  subscriberProfileAuthority,
  subscriberProfileRow,
  packageBySignal,
  normalizeProviderStatus,
  normalizeDeliveryStatus,
  deliveryStateRows
};
