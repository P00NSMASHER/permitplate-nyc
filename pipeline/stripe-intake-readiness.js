'use strict';

// Read-only operational gate. The paid Stripe link is not safe to treat as
// monitored merely because the public Checkout fields and test canaries pass.
// Real monitoring requires an opt-in scheduled job AND a fresh, validated
// private ledger that the live Stripe GET path has persisted successfully.
const intake=require('./curated-stripe-onboarding');

const VERSION='PermitPlate-stripe-intake-readiness-v1.0.0';
// Stripe polling schedule: 04:23, 10:23, 16:23, 22:23 UTC.
// Give the six-hour cadence at most three hours of schedule delay.
const MAX_AGE_MS=9*60*60*1000;

function evaluate(input){
  const d=input||{},failures=[];
  const enabled=d.monitoringEnabled===true;
  const ledger=d.ledger||null,anchor=d.anchor||null;
  const evaluatedAt=intake.iso(d.evaluatedAt);
  const checkedAt=intake.iso(ledger&&ledger.checkedAt);
  const ageMs=evaluatedAt&&checkedAt?
    Date.parse(evaluatedAt)-Date.parse(checkedAt):null;

  if(!enabled)failures.push('STRIPE_INTAKE_SCHEDULE_NOT_ENABLED');
  if(!ledger||!anchor)failures.push('STRIPE_INTAKE_PRIVATE_STATE_NOT_INITIALIZED');
  if(ledger){
    const checked=intake.validate(ledger);
    if(!checked.valid)failures.push('STRIPE_INTAKE_PRIVATE_LEDGER_INVALID');
  }
  if(ledger&&anchor&&!intake.verifyAnchor(ledger,anchor)){
    failures.push('STRIPE_INTAKE_PRIVATE_ANCHOR_INVALID');
  }
  if(!evaluatedAt||!checkedAt||checkedAt!==ledger?.checkedAt||
     ageMs===null||ageMs<0||ageMs>MAX_AGE_MS){
    failures.push('STRIPE_INTAKE_PROVIDER_READBACK_STALE_OR_MISSING');
  }
  return {
    version:VERSION,
    valid:failures.length===0,
    failures,
    monitoringEnabled:enabled,
    lastPrivateReadbackAt:checkedAt,
    lastPrivateReadbackAgeMs:ageMs,
    maxReadbackAgeMs:MAX_AGE_MS,
    // Strict separation from claimed customer proof or send authorization.
    subscriberPersonalDataEmitted:false,
    realPaidCustomerDeliveryProven:false,
    customerDeliveryAllowed:false,
    scoringPromotionAllowed:false
  };
}
module.exports={VERSION,MAX_AGE_MS,evaluate};
