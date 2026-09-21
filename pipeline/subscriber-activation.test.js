'use strict';

const assert=require('assert');
const a=require('./subscriber-activation');
const stripe=require('./stripe-subscriber');

function session(overrides){
  return Object.assign({
    id:'cs_activation_test',
    object:'checkout.session',
    payment_link:stripe.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',
    status:'complete',
    payment_status:'paid',
    created:1790000000,
    customer:'cus_activation',
    customer_details:{email:'buyer@example.com'},
    client_reference_id:'pp_activationfixture0000000000000000',
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    subscription:'sub_activation',
    custom_fields:[]
  },overrides||{});
}
function subscription(overrides){
  return Object.assign({
    id:'sub_activation',
    object:'subscription',
    created:1790003600,
    status:'active',
    customer:'cus_activation',
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
  },overrides||{});
}
function form(id,overrides){
  const base={
    id,
    form_name:'permitplate-onboarding',
    created_at:new Date((1790003600-300)*1000).toISOString(),
    data:{
      'form-name':'permitplate-onboarding',
      onboarding_version:'permitplate-onboarding-v1',
      plan:'monthly_79',
      email:'buyer@example.com',
      activation_ref:'pp_activationfixture0000000000000000',
      category:'equipment',
      territory:'Manhattan, Brooklyn',
      starter:'yes',
      'bot-field':''
    }
  };
  const o=overrides||{};
  return Object.assign({},base,o,{data:Object.assign({},base.data,o.data||{})});
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session(),
    subscription:subscription(),
    submissions:[form('submission_1')],
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc'
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.onboardingSubmissionId,'submission_1');
  assert.equal(out.activationReference,'pp_activationfixture0000000000000000');
  assert.equal(out.stripeClientReferenceId,'pp_activationfixture0000000000000000');
  assert.equal(out.subscriber.status,'ACTIVE');
  assert.equal(out.subscriber.preferenceSource,'NETLIFY_PRECHECKOUT_FORM');
  assert.equal(out.subscriber.preferenceReceiptId,'submission_1');
  assert.deepEqual(out.subscriber.profile.categories,['Equipment']);
  assert.deepEqual(out.subscriber.profile.boroughs,['Manhattan','Brooklyn']);
  assert.equal(out.subscriber.profile.starterSnapshotEnabled,true);
  assert.equal(
    out.subscriber.profile.baselineAt,
    new Date(1790003600*1000).toISOString()
  );
  assert.match(out.activationFingerprint,/^[0-9a-f]{64}$/);
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session(),
    subscription:subscription(),
    submissions:[form('wrong',{data:{email:'other@example.com'}})]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('NETLIFY_ONBOARDING_MATCH_FAILED'));
  assert(out.failures.includes('MATCHING_ONBOARDING_SUBMISSION_MISSING'));
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session({status:'expired',payment_status:'unpaid'}),
    subscription:subscription(),
    submissions:[form('submission_1')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('STRIPE_SUBSCRIPTION_CONTEXT_INVALID'));
  assert(out.failures.includes('CHECKOUT_NOT_COMPLETE'));
}

{
  const stale=form('stale',{
    created_at:new Date((1790003600-(25*60*60))*1000).toISOString()
  });
  const out=a.activateFromNetlifyPreferences({
    session:session(),
    subscription:subscription(),
    submissions:[stale]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('MATCHING_ONBOARDING_SUBMISSION_MISSING'));
}

{
  const future=form('future',{
    created_at:new Date((1790003600+1)*1000).toISOString()
  });
  const out=a.activateFromNetlifyPreferences({
    session:session(),
    subscription:subscription(),
    submissions:[future]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('MATCHING_ONBOARDING_SUBMISSION_MISSING'));
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session(),
    subscription:subscription(),
    submissions:[
      form('older',{created_at:new Date((1790003600-600)*1000).toISOString(),data:{category:'pos'}}),
      form('latest',{created_at:new Date((1790003600-60)*1000).toISOString(),data:{category:'equipment'}})
    ]
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.onboardingSubmissionId,'latest');
  assert.deepEqual(out.subscriber.profile.categories,['Equipment']);
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session({client_reference_id:'pp_differentreference00000000000000'}),
    subscription:subscription(),
    submissions:[form('submission_wrong_ref')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('NETLIFY_ONBOARDING_MATCH_FAILED'));
  assert(out.failures.includes('ACTIVATION_REFERENCE_MISMATCH'));
}

{
  const out=a.activateFromNetlifyPreferences({
    session:session({client_reference_id:null}),
    subscription:subscription(),
    submissions:[form('submission_missing_ref')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('NETLIFY_ONBOARDING_MATCH_FAILED'));
  assert(out.failures.includes('CLIENT_REFERENCE_ID_INVALID'));
}

{
  const a1=a.activateFromNetlifyPreferences({
    session:session(),subscription:subscription(),submissions:[form('same')]
  });
  const a2=a.activateFromNetlifyPreferences({
    session:JSON.parse(JSON.stringify(session())),
    subscription:JSON.parse(JSON.stringify(subscription())),
    submissions:[JSON.parse(JSON.stringify(form('same')))]
  });
  assert.equal(a1.activationFingerprint,a2.activationFingerprint);
}

console.log('PermitPlate subscriber activation tests passed.');
