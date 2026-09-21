'use strict';

const assert=require('assert');
const n=require('./netlify-onboarding');

function submission(id,overrides){
  const base={
    id,
    form_name:'permitplate-onboarding',
    created_at:'2026-09-21T15:50:00Z',
    data:{
      'form-name':'permitplate-onboarding',
      onboarding_version:'permitplate-onboarding-v1',
      plan:'monthly_79',
      email:'Buyer@Example.com',
      activation_ref:'pp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      category:'equipment',
      territory:'Manhattan, Brooklyn',
      starter:'yes',
      'bot-field':''
    }
  };
  const o=overrides||{};
  return Object.assign({},base,o,{
    data:Object.assign({},base.data,o.data||{})
  });
}

{
  const out=n.normalizeSubmission(submission('subm_1'));
  assert.equal(out.status,'READY');
  assert.equal(out.email,'buyer@example.com');
  assert.equal(out.preferences.category,'Equipment');
  assert.deepEqual(out.preferences.boroughs,['Manhattan','Brooklyn']);
  assert.equal(out.preferences.starterSnapshotEnabled,true);
  assert.match(out.receiptFingerprint,/^[0-9a-f]{64}$/);
}

{
  const out=n.normalizeSubmission(submission('subm_2',{data:{territory:'',category:'pos',starter:'no'}}));
  assert.equal(out.status,'READY');
  assert.equal(out.preferences.category,'POS');
  assert.equal(out.preferences.boroughs.length,5);
  assert.equal(out.preferences.territory,'ALL NYC');
  assert.equal(out.preferences.starterSnapshotEnabled,false);
}

{
  const out=n.normalizeSubmission(submission('subm_bad',{
    form_name:'wrong',
    data:{
      onboarding_version:'wrong',
      plan:'wrong',
      email:'bad',
      category:'unknown',
      starter:'maybe',
      'bot-field':'spam'
    }
  }));
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('FORM_NAME_MISMATCH'));
  assert(out.failures.includes('FORM_VERSION_MISMATCH'));
  assert(out.failures.includes('PLAN_MISMATCH'));
  assert(out.failures.includes('HONEYPOT_TRIGGERED'));
  assert(out.failures.includes('EMAIL_INVALID'));
  assert(out.failures.includes('CATEGORY_INVALID'));
  assert(out.failures.includes('STARTER_INVALID'));
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    clientReferenceId:'pp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    submissions:[
      submission('old',{created_at:'2026-09-21T14:00:00Z',data:{category:'pos'}}),
      submission('latest',{created_at:'2026-09-21T15:55:00Z',data:{category:'equipment'}})
    ]
  });
  assert.equal(out.status,'MATCHED');
  assert.equal(out.matched.submissionId,'latest');
  assert.equal(out.matched.preferences.category,'Equipment');
  assert.equal(out.eligibleCount,2);
  assert.equal(out.ignoredOlderEligibleCount,1);
  assert.match(out.matchFingerprint,/^[0-9a-f]{64}$/);
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    clientReferenceId:'pp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    submissions:[
      submission('wrong-email',{data:{email:'other@example.com'}}),
      submission('future',{created_at:'2026-09-21T16:01:00Z'}),
      submission('stale',{created_at:'2026-09-20T15:59:59Z'})
    ]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('MATCHING_ONBOARDING_SUBMISSION_MISSING'));
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    clientReferenceId:'pp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    submissions:[
      submission('a',{created_at:'2026-09-21T15:55:00Z',data:{category:'pos'}}),
      submission('b',{created_at:'2026-09-21T15:55:00Z',data:{category:'equipment'}})
    ]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('MATCHING_ONBOARDING_SUBMISSION_AMBIGUOUS'));
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'bad-email',
    baselineAt:'bad',
    clientReferenceId:'bad-ref',
    submissions:[submission('x')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('SUBSCRIPTION_EMAIL_INVALID'));
  assert(out.failures.includes('BASELINE_INVALID'));
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    clientReferenceId:'pp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    submissions:[submission('wrong-ref')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('ACTIVATION_REFERENCE_MISMATCH'));
}

{
  const out=n.matchSubmissionToSubscription({
    subscriptionEmail:'buyer@example.com',
    baselineAt:'2026-09-21T16:00:00Z',
    submissions:[submission('missing-client-ref')]
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('CLIENT_REFERENCE_ID_INVALID'));
}

{
  const out=n.normalizeSubmission(submission('bad-ref',{data:{activation_ref:'not-valid'}}));
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('ACTIVATION_REFERENCE_INVALID'));
}

{
  const a=n.normalizeSubmission(submission('same'));
  const b=n.normalizeSubmission(JSON.parse(JSON.stringify(submission('same'))));
  assert.equal(a.receiptFingerprint,b.receiptFingerprint);
}

console.log('PermitPlate Netlify onboarding receipt tests passed.');
