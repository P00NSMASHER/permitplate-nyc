'use strict';
const assert=require('node:assert/strict');
const intake=require('./curated-stripe-onboarding');
const readiness=require('./stripe-intake-readiness');

const started='2026-10-19T10:30:00.000Z';
const baseline=intake.emptyLedger(started);
const anchor=intake.anchor(baseline);
const input={
  monitoringEnabled:true,ledger:baseline,anchor,
  evaluatedAt:'2026-10-19T16:30:00.000Z'
};
const good=readiness.evaluate(input);
assert.equal(good.valid,true);
assert.equal(good.lastPrivateReadbackAgeMs,6*60*60*1000);
assert.equal(good.subscriberPersonalDataEmitted,false);
assert.equal(good.realPaidCustomerDeliveryProven,false);
assert.equal(good.customerDeliveryAllowed,false);
assert.equal(good.scoringPromotionAllowed,false);
assert(!JSON.stringify(good).includes('subscriptions'));
const disabled=readiness.evaluate({...input,monitoringEnabled:false});
assert.equal(disabled.valid,false);
assert(disabled.failures.includes('STRIPE_INTAKE_SCHEDULE_NOT_ENABLED'));
const missing=readiness.evaluate({
  monitoringEnabled:true,evaluatedAt:input.evaluatedAt
});
assert(missing.failures.includes('STRIPE_INTAKE_PRIVATE_STATE_NOT_INITIALIZED'));
assert(missing.failures.includes('STRIPE_INTAKE_PROVIDER_READBACK_STALE_OR_MISSING'));
const missingAnchor=readiness.evaluate({...input,anchor:null});
assert(missingAnchor.failures.includes('STRIPE_INTAKE_PRIVATE_STATE_NOT_INITIALIZED'));
const forged=structuredClone(baseline);
forged.checkedAt='2026-10-19T16:00:00.000Z';
assert(readiness.evaluate({...input,ledger:forged}).failures.includes(
  'STRIPE_INTAKE_PRIVATE_LEDGER_INVALID'));
const wrongAnchor=structuredClone(anchor);
wrongAnchor.anchorFingerprint='0'.repeat(64);
assert(readiness.evaluate({...input,anchor:wrongAnchor}).failures.includes(
  'STRIPE_INTAKE_PRIVATE_ANCHOR_INVALID'));
const stale=readiness.evaluate({
  ...input,evaluatedAt:'2026-10-19T19:30:00.001Z'
});
assert(stale.failures.includes('STRIPE_INTAKE_PROVIDER_READBACK_STALE_OR_MISSING'));
const atNine=readiness.evaluate({
  ...input,evaluatedAt:'2026-10-19T19:30:00.000Z'
});
assert.equal(atNine.valid,true);
const future=readiness.evaluate({
  ...input,evaluatedAt:'2026-10-19T10:29:59.999Z'
});
assert(future.failures.includes('STRIPE_INTAKE_PROVIDER_READBACK_STALE_OR_MISSING'));
const invalidDate=readiness.evaluate({...input,evaluatedAt:'not-a-date'});
assert.equal(invalidDate.valid,false);
const nonCanonical=intake.seal({...baseline,
  checkedAt:'2026-10-19T10:30:00Z'
});
assert(readiness.evaluate({...input,ledger:nonCanonical}).failures.includes(
  'STRIPE_INTAKE_PROVIDER_READBACK_STALE_OR_MISSING'));
const absentOptIn=readiness.evaluate({...input,monitoringEnabled:'true'});
assert.equal(absentOptIn.valid,false);
console.log('Private Stripe paid-intake readiness: disabled, missing, stale, forged, future and unverified inputs fail closed.');
