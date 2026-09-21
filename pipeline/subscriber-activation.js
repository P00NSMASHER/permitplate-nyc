'use strict';

const crypto=require('crypto');
const stripe=require('./stripe-subscriber');
const onboarding=require('./netlify-onboarding');

const SUBSCRIBER_ACTIVATION_VERSION='PermitPlate-subscriber-activation-v1.0.0';

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
function review(failures,extra){
  const result=Object.assign({
    activationVersion:SUBSCRIBER_ACTIVATION_VERSION,
    status:'REVIEW',
    failures,
    subscriber:null,
    onboardingMatch:null
  },extra||{});
  result.activationFingerprint=sha256(stableStringify(result));
  return result;
}

function activateFromNetlifyPreferences(input){
  const data=input||{};
  const context=stripe.checkoutSubscriptionContext({
    session:data.session,
    subscription:data.subscription,
    expectedPaymentLink:data.expectedPaymentLink,
    expectedPriceId:data.expectedPriceId
  });
  if(context.status!=='VALID_SUBSCRIPTION'){
    return review(['STRIPE_SUBSCRIPTION_CONTEXT_INVALID',...(context.failures||[])],{
      stripeContext:context
    });
  }

  const match=onboarding.matchSubmissionToSubscription({
    subscriptionEmail:context.email,
    baselineAt:context.baselineAt,
    clientReferenceId:context.clientReferenceId,
    submissions:data.submissions||[]
  });
  if(match.status!=='MATCHED'){
    return review(['NETLIFY_ONBOARDING_MATCH_FAILED',...(match.failures||[])],{
      stripeContext:context,
      onboardingMatch:match
    });
  }

  const subscriber=stripe.profileFromCheckoutAndPreferences({
    session:data.session,
    subscription:data.subscription,
    expectedPaymentLink:data.expectedPaymentLink,
    expectedPriceId:data.expectedPriceId,
    preferences:match.matched.preferences,
    preferenceSource:'NETLIFY_PRECHECKOUT_FORM',
    preferenceReceiptId:match.matched.submissionId
  });
  if(subscriber.status!=='ACTIVE'){
    return review(['SUBSCRIBER_PROFILE_ACTIVATION_FAILED',...(subscriber.failures||[])],{
      stripeContext:context,
      onboardingMatch:match,
      subscriber
    });
  }

  const result={
    activationVersion:SUBSCRIBER_ACTIVATION_VERSION,
    status:'ACTIVE',
    failures:[],
    stripeContextFingerprint:context.contextFingerprint,
    onboardingMatchFingerprint:match.matchFingerprint,
    onboardingSubmissionId:match.matched.submissionId,
    activationReference:match.matched.activationReference,
    stripeClientReferenceId:context.clientReferenceId,
    onboardingReceiptFingerprint:match.matched.receiptFingerprint,
    subscriber
  };
  result.activationFingerprint=sha256(stableStringify(result));
  return result;
}

module.exports={
  SUBSCRIBER_ACTIVATION_VERSION,
  stableStringify,
  sha256,
  review,
  activateFromNetlifyPreferences
};
