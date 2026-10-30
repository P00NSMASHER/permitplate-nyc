'use strict';

// Read-only operational evidence renewal. No customer/session queries, writes,
// checkout creation, delivery or changes to provider permissions are possible.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const site=require('../build-site');
const stripe=require('./stripe-readonly-checkout-poll');

const VERSION='PermitPlate-external-launch-evidence-v1.5.0';
const ACCOUNT='acct_1UFCRjDPW8riWrxQ';
const PORTAL='bpc_1UIjo3DPW8riWrxQI0WUAWaU';
const SITE='https://p00nsmasher.github.io/permitplate-nyc/';
const MAX_BYTES=4*1024*1024;
const STRIPE_URLS=Object.freeze([
  stripe.ORIGIN+'/v1/payment_links/'+stripe.LINK,
  stripe.ORIGIN+'/v1/payment_links/'+stripe.LINK+'/line_items?limit=100',
  stripe.ORIGIN+'/v1/billing_portal/configurations/'+PORTAL
]);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function localPublicFiles(){
  const errors=site.validateAllowlist();
  if(errors.length)throw Error('EXTERNAL_LAUNCH_PUBLIC_BOUNDARY_INVALID');
  return site.PUBLIC_FILES.map(file=>{
    const bytes=fs.readFileSync(path.join(site.ROOT,file));
    return {path:file,bytes:bytes.length,sha256:digest(bytes)};
  });
}
function validLocalFiles(files){
  return Array.isArray(files)&&files.length>0&&files.length<=64&&
    new Set(files.map(x=>x?.path)).size===files.length&&files.every(x=>
      x&&typeof x.path==='string'&&/^[A-Za-z0-9_./-]+$/.test(x.path)&&
      !x.path.startsWith('/')&&!x.path.split('/').includes('..')&&
      Number.isSafeInteger(x.bytes)&&x.bytes>0&&x.bytes<=MAX_BYTES&&
      /^[a-f0-9]{64}$/.test(x.sha256));
}
function safeTime(value){
  const stamp=Date.parse(String(value||''));
  return Number.isFinite(stamp)?new Date(stamp).toISOString():null;
}
async function readBytes(url,{key,fetchImpl,allowedUrls}){
  if(!allowedUrls.has(url))throw Error('EXTERNAL_LAUNCH_ENDPOINT_NOT_ALLOWED');
  const provider=STRIPE_URLS.includes(url);
  if(provider&&(!key||!/^rk_live_[A-Za-z0-9_]+$/.test(key))){
    throw Error('EXTERNAL_LAUNCH_STRIPE_READ_CREDENTIAL_MISSING');
  }
  let response;
  try{
    response=await fetchImpl(url,{method:'GET',redirect:'error',
      headers:provider?{Authorization:'Bearer '+key}:{},
      signal:AbortSignal.timeout(15000)});
  }catch{throw Error('EXTERNAL_LAUNCH_READ_TRANSPORT_FAILURE');}
  if(!response?.ok){
    const status=Number.isInteger(response?.status)?response.status:0;
    throw Error('EXTERNAL_LAUNCH_'+(provider?'STRIPE':'SITE')+'_HTTP_'+status);
  }
  if(Number(response.headers?.get('content-length')||0)>MAX_BYTES){
    throw Error('EXTERNAL_LAUNCH_RESPONSE_TOO_LARGE');
  }
  const reader=response.body?.getReader();
  if(!reader)throw Error('EXTERNAL_LAUNCH_READ_RESPONSE_INVALID');
  const parts=[];let size=0;
  try{
    for(;;){
      const item=await reader.read();
      if(item.done)break;
      size+=item.value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error('EXTERNAL_LAUNCH_RESPONSE_TOO_LARGE');}
      parts.push(Buffer.from(item.value));
    }
  }catch(error){
    if(error.message==='EXTERNAL_LAUNCH_RESPONSE_TOO_LARGE')throw error;
    throw Error('EXTERNAL_LAUNCH_READ_RESPONSE_INVALID');
  }finally{reader.releaseLock();}
  return Buffer.concat(parts,size);
}
async function readJson(url,options){
  const bytes=await readBytes(url,options);
  try{
    const value=JSON.parse(bytes.toString('utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
    return value;
  }catch{throw Error('EXTERNAL_LAUNCH_JSON_INVALID');}
}
async function refresh(options={}){
  const sourceCommit=options.sourceCommit;
  if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('EXTERNAL_LAUNCH_SOURCE_SHA_REQUIRED');
  const files=options.publicFiles||localPublicFiles();
  if(!validLocalFiles(files))throw Error('EXTERNAL_LAUNCH_PUBLIC_MANIFEST_INVALID');
  const observedAt=safeTime(options.now||new Date().toISOString());
  if(!observedAt)throw Error('EXTERNAL_LAUNCH_TIMESTAMP_INVALID');
  const expectedFingerprint=site.publicSourceFingerprint(files);
  const allowedUrls=new Set([...STRIPE_URLS,SITE+'build-info.json',...files.map(x=>SITE+x.path)]);
  const reads={key:options.key,fetchImpl:options.fetchImpl||fetch,allowedUrls};
  const link=await readJson(STRIPE_URLS[0],reads);
  if(link.object!=='payment_link'||link.id!==stripe.LINK||link.livemode!==true||
      link.active!==true||link.metadata?.project!=='permitplate_nyc'||
      link.metadata?.plan!=='monthly_79')throw Error('EXTERNAL_LAUNCH_PAYMENT_LINK_INVALID');
  if(!stripe.validRequiredDropdowns(link.custom_fields)){
    throw Error('EXTERNAL_LAUNCH_CHECKOUT_PREFERENCES_INVALID');
  }
  const prices=await readJson(STRIPE_URLS[1],reads);
  if(!stripe.validPriceContract(prices))throw Error('EXTERNAL_LAUNCH_PRICE_CONTRACT_INVALID');
  const portal=await readJson(STRIPE_URLS[2],reads);
  if(portal.object!=='billing_portal.configuration'||portal.id!==PORTAL||
      portal.livemode!==true||portal.active!==true||portal.is_default!==true||
      portal.features?.subscription_cancel?.enabled!==true||
      portal.features.subscription_cancel.mode!=='at_period_end'){
    throw Error('EXTERNAL_LAUNCH_CUSTOMER_PORTAL_INVALID');
  }
  const build=await readJson(SITE+'build-info.json',reads);
  const builtAt=safeTime(build.builtAt);
  if(build.buildInfoVersion!=='PermitPlate-public-build-v1.0.0'||
      !/^[a-f0-9]{40}$/.test(build.sourceCommit||'')||!builtAt||
      Date.parse(builtAt)>Date.parse(observedAt)||
      build.publicFileCount!==files.length||!validLocalFiles(build.files)||
      build.files.length!==files.length||
      build.publicSourceFingerprint!==expectedFingerprint||
      site.publicSourceFingerprint(build.files)!==expectedFingerprint){
    throw Error('EXTERNAL_LAUNCH_PUBLIC_BUILD_IDENTITY_MISMATCH');
  }
  const indexed=new Map(build.files.map(x=>[x.path,x]));
  for(const file of files){
    const actual=indexed.get(file.path);
    if(!actual||actual.bytes!==file.bytes||actual.sha256!==file.sha256){
      throw Error('EXTERNAL_LAUNCH_PUBLIC_MANIFEST_MISMATCH');
    }
    // Verify actual published bytes, not only a self-reported build hash.
    const bytes=await readBytes(SITE+file.path,reads);
    if(bytes.length!==file.bytes||digest(bytes)!==file.sha256){
      throw Error('EXTERNAL_LAUNCH_PUBLIC_BYTES_MISMATCH');
    }
  }
  // Construct a fresh receipt from successful reads only. Never copy/re-date
  // committed flags, private customers, provider bodies or historical proof.
  return {
    evidenceVersion:VERSION,observedAt,sourceCommit,
    stripe:{account:ACCOUNT,paymentLinkId:stripe.LINK,priceId:stripe.PRICE,
      accountBinding:'EXACT_EXISTING_PAYMENT_LINK_AND_PORTAL_IDS',
      paymentLinkActiveVerified:true,checkoutPreferenceFieldsVerified:true,
      checkoutPreferenceFieldKeys:['category','starter','territory'],
      preferenceCaptureMode:'STRIPE_CUSTOM_FIELDS',
      customerPortalConfigurationId:PORTAL,customerPortalActiveVerified:true,
      customerPortalCancellationMode:'at_period_end',observedAt,
      reason:'Fresh restricted-key GETs of the exact existing live Payment Link, recurring price and default cancellation portal; no customer data or provider writes.'},
    githubPages:{canonicalUrl:SITE,enabled:true,
      verifiedPublicBuildCommit:sourceCommit,
      verifiedPublicSourceFingerprint:expectedFingerprint,
      liveVerifiedCommit:build.sourceCommit,livePublicSourceFingerprint:expectedFingerprint,
      productionDeployVerified:true,publicFileCount:files.length,observedAt,
      reason:'Fresh HTTPS build identity and every allowlisted public file matched the exact checked-out public bytes. Backend-only commits need not redeploy unchanged public assets.'},
    customerProof:{realPaidSubscriberEndToEndVerified:false,
      providerBackedDeliveryVerified:false,
      nextRunDuplicateSuppressionVerifiedForRealSubscriber:false,
      reason:'Operational configuration renewal does not inspect or establish genuine paid-customer delivery or later duplicate suppression.'},
    externalSendCalls:0,paymentMutations:0,privateCustomerDataRead:false
  };
}
module.exports={VERSION,ACCOUNT,PORTAL,SITE,STRIPE_URLS,MAX_BYTES,digest,
  localPublicFiles,validLocalFiles,readBytes,refresh};
