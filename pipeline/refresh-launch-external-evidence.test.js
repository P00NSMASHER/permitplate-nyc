'use strict';
const assert=require('node:assert/strict');
const refresh=require('./refresh-launch-external-evidence');
const build=require('../build-site');
const stripe=require('./stripe-readonly-checkout-poll');
const SHA='a'.repeat(40),NOW='2026-10-22T02:00:00.000Z';
const SECRET='rk_live_SYNTHETICONLY';
const page=Buffer.from('<!doctype html><title>Source-bound fixture</title>');
const files=[{path:'index.html',bytes:page.length,sha256:refresh.digest(page)}];
function fixture(){
  const dropdown=(key,values)=>({key,type:'dropdown',optional:false,
    dropdown:{options:values.map(value=>({label:value,value}))}});
  const link={object:'payment_link',id:stripe.LINK,active:true,livemode:true,
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},custom_fields:[
      dropdown('category',['POS','Insurance']),
      dropdown('territory',['Manhattan','ALL NYC']),dropdown('starter',['yes','no'])]};
  const prices={object:'list',has_more:false,data:[{quantity:1,price:{
    id:stripe.PRICE,currency:'usd',unit_amount:7900,
    recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]};
  const portal={object:'billing_portal.configuration',id:refresh.PORTAL,
    livemode:true,active:true,is_default:true,
    features:{subscription_cancel:{enabled:true,mode:'at_period_end'}}};
  const identity={buildInfoVersion:'PermitPlate-public-build-v1.0.0',
    sourceCommit:'b'.repeat(40),builtAt:'2026-10-21T23:00:00.000Z',
    publicFileCount:1,publicSourceFingerprint:build.publicSourceFingerprint(files),files};
  return new Map([
    [refresh.STRIPE_URLS[0],link],[refresh.STRIPE_URLS[1],prices],
    [refresh.STRIPE_URLS[2],portal],[refresh.SITE+'build-info.json',identity],
    [refresh.SITE+'index.html',page]
  ]);
}
function reader(responses,calls=[]){
  return async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert(options.signal instanceof AbortSignal);
    if(refresh.STRIPE_URLS.includes(url))assert.equal(options.headers.Authorization,'Bearer '+SECRET);
    else assert.deepEqual(options.headers,{});
    assert(responses.has(url),'No unlisted endpoint may be queried');
    const value=responses.get(url);
    return value instanceof Response?value:new Response(Buffer.isBuffer(value)?value:JSON.stringify(value));
  };
}
async function execute(responses=fixture(),extra={}){
  return refresh.refresh({key:SECRET,sourceCommit:SHA,now:NOW,
    publicFiles:files,fetchImpl:reader(responses),...extra});
}
async function main(){
  const calls=[],response=await execute(fixture(),{fetchImpl:reader(fixture(),calls)});
  assert.equal(response.observedAt,NOW);
  assert.equal(response.sourceCommit,SHA);
  assert.equal(response.githubPages.liveVerifiedCommit,'b'.repeat(40));
  assert.equal(response.githubPages.verifiedPublicSourceFingerprint,build.publicSourceFingerprint(files));
  assert.equal(response.stripe.customerPortalCancellationMode,'at_period_end');
  assert.equal(response.externalSendCalls,0);assert.equal(response.paymentMutations,0);
  assert.equal(response.privateCustomerDataRead,false);
  assert(Object.entries(response.customerProof).filter(([key])=>key!=='reason').every(([,value])=>value===false));
  assert.equal(calls.length,5);
  assert(!JSON.stringify(response).includes(SECRET));
  assert(calls.every(x=>!/(checkout\/sessions|subscriptions\/|customers\/|emails)/.test(x.url)));

  const cases=[
    [0,x=>x.active=false,/PAYMENT_LINK_INVALID/],
    [0,x=>x.livemode=false,/PAYMENT_LINK_INVALID/],
    [0,x=>x.id='plink_other',/PAYMENT_LINK_INVALID/],
    [0,x=>x.metadata.project='another_business',/PAYMENT_LINK_INVALID/],
    [0,x=>x.custom_fields.pop(),/CHECKOUT_PREFERENCES_INVALID/],
    [0,x=>x.custom_fields[0].optional=true,/CHECKOUT_PREFERENCES_INVALID/],
    [1,x=>x.data[0].price.unit_amount=14900,/PRICE_CONTRACT_INVALID/],
    [1,x=>x.data[0].price.recurring.interval='year',/PRICE_CONTRACT_INVALID/],
    [2,x=>x.id='bpc_other',/CUSTOMER_PORTAL_INVALID/],
    [2,x=>x.livemode=false,/CUSTOMER_PORTAL_INVALID/],
    [2,x=>x.active=false,/CUSTOMER_PORTAL_INVALID/],
    [2,x=>x.is_default=false,/CUSTOMER_PORTAL_INVALID/],
    [2,x=>x.features.subscription_cancel.enabled=false,/CUSTOMER_PORTAL_INVALID/],
    [2,x=>x.features.subscription_cancel.mode='immediately',/CUSTOMER_PORTAL_INVALID/]
  ];
  for(const [index,mutate,error] of cases){
    const records=fixture();mutate(records.get(refresh.STRIPE_URLS[index]));
    await assert.rejects(execute(records),error);
  }
  for(const change of [
    x=>x.publicSourceFingerprint='c'.repeat(64),
    x=>x.sourceCommit='local',x=>x.builtAt='2027-01-01T00:00:00Z',
    x=>x.publicFileCount=2,
    x=>x.files=[{...files[0],path:'../private.json'}]
  ]){
    const records=fixture();change(records.get(refresh.SITE+'build-info.json'));
    await assert.rejects(execute(records),/PUBLIC_BUILD_IDENTITY_MISMATCH/);
  }
  const tampered=fixture();tampered.set(refresh.SITE+'index.html',Buffer.from('stale deployed content'));
  await assert.rejects(execute(tampered),/PUBLIC_BYTES_MISMATCH/);
  const denied=fixture();denied.set(refresh.STRIPE_URLS[2],new Response('private provider detail '+SECRET,{status:403}));
  await assert.rejects(execute(denied),error=>error.message==='EXTERNAL_LAUNCH_STRIPE_HTTP_403'&&!String(error).includes(SECRET));
  await assert.rejects(execute(fixture(),{key:'sk_live_disallowed'}),/READ_CREDENTIAL_MISSING/);
  await assert.rejects(execute(fixture(),{sourceCommit:'main'}),/SOURCE_SHA_REQUIRED/);
  await assert.rejects(execute(fixture(),{fetchImpl:async()=>{throw Error(SECRET)}}),error=>error.message==='EXTERNAL_LAUNCH_READ_TRANSPORT_FAILURE');
  const large=fixture();large.set(refresh.STRIPE_URLS[0],new Response('{}',{headers:{'content-length':String(refresh.MAX_BYTES+1)}}));
  await assert.rejects(execute(large),/RESPONSE_TOO_LARGE/);
  const staleClaims=await execute(fixture(),{externalEvidence:{observedAt:'2020-01-01',
    customerProof:{realPaidSubscriberEndToEndVerified:true}}});
  assert.equal(staleClaims.customerProof.realPaidSubscriberEndToEndVerified,false);
  console.log('External launch refresh: live-read contract, adverse boundaries, byte parity, redaction and NO SEND passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
