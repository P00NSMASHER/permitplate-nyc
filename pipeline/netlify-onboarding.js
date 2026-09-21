'use strict';

const crypto=require('crypto');
const profiles=require('./subscriber-profile');

const NETLIFY_ONBOARDING_VERSION='PermitPlate-netlify-onboarding-v1.0.0';
const FORM_NAME='permitplate-onboarding';
const FORM_VERSION='permitplate-onboarding-v1';
const PLAN='monthly_79';
const MAX_PRECHECKOUT_AGE_MS=24*60*60*1000;

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
function text(value){ return value==null?'':String(value).trim(); }
function iso(value){
  const ms=Date.parse(text(value));
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
}
function validEmail(value){
  const email=text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;
}
function submissionData(submission){
  if(submission&&submission.data&&typeof submission.data==='object'){
    return submission.data;
  }
  return submission||{};
}
function submissionName(submission){
  return text(
    submission&&submission.form_name||
    submission&&submission.formName||
    submission&&submission.name||
    submissionData(submission)['form-name']
  );
}
function submissionId(submission){
  return text(
    submission&&submission.id||
    submission&&submission.submission_id||
    submission&&submission.submissionId
  )||null;
}
function submittedAt(submission){
  return iso(
    submission&&submission.created_at||
    submission&&submission.createdAt||
    submission&&submission.submitted_at||
    submission&&submission.submittedAt
  );
}

function normalizeSubmission(submission){
  const data=submissionData(submission);
  const failures=[];
  const id=submissionId(submission);
  const createdAt=submittedAt(submission);
  const formName=submissionName(submission);

  if(!id) failures.push('SUBMISSION_ID_MISSING');
  if(!createdAt) failures.push('SUBMISSION_TIME_INVALID');
  if(formName!==FORM_NAME) failures.push('FORM_NAME_MISMATCH');
  if(text(data.onboarding_version)!==FORM_VERSION) failures.push('FORM_VERSION_MISMATCH');
  if(text(data.plan)!==PLAN) failures.push('PLAN_MISMATCH');
  if(text(data['bot-field'])) failures.push('HONEYPOT_TRIGGERED');

  const email=validEmail(data.email);
  if(!email) failures.push('EMAIL_INVALID');

  const category=profiles.canonicalCategory(data.category);
  if(!category) failures.push('CATEGORY_INVALID');

  const territory=text(data.territory)||'ALL NYC';
  const starter=text(data.starter).toLowerCase();
  if(!['yes','no'].includes(starter)) failures.push('STARTER_INVALID');

  if(failures.length){
    return {
      onboardingVersion:NETLIFY_ONBOARDING_VERSION,
      status:'REVIEW',
      failures,
      submissionId:id,
      submittedAt:createdAt,
      email,
      preferences:null,
      receiptFingerprint:sha256(stableStringify({
        version:NETLIFY_ONBOARDING_VERSION,
        id,createdAt,failures:failures.slice().sort()
      }))
    };
  }

  const normalizedProfile=profiles.normalizeProfile({
    subscriberId:'PRECHECKOUT:'+id,
    recipientEmail:email,
    baselineAt:createdAt,
    categories:[category],
    boroughs:territory,
    minimumScore:60,
    starterSnapshotEnabled:starter==='yes',
    starterDays:7,
    starterLimit:10,
    maxSignals:25,
    subscriptionStatus:'canary',
    updatedAt:createdAt
  });
  if(normalizedProfile.status!=='ACTIVE'){
    return {
      onboardingVersion:NETLIFY_ONBOARDING_VERSION,
      status:'REVIEW',
      failures:['PROFILE_NORMALIZATION_FAILED',...(normalizedProfile.failures||[])],
      submissionId:id,
      submittedAt:createdAt,
      email,
      preferences:null,
      receiptFingerprint:sha256(stableStringify({
        version:NETLIFY_ONBOARDING_VERSION,
        id,createdAt,failures:['PROFILE_NORMALIZATION_FAILED',...(normalizedProfile.failures||[])].sort()
      }))
    };
  }

  const preferences={
    category:normalizedProfile.profile.categories[0],
    categories:normalizedProfile.profile.categories,
    boroughs:normalizedProfile.profile.boroughs,
    territory:normalizedProfile.profile.boroughs.length===profiles.BOROUGH_ORDER.length?
      'ALL NYC':normalizedProfile.profile.boroughs.join('; '),
    starterSnapshotEnabled:normalizedProfile.profile.starterSnapshotEnabled,
    starterDays:7,
    starterLimit:10,
    maxSignals:25,
    minimumScore:60
  };
  const receipt={
    onboardingVersion:NETLIFY_ONBOARDING_VERSION,
    status:'READY',
    failures:[],
    submissionId:id,
    submittedAt:createdAt,
    email,
    formName,
    formVersion:FORM_VERSION,
    plan:PLAN,
    preferences
  };
  receipt.receiptFingerprint=sha256(stableStringify(receipt));
  return receipt;
}

function matchSubmissionToSubscription(input){
  const data=input||{};
  const subscriptionEmail=validEmail(data.subscriptionEmail);
  const baselineAt=iso(data.baselineAt);
  const failures=[];
  if(!subscriptionEmail) failures.push('SUBSCRIPTION_EMAIL_INVALID');
  if(!baselineAt) failures.push('BASELINE_INVALID');

  const normalized=(data.submissions||[]).map(normalizeSubmission);
  const reviewReceipts=normalized.filter((item)=>item.status!=='READY');
  if(failures.length){
    return {
      status:'REVIEW',failures,matched:null,
      eligibleCount:0,reviewReceipts
    };
  }

  const baselineMs=Date.parse(baselineAt);
  const eligible=normalized.filter((item)=>{
    if(item.status!=='READY') return false;
    if(item.email!==subscriptionEmail) return false;
    const submittedMs=Date.parse(item.submittedAt);
    if(submittedMs>baselineMs) return false;
    if(baselineMs-submittedMs>MAX_PRECHECKOUT_AGE_MS) return false;
    return true;
  }).sort((a,b)=>{
    const dt=Date.parse(b.submittedAt)-Date.parse(a.submittedAt);
    if(dt) return dt;
    return String(a.submissionId).localeCompare(String(b.submissionId));
  });

  if(!eligible.length){
    return {
      status:'REVIEW',
      failures:['MATCHING_ONBOARDING_SUBMISSION_MISSING'],
      matched:null,
      eligibleCount:0,
      reviewReceipts
    };
  }

  if(eligible.length>1&&eligible[0].submittedAt===eligible[1].submittedAt){
    return {
      status:'REVIEW',
      failures:['MATCHING_ONBOARDING_SUBMISSION_AMBIGUOUS'],
      matched:null,
      eligibleCount:eligible.length,
      reviewReceipts
    };
  }

  const matched=eligible[0];
  return {
    status:'MATCHED',
    failures:[],
    matched,
    eligibleCount:eligible.length,
    ignoredOlderEligibleCount:Math.max(0,eligible.length-1),
    reviewReceipts,
    matchFingerprint:sha256(stableStringify({
      subscriptionEmail,
      baselineAt,
      submissionId:matched.submissionId,
      receiptFingerprint:matched.receiptFingerprint
    }))
  };
}

module.exports={
  NETLIFY_ONBOARDING_VERSION,
  FORM_NAME,
  FORM_VERSION,
  PLAN,
  MAX_PRECHECKOUT_AGE_MS,
  stableStringify,
  sha256,
  text,
  iso,
  validEmail,
  submissionData,
  submissionName,
  submissionId,
  submittedAt,
  normalizeSubmission,
  matchSubmissionToSubscription
};
