'use strict';

// Operator-only private trial state. There is no billing or transport client.
// Fingerprints detect accidental drift; they do not authenticate JSON inputs.
const crypto=require('node:crypto');
const offer=require('./founder-curated-offer');
const profiles=require('./subscriber-profile');
const stripe=require('./stripe-subscriber');
const {instant}=require('./provider-reconciliation');
const {resolveDeliveryStateEvidence}=require('./delivery-state-evidence');
const {publicDomain}=require('../trial-request');
const VERSION='PermitPlate-free-trial-v1';
const MAX_TRIALS=10,MAX_SIGNALS=5,MAX_REPORTS=2;
const DAY_MS=86400000,DURATION_MS=14*DAY_MS;
const hash=value=>crypto.createHash('sha256').update(offer.stableStringify(value)).digest('hex');
const text=value=>typeof value==='string'?value.trim():'';
function required(test,message){if(!test)throw Error(message);}
function iso(value){const ms=instant(value);required(ms!==null,'TRIAL_TIME_INVALID');return new Date(ms).toISOString();}
function domain(value){
  try{return publicDomain(value);}catch{throw Error('TRIAL_BUSINESS_DOMAIN_INVALID');}
}
function nameKey(value){return text(value).toLowerCase().replace(/\s+/g,' ');}
function keys(object,expected,message){
  required(object&&typeof object==='object'&&!Array.isArray(object)&&
    Object.keys(object).sort().join('|')===expected.slice().sort().join('|'),message);
}
function seal(registry){
  const {registryFingerprint,...core}=registry;
  return {...core,registryFingerprint:hash(core)};
}
function createRegistry(environment='TEST'){
  required(['TEST','LIVE'].includes(environment),'TRIAL_ENVIRONMENT_INVALID');
  return seal({version:VERSION,environment,trials:[]});
}
function preparationFingerprint(prepared){
  const {trialPreparationFingerprint,...core}=prepared;
  return hash(core);
}
function validate(registry){
  keys(registry,['version','environment','trials','registryFingerprint'],'TRIAL_REGISTRY_SHAPE_INVALID');
  required(registry.version===VERSION&&['TEST','LIVE'].includes(registry.environment),
    'TRIAL_REGISTRY_VERSION_INVALID');
  required(Array.isArray(registry.trials)&&registry.trials.length<=MAX_TRIALS,'TRIAL_COHORT_LIMIT_EXCEEDED');
  required(seal(registry).registryFingerprint===registry.registryFingerprint,'TRIAL_REGISTRY_FINGERPRINT_INVALID');
  const ids=new Set(),domains=new Set(),names=new Set();
  for(const trial of registry.trials){
    keys(trial,['trialId','businessName','businessDomain','recipientEmail','preferences','requestedAt',
      'approvedAt','approvalReference','firstAcceptedAt','expiresAt','cancelledAt','deliveries'],
      'TRIAL_RECORD_SHAPE_INVALID');
    required(/^TRIAL:[a-f0-9]{24}$/.test(trial.trialId),'TRIAL_ID_INVALID');
    required(trial.businessDomain===domain(trial.businessDomain)&&text(trial.businessName).length>=2,
      'TRIAL_BUSINESS_IDENTITY_INVALID');
    required(!ids.has(trial.trialId)&&!domains.has(trial.businessDomain)&&!names.has(nameKey(trial.businessName)),
      'TRIAL_BUSINESS_ALREADY_ENROLLED');
    ids.add(trial.trialId);domains.add(trial.businessDomain);names.add(nameKey(trial.businessName));
    required(offer.validEmail(trial.recipientEmail)===trial.recipientEmail,'TRIAL_EMAIL_INVALID');
    keys(trial.preferences,['category','territory','starter'],'TRIAL_PREFERENCES_SHAPE_INVALID');
    required(offer.validatePreferences(trial.preferences).valid&&trial.preferences.starter==='yes',
      'TRIAL_PREFERENCES_INVALID');
    required(iso(trial.requestedAt)<=iso(trial.approvedAt)&&text(trial.approvalReference),
      'TRIAL_APPROVAL_INVALID');
    required(Array.isArray(trial.deliveries)&&trial.deliveries.length<=MAX_REPORTS,'TRIAL_REPORT_LIMIT_EXCEEDED');
    const seenKeys=new Set(),attempts=new Set();
    let previousAt=null;
    for(const receipt of trial.deliveries){
      keys(receipt,['attemptId','messageIdentity','artifactFingerprint','messageFingerprint','providerMessageId',
        'acceptedAt','signalKeys','authorizationId','providerReceiptFingerprint','verificationReference'],
        'TRIAL_DELIVERY_SHAPE_INVALID');
      for(const field of ['attemptId','messageIdentity','providerMessageId','authorizationId','verificationReference'])
        required(text(receipt[field]),'TRIAL_DELIVERY_BINDING_MISSING');
      for(const field of ['artifactFingerprint','messageFingerprint','providerReceiptFingerprint'])
        required(/^[a-f0-9]{64}$/.test(receipt[field]),'TRIAL_DELIVERY_FINGERPRINT_INVALID');
      required(!attempts.has(receipt.attemptId),'TRIAL_DUPLICATE_DELIVERY');attempts.add(receipt.attemptId);
      const at=iso(receipt.acceptedAt);
      required(at>=trial.approvedAt&&(!previousAt||Date.parse(at)-Date.parse(previousAt)>=7*DAY_MS),
        'TRIAL_DELIVERY_CHRONOLOGY_INVALID');
      previousAt=at;
      required(Array.isArray(receipt.signalKeys)&&receipt.signalKeys.length>0&&receipt.signalKeys.length<=MAX_SIGNALS,
        'TRIAL_DELIVERY_SIGNAL_LIMIT');
      for(const key of receipt.signalKeys){
        required(typeof key==='string'&&/^curated:(?:mat:)?[a-f0-9]{32}$/.test(key)&&!seenKeys.has(key),
          'TRIAL_DUPLICATE_OR_INVALID_SIGNAL');seenKeys.add(key);
      }
    }
    if(trial.deliveries.length){
      required(trial.firstAcceptedAt===trial.deliveries[0].acceptedAt&&
        Date.parse(iso(trial.expiresAt))===Date.parse(trial.firstAcceptedAt)+DURATION_MS,
        'TRIAL_CLOCK_INVALID');
      required(trial.deliveries.every(d=>d.acceptedAt<trial.expiresAt),'TRIAL_DELIVERY_AFTER_EXPIRY');
    }else required(trial.firstAcceptedAt===null&&trial.expiresAt===null,'TRIAL_CLOCK_WITHOUT_DELIVERY');
    if(trial.cancelledAt!==null)required(iso(trial.cancelledAt)>=trial.approvedAt,'TRIAL_CANCELLATION_INVALID');
  }
  return true;
}
function enroll(registry,request,approval){
  validate(registry);
  required(approval?.ownerApproved===true&&text(approval.reference),'TRIAL_OWNER_SCOPE_APPROVAL_REQUIRED');
  required(registry.trials.length<MAX_TRIALS,'TRIAL_COHORT_FULL');
  const businessDomain=domain(request?.businessDomain),businessName=text(request?.businessName);
  required(businessName.length>=2&&businessName.length<=160,'TRIAL_BUSINESS_NAME_INVALID');
  required(!registry.trials.some(t=>t.businessDomain===businessDomain||nameKey(t.businessName)===nameKey(businessName)),
    'TRIAL_BUSINESS_ALREADY_ENROLLED');
  const recipientEmail=offer.validEmail(request?.recipientEmail);
  required(recipientEmail,'TRIAL_EMAIL_INVALID');
  const preferences={category:text(request?.category),territory:text(request?.territory),starter:'yes'};
  required(offer.validatePreferences(preferences).valid,'TRIAL_PREFERENCES_INVALID');
  const requestedAt=iso(request?.requestedAt),approvedAt=iso(approval.approvedAt);
  required(requestedAt<=approvedAt,'TRIAL_APPROVAL_BEFORE_REQUEST');
  const trial={trialId:'TRIAL:'+hash({businessDomain,requestedAt}).slice(0,24),businessName,businessDomain,
    recipientEmail,preferences,requestedAt,approvedAt,approvalReference:text(approval.reference),
    firstAcceptedAt:null,expiresAt:null,cancelledAt:null,deliveries:[]};
  const updated=seal({...registry,trials:[...registry.trials,trial]});validate(updated);
  return {registry:updated,trialId:trial.trialId,status:'WAITING_FIRST_REPORT',paymentRequired:false};
}
function access(registry,trialId,now){
  validate(registry);const at=iso(now);
  const trial=registry.trials.find(t=>t.trialId===trialId);
  required(trial,'TRIAL_NOT_FOUND');
  required(at>=trial.approvedAt,'TRIAL_BEFORE_APPROVAL');
  required(trial.cancelledAt===null,'TRIAL_CANCELLED');
  required(!trial.expiresAt||at<trial.expiresAt,'TRIAL_EXPIRED');
  required(trial.deliveries.length<MAX_REPORTS,'TRIAL_REPORT_LIMIT_REACHED');
  required(!trial.firstAcceptedAt||Date.parse(at)>=Date.parse(trial.firstAcceptedAt)+7*DAY_MS,
    'TRIAL_WEEKLY_UPDATE_NOT_DUE');
  const normalized=profiles.normalizeProfile({
    subscriberId:trial.trialId,recipientEmail:trial.recipientEmail,baselineAt:trial.approvedAt,
    categories:profiles.canonicalCategory(trial.preferences.category),
    boroughs:stripe.normalizeCheckoutTerritory(trial.preferences.territory),
    starterSnapshotEnabled:true,starterLimit:MAX_SIGNALS,maxSignals:MAX_SIGNALS,
    subscriptionStatus:'trialing'
  });
  required(normalized.status==='ACTIVE','TRIAL_PROFILE_INVALID');
  return {...normalized,subscriptionId:trial.trialId,preferences:trial.preferences,
    deliveredSignalKeys:trial.deliveries.flatMap(d=>d.signalKeys),
    trialStatus:trial.firstAcceptedAt?'ACTIVE':'WAITING_FIRST_REPORT'};
}
function recordDelivery(registry,trialId,prepared,evidence,attestation){
  validate(registry);const trial=registry.trials.find(t=>t.trialId===trialId);
  required(trial,'TRIAL_NOT_FOUND');
  required(attestation?.operatorVerified===true&&text(attestation.reference)&&
    attestation.kind===(registry.environment==='TEST'?'TEST_FIXTURE':'AUTHENTICATED_PROVIDER_READBACK'),
    'TRIAL_PROVIDER_PROVENANCE_REQUIRED');
  required(prepared?.status==='READY_FOR_OWNER_REVIEW'&&prepared.signalCount>0&&prepared.signalCount<=MAX_SIGNALS,
    'TRIAL_NONEMPTY_REVIEWED_BRIEF_REQUIRED');
  required(prepared.trialPreparationFingerprint===preparationFingerprint(prepared),'TRIAL_PREPARATION_FINGERPRINT_INVALID');
  if(registry.environment==='LIVE')required(evidence?.providerObservation?.evidenceKind==='PROVIDER_READBACK',
    'TRIAL_LIVE_PROVIDER_READBACK_REQUIRED');
  required(prepared.trialId===trialId&&prepared.trialEnvironment===registry.environment&&
    prepared.brief?.subscriptionId===trialId&&prepared.brief.recipientEmail===trial.recipientEmail&&
    offer.stableStringify(prepared.brief.preferences)===offer.stableStringify(offer.validatePreferences(trial.preferences)),
    'TRIAL_BRIEF_IDENTITY_MISMATCH');
  const rebuilt=offer.buildCuratedBrief({subscriptionId:prepared.brief.subscriptionId,
    recipientEmail:prepared.brief.recipientEmail,preparedAt:prepared.brief.preparedAt,
    reviewer:prepared.brief.reviewer,ownerReviewed:true,preferences:trial.preferences,
    signals:prepared.brief.signals});
  required(rebuilt.status==='READY'&&rebuilt.artifactFingerprint===prepared.brief.artifactFingerprint&&
    rebuilt.messageFingerprint===prepared.brief.messageFingerprint&&rebuilt.signalCount===prepared.signalCount&&
    rebuilt.html===prepared.brief.html&&rebuilt.csv===prepared.brief.csv&&rebuilt.subject===prepared.brief.subject&&
    offer.stableStringify(rebuilt.signalKeys)===offer.stableStringify(prepared.brief.signalKeys),
    'TRIAL_BRIEF_FINGERPRINT_INVALID');
  const prior=trial.deliveries.find(d=>d.attemptId===prepared.attempt?.attemptId);
  if(!prior){
    required(prepared.trialRegistryFingerprint===registry.registryFingerprint,'TRIAL_REGISTRY_CHANGED_REPREPARE');
    access(registry,trialId,prepared.brief.preparedAt);
  }
  required(iso(evidence?.transportStartedAt)>=prepared.brief.preparedAt,'TRIAL_TRANSPORT_BEFORE_PREPARATION');
  const sourceAge=Date.parse(evidence.transportStartedAt)-Date.parse(iso(prepared.sourceObservedAt));
  required(sourceAge>=0&&sourceAge<=DAY_MS,'TRIAL_SOURCE_STALE_AT_SEND');
  const result=resolveDeliveryStateEvidence({
    ...evidence,attempt:prepared.attempt,
    artifact:{status:'READY',artifactFingerprint:rebuilt.artifactFingerprint,signalKeys:rebuilt.signalKeys},
    message:{status:'READY',messageFingerprint:rebuilt.messageFingerprint,signalKeys:rebuilt.signalKeys},
    deliveredSignalKeys:trial.deliveries.flatMap(d=>d.signalKeys)
  });
  if(prior){
    required(prior.artifactFingerprint===rebuilt.artifactFingerprint&&
      prior.messageFingerprint===rebuilt.messageFingerprint&&
      prior.providerMessageId===result.providerMessageId,'TRIAL_REPLAY_CONFLICT');
    if(result.providerStatus==='BOUNCED'){
      return {registry:cancel(registry,trialId,result.reconciledAt),trialId,
        status:'DELIVERY_HOLD',automaticBilling:false,inboxDeliveryConfirmed:false};
    }
    required(result.deliveryStatus==='FINALIZED'&&result.providerStatus==='ACCEPTED'&&
      prior.acceptedAt===result.deliveredAt,'TRIAL_REPLAY_CONFLICT');
    required(trial.cancelledAt===null,'TRIAL_CANCELLED');
    return {registry,trialId,status:'ALREADY_RECORDED',automaticBilling:false};
  }
  required(result.deliveryStatus==='FINALIZED'&&result.providerStatus==='ACCEPTED','TRIAL_PROVIDER_ACCEPTANCE_REQUIRED');
  required(Date.parse(result.deliveredAt)-Date.parse(prepared.sourceObservedAt)<=DAY_MS,
    'TRIAL_SOURCE_STALE_AT_ACCEPTANCE');
  access(registry,trialId,result.deliveredAt);
  const receipt={attemptId:prepared.attempt.attemptId,messageIdentity:prepared.attempt.messageIdentity,
    artifactFingerprint:rebuilt.artifactFingerprint,messageFingerprint:rebuilt.messageFingerprint,
    providerMessageId:result.providerMessageId,acceptedAt:result.deliveredAt,signalKeys:rebuilt.signalKeys,
    authorizationId:result.authorizationId,providerReceiptFingerprint:result.receipt.receiptFingerprint,
    verificationReference:text(attestation.reference)};
  const firstAcceptedAt=trial.firstAcceptedAt||receipt.acceptedAt;
  const updatedTrial={...trial,firstAcceptedAt,expiresAt:new Date(Date.parse(firstAcceptedAt)+DURATION_MS).toISOString(),
    deliveries:[...trial.deliveries,receipt]};
  const updated=seal({...registry,trials:registry.trials.map(t=>t.trialId===trialId?updatedTrial:t)});
  validate(updated);
  return {registry:updated,trialId,status:'ACTIVE',firstAcceptedAt,expiresAt:updatedTrial.expiresAt,
    activationEvidence:'PROVIDER_ACCEPTED_SEND',inboxDeliveryConfirmed:false,automaticBilling:false};
}
function cancel(registry,trialId,now){
  validate(registry);const at=iso(now);
  const trial=registry.trials.find(t=>t.trialId===trialId);required(trial,'TRIAL_NOT_FOUND');
  required(at>=trial.approvedAt,'TRIAL_CANCELLATION_INVALID');
  return seal({...registry,trials:registry.trials.map(t=>t.trialId===trialId?{...t,cancelledAt:t.cancelledAt||at}:t)});
}
module.exports={VERSION,MAX_TRIALS,MAX_SIGNALS,MAX_REPORTS,DURATION_MS,createRegistry,preparationFingerprint,
  validate,enroll,access,recordDelivery,cancel};
