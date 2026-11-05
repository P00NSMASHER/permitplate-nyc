'use strict';
const assert=require('node:assert/strict');
const sandbox=require('./stripe-sandbox-acceptance');

const SUB='sub_sandbox_acceptance_fixture';
const SESSION='cs_test_sandbox_acceptance_fixture';
const CUSTOMER='cus_sandbox_acceptance_fixture';
const link={
  object:'payment_link',id:sandbox.TEST_LINK,
  livemode:false,active:true,
  metadata:{project:'permitplate_nyc',plan:'pilot_monthly',environment:'test'},
  custom_fields:[
    {key:'category',type:'dropdown',optional:false,
      dropdown:{options:[{value:'equipment'},{value:'insurance'}],default_value:null}},
    {key:'territory',type:'dropdown',optional:false,
      dropdown:{options:[{value:'Brooklyn'},{value:'AllNYC'}],default_value:null}},
    {key:'starter',type:'dropdown',optional:false,
      dropdown:{options:[{value:'yes'},{value:'no'}],default_value:'yes'}}
  ]
};
const lineItems={
  object:'list',has_more:false,
  data:[{quantity:1,price:{id:sandbox.TEST_PRICE,currency:'usd',
    unit_amount:7900,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]
};
const checkout={
  object:'checkout.session',id:SESSION,livemode:false,
  payment_link:sandbox.TEST_LINK,status:'complete',
  payment_status:'paid',mode:'subscription',
  currency:'usd',amount_total:7900,
  customer:CUSTOMER,customer_details:{email:'synthetic@example.invalid'},
  metadata:{project:'permitplate_nyc'},
  subscription:SUB,custom_fields:[
    {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
    {key:'territory',type:'dropdown',dropdown:{value:'Brooklyn'}},
    {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
  ]
};
const subscription={
  id:SUB,livemode:false,status:'active',customer:CUSTOMER,
  created:1792400000,items:{object:'list',has_more:false,
    data:[{quantity:1,price:{id:sandbox.TEST_PRICE}}]}
};
function provider({linkValue=link,items=lineItems,sessions=[checkout],sub=subscription,
                  extraSubscriptions={},hasMore=false}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,redirect:options.redirect});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert(url.startsWith('https://api.stripe.com/v1/'));
    assert.equal(options.headers.Authorization,'Bearer rk_test_synthetic_fixture');
    let record;
    const uri=new URL(url);
    if(uri.pathname==='/v1/payment_links/'+sandbox.TEST_LINK){
      record=linkValue;
    }else if(uri.pathname==='/v1/payment_links/'+sandbox.TEST_LINK+'/line_items'){
      record=items;
    }else if(uri.pathname==='/v1/checkout/sessions'){
      assert.equal(uri.searchParams.get('payment_link'),sandbox.TEST_LINK);
      assert.equal(uri.searchParams.get('status'),'complete');
      record={data:sessions,has_more:hasMore};
    }else if(uri.pathname==='/v1/subscriptions/'+SUB){
      record=sub;
    }else if(uri.pathname.startsWith('/v1/subscriptions/')&&
              Object.hasOwn(extraSubscriptions,uri.pathname.split('/').at(-1))){
      record=extraSubscriptions[uri.pathname.split('/').at(-1)];
    }else{
      throw Error('UNEXPECTED_SANDBOX_PROVIDER_ENDPOINT');
    }
    return {ok:true,json:async()=>structuredClone(record)};
  };
  return {fetchImpl,calls};
}
async function run(){
  const one=provider();
  const accepted=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',fetchImpl:one.fetchImpl
  });
  assert.equal(accepted.environment,'STRIPE_TEST_ONLY');
  assert.equal(accepted.status,'PROFILE_SOURCE_ACCEPTED_NO_SEND');
  assert.equal(accepted.completedSessionCount,1);
  assert.equal(accepted.paidSessionCount,1);
  assert.equal(accepted.eligibleProfileCount,1);
  assert.equal(accepted.externalSendCalls,0);
  assert.equal(accepted.paymentMutations,0);
  assert.equal(accepted.noSend,true);
  assert.equal(accepted.readOnly,true);
  assert(one.calls.every(c=>c.method==='GET'));
  assert(!JSON.stringify(accepted).includes('synthetic@example.invalid'));
  const again=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',fetchImpl:provider().fetchImpl
  });
  assert.deepEqual(again,accepted); // deterministic no-write/readback

  // The public diagnostic deliberately returns aggregates only. The separate
  // private adapter must produce a deterministic, non-delivering association
  // containing category + borough + starter and the exact provider identities.
  const privateProvider=provider();
  const privateResult=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',fetchImpl:privateProvider.fetchImpl
  });
  assert.equal(privateResult.status,'PRIVATE_ASSOCIATION_READY_NO_SEND');
  assert.equal(privateResult.privateAssociations.length,1);
  assert.equal(privateResult.externalSendCalls,0);
  assert.equal(privateResult.paymentMutations,0);
  assert.equal(privateResult.transportAllowed,false);
  assert.equal(privateResult.ownerAuthorizationGranted,false);
  assert(privateProvider.calls.every(c=>c.method==='GET'));
  const association=privateResult.privateAssociations[0];
  assert.equal(association.checkoutSessionId,SESSION);
  assert.equal(association.subscriptionId,SUB);
  assert.equal(association.privateSheetRow.Email,'synthetic@example.invalid');
  assert.equal(association.privateSheetRow.Categories,'Equipment');
  assert.equal(association.privateSheetRow['Boroughs/Territory'],'Brooklyn');
  assert.equal(association.privateSheetRow['Starter Snapshot Enabled'],true);
  assert.equal(association.state,'PENDING_FOUNDER_REVIEW');
  assert.equal(association.transportAllowed,false);
  assert.equal(association.ownerAuthorizationGranted,false);
  const stablePrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',fetchImpl:provider().fetchImpl
  });
  assert.deepEqual(stablePrivate,privateResult); // idempotent re-read
  assert.equal(Object.hasOwn(accepted,'privateAssociations'),false);
  assert(!JSON.stringify(accepted).includes('synthetic@example.invalid'));
  const noPrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',fetchImpl:provider({sessions:[]}).fetchImpl
  });
  assert.equal(noPrivate.status,'NO_COMPLETED_PAID_HOSTED_CHECKOUT');
  assert.deepEqual(noPrivate.privateAssociations,[]);
  const heldPrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sub:{...subscription,status:'canceled'}}).fetchImpl
  });
  assert.equal(heldPrivate.status,'CHECKOUT_REVIEW_REQUIRED');
  assert.deepEqual(heldPrivate.privateAssociations,[]);
  const mixedPrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[checkout,{...checkout,
      id:'cs_test_sandbox_cancelled_second',
      subscription:'sub_sandbox_cancelled_second',
      customer:'cus_sandbox_cancelled_second'}],
      extraSubscriptions:{sub_sandbox_cancelled_second:{...subscription,
        id:'sub_sandbox_cancelled_second',
        customer:'cus_sandbox_cancelled_second',status:'canceled'}}}).fetchImpl
  });
  assert.equal(mixedPrivate.status,'CHECKOUT_REVIEW_REQUIRED');
  assert.deepEqual(mixedPrivate.privateAssociations,[]);

  // Red-team provider readback: Stripe's offered dropdown choices are a
  // source contract, not merely arbitrary canonical vendor categories.
  // A duplicate or a selection absent from this exact Payment Link must hold.
  const duplicateCategory={...checkout,custom_fields:[
    ...checkout.custom_fields,
    {key:'category',type:'dropdown',dropdown:{value:'insurance'}}
  ]};
  await assert.rejects(sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[duplicateCategory]}).fetchImpl
  }),/SANDBOX_CHECKOUT_PREFERENCE_FIELDS_INVALID/);
  const categoryNotOffered={...checkout,custom_fields:
    checkout.custom_fields.map(f=>f.key==='category'?
      {...f,dropdown:{value:'pos'}}:f)};
  await assert.rejects(sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[categoryNotOffered]}).fetchImpl
  }),/SANDBOX_CHECKOUT_PREFERENCE_FIELDS_INVALID/);

  // Red-team: Stripe 'paid' is insufficient for the advertised USD $79
  // monthly first payment if Checkout itself charged $0 or non-USD.
  for(const altered of [
    {...checkout,amount_total:0},
    {...checkout,currency:'eur'},
    {...checkout,amount_total:undefined},
    {...checkout,currency:undefined}
  ]){
    await assert.rejects(sandbox.privateNoSendHandoff({
      key:'rk_test_synthetic_fixture',
      fetchImpl:provider({sessions:[altered]}).fetchImpl
    }),/SANDBOX_CHECKOUT_AMOUNT_INVALID/);
  }

  // Billing integrity: the source link establishes one $79 monthly item.
  // A completed paid Checkout must not silently associate a profile when its
  // total includes unexplained surcharges. Explicit provider-reported tax on
  // the $79 subtotal is acceptable; absent or contradictory breakdown is not.
  const taxedCheckout={...checkout,amount_subtotal:7900,amount_total:8557,
    total_details:{amount_tax:657,amount_discount:0,amount_shipping:0}};
  for(const altered of [
    {...checkout,amount_total:15800},
    {...checkout,amount_total:7901},
    {...checkout,amount_subtotal:15800,amount_total:15800,
      total_details:{amount_tax:0,amount_discount:0,amount_shipping:0}},
    {...taxedCheckout,total_details:{amount_tax:50,
      amount_discount:0,amount_shipping:0}},
    {...taxedCheckout,amount_subtotal:8000}
  ]){
    await assert.rejects(sandbox.privateNoSendHandoff({
      key:'rk_test_synthetic_fixture',
      fetchImpl:provider({sessions:[altered]}).fetchImpl
    }),/SANDBOX_CHECKOUT_AMOUNT_INVALID/);
  }
  const taxAccepted=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[taxedCheckout]}).fetchImpl
  });
  assert.equal(taxAccepted.status,'PRIVATE_ASSOCIATION_READY_NO_SEND');
  assert.equal(taxAccepted.privateAssociations.length,1);

  const none=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',fetchImpl:provider({sessions:[]}).fetchImpl
  });
  assert.equal(none.status,'NO_ELIGIBLE_HOSTED_TEST_CHECKOUT');
  assert.equal(none.completedSessionCount,0);
  assert.equal(none.eligibleProfileCount,0);

  const unpaid=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[{...checkout,payment_status:'unpaid'}]}).fetchImpl
  });
  assert.equal(unpaid.heldCount,1);
  assert.equal(unpaid.eligibleProfileCount,0);
  const canceled=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sub:{...subscription,status:'canceled'}}).fetchImpl
  });
  assert.equal(canceled.eligibleProfileCount,0);
  assert.equal(canceled.heldCount,1);
  assert.equal(canceled.paidHeldCount,1);
  assert.equal(canceled.status,'PAID_CHECKOUT_REVIEW_REQUIRED');
  // Stripe can pause collection while keeping subscription.status='active'.
  // A prior paid Checkout must not silently validate a currently uncollected
  // $79 monthly plan as a normal, ongoing paid subscription.
  const pausedBilling={...subscription,
    pause_collection:{behavior:'void',resumes_at:null}};
  const paused=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sub:pausedBilling}).fetchImpl
  });
  assert.equal(paused.status,'PAID_CHECKOUT_REVIEW_REQUIRED');
  assert.equal(paused.paidHeldCount,1);
  assert.equal(paused.eligibleProfileCount,0);
  const pausedPrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sub:pausedBilling}).fetchImpl
  });
  assert.equal(pausedPrivate.status,'CHECKOUT_REVIEW_REQUIRED');
  assert.deepEqual(pausedPrivate.privateAssociations,[]);
  // A valid paid profile must not mask another already-paid checkout whose
  // subscription was canceled before the readback. Hold the entire receipt.
  const heldSubId='sub_sandbox_cancelled_fixture';
  const heldCustomerId='cus_sandbox_cancelled_fixture';
  const heldSession={...checkout,id:'cs_test_sandbox_cancelled_fixture',
    subscription:heldSubId,customer:heldCustomerId};
  const mixed=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',fetchImpl:provider({
      sessions:[checkout,heldSession],
      extraSubscriptions:{[heldSubId]:{...subscription,id:heldSubId,
        customer:heldCustomerId,status:'canceled'}}
    }).fetchImpl
  });
  assert.equal(mixed.completedSessionCount,2);
  assert.equal(mixed.paidSessionCount,2);
  assert.equal(mixed.eligibleProfileCount,1);
  assert.equal(mixed.paidHeldCount,1);
  assert.equal(mixed.status,'PAID_CHECKOUT_REVIEW_REQUIRED');
  // A completed but unpaid Checkout cannot hide behind a second paid,
  // valid Checkout and produce a misleading accepted aggregate receipt.
  const unpaidSession={...checkout,
    id:'cs_test_sandbox_unpaid_second',
    subscription:'sub_sandbox_unpaid_second',
    customer:'cus_sandbox_unpaid_second',
    payment_status:'unpaid'};
  const mixedPayment=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[checkout,unpaidSession]}).fetchImpl
  });
  assert.equal(mixedPayment.completedSessionCount,2);
  assert.equal(mixedPayment.paidSessionCount,1);
  assert.equal(mixedPayment.eligibleProfileCount,1);
  assert.equal(mixedPayment.heldCount,1);
  assert.equal(mixedPayment.status,'CHECKOUT_REVIEW_REQUIRED');
  const unpaidOnly=await sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[unpaidSession]}).fetchImpl
  });
  assert.equal(unpaidOnly.status,'CHECKOUT_REVIEW_REQUIRED');
  const mixedPaymentPrivate=await sandbox.privateNoSendHandoff({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[checkout,unpaidSession]}).fetchImpl
  });
  assert.equal(mixedPaymentPrivate.status,'CHECKOUT_REVIEW_REQUIRED');
  assert.deepEqual(mixedPaymentPrivate.privateAssociations,[]);
  assert.equal(mixed.externalSendCalls,0);
  assert.equal(mixed.paymentMutations,0);
  for(const sub of [
    {...subscription,customer:'cus_other'},
    {...subscription,livemode:true},
    // A subscription-items page with an unseen second price cannot be treated
    // as a verified single $79/month line; neither can altered quantity.
    {...subscription,items:{...subscription.items,has_more:true}},
    {...subscription,items:{...subscription.items,
      data:[{quantity:2,price:{id:sandbox.TEST_PRICE}}]}},
    {...subscription,items:{...subscription.items,
      data:[{quantity:1,price:{id:'price_other'}}]}}
  ]){
    await assert.rejects(sandbox.snapshot({
      key:'rk_test_synthetic_fixture',fetchImpl:provider({sub}).fetchImpl
    }),/SANDBOX_(?:PAID_PROFILE_REVIEW_REQUIRED|SUBSCRIPTION_READBACK_INVALID)/);
  }
  for(const bad of [
    {...checkout,payment_link:null},
    {...checkout,livemode:true},
    {...checkout,subscription:null},
    {...checkout,custom_fields:[]}
  ]){
    await assert.rejects(sandbox.snapshot({
      key:'rk_test_synthetic_fixture',fetchImpl:provider({sessions:[bad]}).fetchImpl
    }),/SANDBOX_(?:CHECKOUT_IDENTITY_INVALID|SUBSCRIPTION_LINK_INVALID|PAID_PROFILE_REVIEW_REQUIRED|CHECKOUT_PREFERENCE_FIELDS_INVALID)/);
  }
  await assert.rejects(sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[checkout,checkout]}).fetchImpl
  }),/SANDBOX_CHECKOUT_IDENTITY_INVALID/);
  for(const linkValue of [
    {...link,active:false},
    {...link,livemode:true},
    {...link,metadata:{...link.metadata,environment:'live'}},
    {...link,custom_fields:link.custom_fields.slice(1)}
  ]){
    await assert.rejects(sandbox.snapshot({
      key:'rk_test_synthetic_fixture',fetchImpl:provider({linkValue}).fetchImpl
    }),/SANDBOX_PAYMENT_LINK_CONTRACT_INVALID/);
  }
  await assert.rejects(sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({items:{...lineItems,data:[{...lineItems.data[0],
      price:{...lineItems.data[0].price,unit_amount:7800}}]}}).fetchImpl
  }),/SANDBOX_PRICE_CONTRACT_INVALID/);
  await assert.rejects(sandbox.snapshot({
    key:'rk_test_synthetic_fixture',
    fetchImpl:provider({sessions:[],hasMore:true}).fetchImpl
  }),/SANDBOX_PAGE_CURSOR_MISSING/);
  let calls=0;
  await assert.rejects(sandbox.snapshot({
    key:'rk_live_never_allowed',fetchImpl:async()=>{calls++}
  }),/SANDBOX_RESTRICTED_READ_KEY_REQUIRED/);
  assert.equal(calls,0);
  await assert.rejects(sandbox.read('/v1/charges','rk_test_synthetic_fixture',
    async()=>{calls++}),/SANDBOX_READ_ENDPOINT_NOT_ALLOWED/);
  assert.equal(calls,0);
  console.log('Stripe sandbox read-only hosted-link acceptance negative controls passed.');
}
if(require.main===module)run().catch(err=>{console.error(err);process.exitCode=1});
module.exports={run};
