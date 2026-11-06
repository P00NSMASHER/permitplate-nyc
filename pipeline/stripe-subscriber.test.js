'use strict';

const assert=require('assert');
const s=require('./stripe-subscriber');

function session(overrides){
  return Object.assign({
    id:'cs_live_permitplate_test',
    object:'checkout.session',
    payment_link:s.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',
    status:'complete',
    payment_status:'paid',
    created:1790000000,
    customer:'cus_test',
    customer_details:{email:'buyer@example.com'},
    client_reference_id:'pp_stripefixture000000000000000000',
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    subscription:'sub_test',
    custom_fields:[
      {
        key:'category',type:'dropdown',optional:false,
        dropdown:{value:'equipment'}
      },
      {
        key:'territory',type:'dropdown',optional:false,
        dropdown:{value:'ManhattanBrooklyn'}
      },
      {
        key:'starter',type:'dropdown',optional:false,
        dropdown:{value:'yes'}
      }
    ]
  },overrides||{});
}
function subscription(overrides){
  return Object.assign({
    id:'sub_test',
    object:'subscription',
    created:1790003600,
    status:'active',
    customer:'cus_test',
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    items:{object:'list',has_more:false,
      data:[{quantity:1,price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
  },overrides||{});
}

{
  const out=s.profileFromCheckout({
    session:session(),
    subscription:subscription(),
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc'
  });
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.profile.subscriberId,'sub_test');
  assert.equal(out.profile.recipientEmail,'buyer@example.com');
  assert.deepEqual(out.profile.categories,['Equipment']);
  assert.deepEqual(out.profile.boroughs,['Manhattan','Brooklyn']);
  assert.equal(out.profile.starterSnapshotEnabled,true);
  assert.equal(out.profile.priceId,'price_1UFjcWDPW8riWrxQhnrPX6nc');
  assert.equal(out.profile.stripeCustomerId,'cus_test');
  assert.equal(out.profile.stripeSubscriptionId,'sub_test');

  // Baseline comes from subscription.created, not the earlier Checkout Session created time.
  assert.equal(out.profile.baselineAt,new Date(1790003600*1000).toISOString());
  assert.notEqual(out.profile.baselineAt,new Date(1790000000*1000).toISOString());

  const row=s.toPrivateSheetRow(out);
  assert.equal(row.Email,'buyer@example.com');
  assert.equal(row.Categories,'Equipment');
  assert.equal(row['Boroughs/Territory'],'Manhattan; Brooklyn');
  assert.equal(row['Starter Snapshot Enabled'],true);
  assert.equal(row['Stripe Subscription'],'sub_test');
  assert.equal(row['Profile Fingerprint'],out.profileFingerprint);
}

{
  const out=s.profileFromCheckout({
    session:session({
      custom_fields:[
        {key:'category',type:'dropdown',dropdown:{value:'pos'}},
        {key:'territory',type:'dropdown',dropdown:{value:'AllNYC'}},
        {key:'starter',type:'dropdown',dropdown:{value:'no'}}
      ]
    }),
    subscription:subscription({status:'trialing'})
  });
  assert.equal(out.status,'ACTIVE');
  assert.deepEqual(out.profile.categories,['POS']);
  assert.equal(out.profile.starterSnapshotEnabled,false);
  assert.equal(out.profile.boroughs.length,5);
  assert.equal(s.toPrivateSheetRow(out)['Boroughs/Territory'],'ALL NYC');
}

{
  assert.equal(s.customFieldValue(session(),'category'),'equipment');
  assert.equal(s.customFieldValue(session(),'territory'),'ManhattanBrooklyn');
  assert.equal(s.normalizeCheckoutTerritory('ManhattanBrooklyn'),'Manhattan, Brooklyn');
  assert.equal(s.normalizeCheckoutTerritory('AllNYC'),'ALL NYC');
  assert.equal(s.customFieldValue({custom_fields:[
    {key:'n',type:'numeric',numeric:{value:'42'}}
  ]},'n'),'42');
  assert.equal(s.customFieldValue(session(),'missing'),null);
}

{
  const out=s.profileFromCheckout({
    session:session({payment_link:'plink_wrong'}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PAYMENT_LINK_MISMATCH'));
}

{
  // A $79/month paid membership cannot be activated from a completed
  // Checkout that requires no payment (for example, a free-trial Checkout).
  // The manually supervised free trial is a separate, non-billing workflow.
  const noCharge=s.profileFromCheckout({
    session:session({payment_status:'no_payment_required'}),
    subscription:subscription({status:'trialing'})
  });
  assert.equal(noCharge.status,'REVIEW',
    'zero-payment Checkout must not create a paid subscriber profile');
  assert(noCharge.failures.includes('CHECKOUT_PAYMENT_NOT_CONFIRMED'));
  assert.equal(noCharge.profile,null);
  const externalNoCharge=s.profileFromCheckoutAndPreferences({
    session:session({payment_status:'no_payment_required',custom_fields:[]}),
    subscription:subscription({status:'trialing'}),
    preferences:{category:'Equipment',boroughs:['Brooklyn']}
  });
  assert.equal(externalNoCharge.status,'REVIEW',
    'manual preference association must enforce the same payment gate');
  assert(externalNoCharge.failures.includes('CHECKOUT_PAYMENT_NOT_CONFIRMED'));
}

{
  const out=s.profileFromCheckout({
    session:session({status:'expired',payment_status:'unpaid'}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('CHECKOUT_NOT_COMPLETE'));
  assert(out.failures.includes('CHECKOUT_PAYMENT_NOT_CONFIRMED'));
}

{
  const out=s.profileFromCheckout({
    session:session(),
    subscription:null
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('SUBSCRIPTION_OBJECT_REQUIRED'));
  assert(out.failures.includes('SUBSCRIPTION_CREATED_MISSING'));
}

{
  const out=s.profileFromCheckout({
    session:session(),
    subscription:subscription({status:'past_due'})
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('SUBSCRIPTION_STATUS_NOT_ELIGIBLE'));
}

{
  // Stripe pause_collection may retain status='active' while invoices are not
  // collected. Neither direct paid-onboarding adapter may call that ACTIVE.
  for(const behavior of ['void','keep_as_draft','mark_uncollectible']){
    const paused=subscription({status:'active',pause_collection:{behavior,resumes_at:null}});
    const direct=s.profileFromCheckout({session:session(),subscription:paused});
    assert.equal(direct.status,'REVIEW','paused billing must not grant a paid profile');
    assert(direct.failures.includes('SUBSCRIPTION_COLLECTION_PAUSED'));
    assert.equal(direct.profile,null);
    const external=s.profileFromCheckoutAndPreferences({
      session:session({custom_fields:[]}),subscription:paused,
      preferences:{category:'Equipment',boroughs:['Brooklyn']}
    });
    assert.equal(external.status,'REVIEW','external preferences cannot bypass paused billing');
    assert(external.failures.includes('SUBSCRIPTION_COLLECTION_PAUSED'));
    assert.equal(external.profile,null);
  }
}

{
  const fields=session().custom_fields.filter((field)=>field.key!=='category');
  const out=s.profileFromCheckout({
    session:session({custom_fields:fields}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('CATEGORY_CUSTOM_FIELD_MISSING'));
}

{
  const fields=session().custom_fields.filter((field)=>field.key!=='starter');
  const out=s.profileFromCheckout({
    session:session({custom_fields:fields}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('STARTER_CUSTOM_FIELD_MISSING'));
}

{
  const fields=session().custom_fields.filter((field)=>field.key!=='territory');
  const out=s.profileFromCheckout({
    session:session({custom_fields:fields}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('TERRITORY_CUSTOM_FIELD_MISSING'));
}

{
  const fields=session().custom_fields.map((field)=>
    field.key==='territory'?
      {key:'territory',type:'dropdown',dropdown:{value:'UnknownTerritory'}}:
      field
  );
  const out=s.profileFromCheckout({
    session:session({custom_fields:fields}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('TERRITORY_CUSTOM_FIELD_INVALID'));
}


{
  const out=s.profileFromCheckout({
    session:session({metadata:{project:'other'}}),
    subscription:subscription({metadata:{project:'other'}})
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PROJECT_MARKER_MISMATCH'));
}

{
  // A valid Checkout project marker must never mask contradictory
  // subscription metadata from the same Stripe provider snapshot.
  const out=s.profileFromCheckout({
    session:session({metadata:{project:'permitplate_nyc'}}),
    subscription:subscription({metadata:{project:'other_project'}})
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PROJECT_MARKER_MISMATCH'));
  assert.equal(out.profile,null);
}

{
  // Preserve compatibility when only one Stripe object carries a marker.
  const out=s.profileFromCheckout({
    session:session(),subscription:subscription({metadata:{}})
  });
  assert.equal(out.status,'ACTIVE');
}

{
  const nested=session({subscription:subscription()});
  const out=s.profileFromCheckout({session:nested,subscription:null});
  assert.equal(out.status,'ACTIVE');
  assert.equal(out.subscriptionId,'sub_test');
}

{
  const a=s.profileFromCheckout({session:session(),subscription:subscription()});
  const b=s.profileFromCheckout({
    session:JSON.parse(JSON.stringify(session())),
    subscription:JSON.parse(JSON.stringify(subscription()))
  });
  assert.equal(a.adapterFingerprint,b.adapterFingerprint);
  assert.equal(a.profileFingerprint,b.profileFingerprint);
}

{
  const ctx=s.checkoutSubscriptionContext({
    session:session({custom_fields:[]}),
    subscription:subscription(),
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc'
  });
  assert.equal(ctx.status,'VALID_SUBSCRIPTION');
  assert.equal(ctx.email,'buyer@example.com');
  assert.equal(ctx.clientReferenceId,'pp_stripefixture000000000000000000');
  assert.equal(ctx.baselineAt,new Date(1790003600*1000).toISOString());
  assert.equal(ctx.priceId,'price_1UFjcWDPW8riWrxQhnrPX6nc');
  assert.match(ctx.contextFingerprint,/^[0-9a-f]{64}$/);
}

{
  const ctx=s.checkoutSubscriptionContext({
    session:session({client_reference_id:null,custom_fields:[]}),
    subscription:subscription()
  });
  assert.equal(ctx.status,'VALID_SUBSCRIPTION');
  assert.equal(ctx.clientReferenceId,null);
}

{
  const out=s.profileFromCheckoutAndPreferences({
    session:session({custom_fields:[]}),
    subscription:subscription(),
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc',
    preferences:{
      category:'Equipment',
      boroughs:['Manhattan','Brooklyn'],
      starterSnapshotEnabled:true,
      minimumScore:60,
      starterDays:7,
      starterLimit:10,
      maxSignals:10
    },
    preferenceSource:'EXTERNAL_PREFERENCE_RECEIPT',
    preferenceReceiptId:'submission_123'
  });
  assert.equal(out.status,'ACTIVE');
  assert.deepEqual(out.profile.categories,['Equipment']);
  assert.deepEqual(out.profile.boroughs,['Manhattan','Brooklyn']);
  assert.equal(out.profile.starterSnapshotEnabled,true);
  assert.equal(out.preferenceSource,'EXTERNAL_PREFERENCE_RECEIPT');
  assert.equal(out.preferenceReceiptId,'submission_123');
}

{
  // The public $79/month offer caps each brief at ten signals. The external
  // preference receipt path must apply the same bound as Stripe custom fields.
  const basic=s.profileFromCheckoutAndPreferences({
    session:session({custom_fields:[]}),subscription:subscription(),
    preferences:{category:'Equipment',boroughs:['Brooklyn']}
  });
  assert.equal(basic.status,'ACTIVE');
  assert.equal(basic.profile.maxSignals,10,
    'unspecified external paid allowance must inherit the public 10-signal cap');

  const over=s.profileFromCheckoutAndPreferences({
    session:session({custom_fields:[]}),subscription:subscription(),
    preferences:{category:'Equipment',boroughs:['Brooklyn'],maxSignals:25}
  });
  assert.equal(over.status,'REVIEW',
    'an explicit 25-signal external allowance must not activate the $79 plan');
  assert(over.failures.includes('PAID_PLAN_MAX_SIGNALS_INVALID'));
}

{
  const out=s.checkoutSubscriptionContext({
    session:session({custom_fields:[]}),
    subscription:subscription(),
    expectedPriceId:'price_wrong'
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PRICE_ID_MISMATCH'));
}

{
  const out=s.profileFromCheckoutAndPreferences({
    session:session({custom_fields:[]}),
    subscription:subscription(),
    preferences:{category:'Unknown',starterSnapshotEnabled:true},
    preferenceSource:'EXTERNAL_PREFERENCE_RECEIPT',
    preferenceReceiptId:'submission_bad'
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PROFILE_NORMALIZATION_FAILED'));
}

{
  // Previously the session customer silently won over a different
  // subscription customer, producing an ACTIVE paid profile.
  const out=s.profileFromCheckout({
    session:session({customer:'cus_other'}),
    subscription:subscription()
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('STRIPE_CUSTOMER_ID_MISMATCH'));
  assert.equal(out.profile,null);
}

{
  // Missing identities cannot be recovered from the other Stripe object.
  for(const [sess,sub] of [
    [session({customer:null}),subscription()],
    [session(),subscription({customer:null})]
  ]){
    const out=s.profileFromCheckout({session:sess,subscription:sub});
    assert.equal(out.status,'REVIEW');
    assert(out.failures.includes('STRIPE_CUSTOMER_ID_MISSING'));
  }
}

{
  // External preference receipts must not bypass the customer match.
  const out=s.profileFromCheckoutAndPreferences({
    session:session({customer:'cus_other'}),
    subscription:subscription(),
    preferences:{category:'Equipment',territory:'Brooklyn'}
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('STRIPE_CUSTOMER_ID_MISMATCH'));
}


{
  // A supplied Subscription object alone does not establish that a
  // completed Checkout Session purchased that particular Subscription.
  // Before the guard, all three missing Checkout links were accepted.
  for(const absentLink of [null,undefined,'']){
    const out=s.profileFromCheckout({
      session:session({subscription:absentLink}),
      subscription:subscription()
    });
    assert.equal(out.status,'REVIEW');
    assert(out.failures.includes('CHECKOUT_SUBSCRIPTION_ID_MISSING'));
    assert.equal(out.profile,null);
  }

  // External preference receipts must obey the same source-of-truth link.
  const external=s.profileFromCheckoutAndPreferences({
    session:session({subscription:null}),
    subscription:subscription(),
    preferences:{category:'Equipment',territory:'Brooklyn'}
  });
  assert.equal(external.status,'REVIEW');
  assert(external.failures.includes('CHECKOUT_SUBSCRIPTION_ID_MISSING'));
}



{
  // A Subscription item list can be paginated and quantity can exceed one.
  // A single visible matching price does NOT prove a $79/month single-seat
  // commitment when unseen items or extra seats are billed.
  const advertisedPrice='price_1UFjcWDPW8riWrxQhnrPX6nc';
  const cases=[
    {label:'hidden priced item',items:{
      object:'list',has_more:true,
      data:[{quantity:1,price:{id:advertisedPrice}}]}},
    {label:'two seats',items:{
      object:'list',has_more:false,
      data:[{quantity:2,price:{id:advertisedPrice}}]}}
  ];
  for(const example of cases){
    const sub=subscription({items:example.items});
    const direct=s.profileFromCheckout({session:session(),subscription:sub});
    assert.equal(direct.status,'REVIEW',
      example.label+' must not activate a paid subscriber');
    assert.equal(direct.profile,null);
    const external=s.profileFromCheckoutAndPreferences({
      session:session(),subscription:sub,
      preferences:{category:'Equipment',boroughs:['Brooklyn']}
    });
    assert.equal(external.status,'REVIEW',
      example.label+' must not be accepted via external preferences');
    assert.equal(external.profile,null);
  }
}

{
  // A paid Checkout must carry exactly the three unique required dropdowns.
  // The TEST-only provider reader already rejects duplicates, but direct
  // fulfillment activation previously used the first matching field instead.
  const fields=session().custom_fields;
  for(const bad of [
    [...fields,{key:'category',type:'dropdown',dropdown:{value:'insurance'}}],
    [...fields,{key:'territory',type:'dropdown',dropdown:{value:'Bronx'}}],
    [...fields,{key:'starter',type:'dropdown',dropdown:{value:'no'}}],
    fields.map(f=>f.key==='category'?
      {key:'category',type:'text',text:{value:'equipment'}}:f),
    [...fields,{key:'unverified',type:'text',text:{value:'extra'}}]
  ]){
    const out=s.profileFromCheckout({
      session:session({custom_fields:bad}),
      subscription:subscription()
    });
    assert.equal(out.status,'REVIEW',
      'ambiguous or non-dropdown preference fields must not activate fulfillment');
    assert(out.failures.includes('CHECKOUT_REQUIRED_DROPDOWNS_INVALID'));
    assert.equal(out.profile,null);
  }
}

{
  // UNPINNED_PAID_PRICE_REGRESSION: An adapter caller that omits the optional
  // expectedPriceId must NOT grant paid fulfillment for a different recurring
  // Price, even when the Checkout Payment Link matches PermitPlate.
  const wrongPrice=subscription({items:{object:'list',has_more:false,
    data:[{quantity:1,price:{id:'price_unrelated_other_offer'}}]}});
  const direct=s.profileFromCheckout({
    session:session(),subscription:wrongPrice
  });
  assert.equal(direct.status,'REVIEW',
    'wrong paid Price without an explicit expectation must not activate a subscriber');
  assert(direct.failures.includes('PRICE_ID_MISMATCH'));
  assert.equal(direct.profile,null);
  const external=s.profileFromCheckoutAndPreferences({
    session:session({custom_fields:[]}),subscription:wrongPrice,
    preferences:{category:'Equipment',boroughs:['Brooklyn']}
  });
  assert.equal(external.status,'REVIEW',
    'external preference receipts must not bypass the offered paid Price');
  assert(external.failures.includes('PRICE_ID_MISMATCH'));
  assert.equal(external.profile,null);
}

console.log('PermitPlate Stripe subscriber adapter tests passed.');
