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
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    subscription:'sub_test',
    custom_fields:[
      {
        key:'category',type:'dropdown',optional:false,
        dropdown:{value:'equipment'}
      },
      {
        key:'territory',type:'text',optional:true,
        text:{value:'Manhattan, Brooklyn'}
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
    items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
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
        {key:'territory',type:'text',text:{value:''}},
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
  assert.equal(s.customFieldValue(session(),'territory'),'Manhattan, Brooklyn');
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
  const out=s.profileFromCheckout({
    session:session({metadata:{project:'other'}}),
    subscription:subscription({metadata:{project:'other'}})
  });
  assert.equal(out.status,'REVIEW');
  assert(out.failures.includes('PROJECT_MARKER_MISMATCH'));
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

console.log('PermitPlate Stripe subscriber adapter tests passed.');
