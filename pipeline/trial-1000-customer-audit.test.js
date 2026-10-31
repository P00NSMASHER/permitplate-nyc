'use strict';
// 1,000 fictional customers. The production website has a mailto draft only.
// No HTTP requests, email sends, billing calls, or private LIVE state writes.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const request=require('../trial-request');
const trials=require('./free-trial');

const COUNT=1000, COHORT_SIZE=10;
const requestedAt='2026-10-27T08:00:00.000Z';
const approvedAt='2026-10-27T09:00:00.000Z';
const inspectedAt='2026-10-27T09:01:00.000Z';
function persona(i){
  const id=String(i).padStart(4,'0');
  return {
    businessName:'FICTIONAL Trial Vendor '+id,
    website:'https://www.audit-vendor-'+id+'.example.com/service/nyc?utm_source=simulation',
    category:request.categories[i%request.categories.length],
    territory:request.territories[Math.floor(i/request.categories.length)%request.territories.length],
    recipientEmail:'fictional-buyer-'+id+'@example.com'
  };
}

test('one thousand fictional customer drafts preserve scope without any send or payment',()=>{
  const seen=new Set(), combo=new Set();
  for(let i=0;i<COUNT;i++){
    const p=persona(i), draft=request.buildRequest(p);
    const uri=new URL(draft.mailto);
    assert.equal(uri.protocol,'mailto:');
    assert.equal(uri.pathname,'jay@retallyrecovery.com');
    assert.equal(uri.searchParams.get('subject'),'PermitPlate free-trial request');
    assert.equal(uri.searchParams.get('body'),draft.body);
    assert(draft.body.includes('Business: '+p.businessName));
    assert(draft.body.includes('Business website: '+new URL(p.website).origin));
    assert(draft.body.includes('Vendor category: '+p.category));
    assert(draft.body.includes('NYC territory: '+p.territory));
    assert(draft.body.includes('No card or automatic paid upgrade.'));
    assert(!draft.body.includes('utm_source=simulation'));
    assert(!draft.body.includes('fictional-buyer-'+String(i).padStart(4,'0')+'@example.com'));
    assert(!/\r/.test(draft.body));
    seen.add(p.businessName);
    combo.add(p.category+'|'+p.territory);
  }
  assert.equal(seen.size,COUNT);
  assert.equal(combo.size,request.categories.length*request.territories.length);
  console.log(JSON.stringify({kind:'FICTIONAL_DRAFTS',personas:COUNT,categoryTerritoryPairs:combo.size,
    actualEmailsSent:0,actualPaymentsCreated:0,liveRequestsSubmitted:0}));
});

test('1,000 different test-only admissions in 100 independent cohorts; real pilot limit remains ten',()=>{
  const cohorts=Array.from({length:COUNT/COHORT_SIZE},()=>trials.createRegistry('TEST'));
  const seenIds=new Set();
  for(let i=0;i<COUNT;i++){
    const p=persona(i), bucket=Math.floor(i/COHORT_SIZE);
    const result=trials.enroll(cohorts[bucket],{
      businessName:p.businessName,
      businessDomain:request.publicDomain(new URL(p.website).hostname),
      recipientEmail:p.recipientEmail,
      category:p.category,territory:p.territory,requestedAt
    },{ownerApproved:true,reference:'FICTIONAL_SCOPE_ONLY_'+i,approvedAt});
    assert.equal(result.status,'WAITING_FIRST_REPORT');
    assert.equal(result.paymentRequired,false);
    assert(!seenIds.has(result.trialId));
    seenIds.add(result.trialId);
    const access=trials.access(result.registry,result.trialId,inspectedAt);
    assert.equal(access.trialStatus,'WAITING_FIRST_REPORT');
    assert.equal(access.profile.stripeSubscriptionId,null);
    assert.equal(access.profile.priceId,null);
    assert.equal(access.profile.maxSignals,5);
    assert.equal(result.registry.trials.at(-1).firstAcceptedAt,null);
    assert.equal(result.registry.trials.at(-1).expiresAt,null);
    assert.deepEqual(result.registry.trials.at(-1).deliveries,[]);
    cohorts[bucket]=result.registry;
  }
  assert.equal(seenIds.size,COUNT);
  let fullCohorts=0;
  for(const [i,registry] of cohorts.entries()){
    trials.validate(registry);
    assert.equal(registry.trials.length,COHORT_SIZE);
    assert.throws(()=>trials.enroll(registry,{
      businessName:'Overflow '+i,businessDomain:'overflow-'+i+'.example.com',
      recipientEmail:'overflow-'+i+'@example.com',
      category:'equipment',territory:'Brooklyn',requestedAt
    },{ownerApproved:true,reference:'FICTIONAL_OVERFLOW',approvedAt}),/TRIAL_COHORT_FULL/);
    fullCohorts++;
  }
  const cancelled=trials.cancel(cohorts[0],cohorts[0].trials[0].trialId,inspectedAt);
  assert.equal(cancelled.trials.length,10,'cancellation does not create an extra trial slot');
  assert.throws(()=>trials.enroll(cancelled,{
    businessName:'After cancellation',businessDomain:'replacement.example.com',
    recipientEmail:'replacement@example.com',category:'equipment',territory:'Brooklyn',requestedAt
  },{ownerApproved:true,reference:'FICTIONAL_OVERFLOW',approvedAt}),/TRIAL_COHORT_FULL/);
  console.log(JSON.stringify({kind:'FICTIONAL_ADMISSIONS',personas:COUNT,
    independentTestCohorts:fullCohorts,capacityPerRealPilot:10,
    rejectedEleventhRequests:fullCohorts,liveTrialEntriesCreated:0,liveMessagesSent:0}));
});

test('1,000 client-side form interactions only reveal an explicit mail draft; edits invalidate it',()=>{
  const events={};
  const form={fields:{},reportValidity:()=>true,addEventListener:(event,fn)=>{events[event]=fn;}};
  const link={hidden:true,href:undefined,removeAttribute(name){if(name==='href')this.href=undefined;}};
  const status={textContent:''}, fallback={hidden:true}, body={value:''};
  const elements={'[data-trial-request]':form,'[data-trial-email]':link,
    '[data-trial-status]':status,'[data-trial-fallback]':fallback,'[data-trial-body]':body};
  const doc={querySelector(selector){return elements[selector]||null;}};
  const ctx={window:{document:doc},URL,
    FormData:class{constructor(node){return Object.entries(node.fields);}}};
  const script=fs.readFileSync(require.resolve('../trial-request'),'utf8');
  vm.runInNewContext(script,ctx,{filename:'trial-request.js'});
  assert.equal(typeof events.submit,'function');
  assert.equal(typeof events.input,'function');
  let prevented=0;
  for(let i=0;i<COUNT;i++){
    form.fields=persona(i);
    events.input();
    assert.equal(link.hidden,true);
    assert.equal(link.href,undefined);
    assert.equal(body.value,'');
    events.submit({preventDefault(){prevented++;}});
    assert.equal(link.hidden,false);
    assert.equal(fallback.hidden,false);
    assert.equal(new URL(link.href).protocol,'mailto:');
    assert(body.value.includes(form.fields.businessName));
    assert(status.textContent.includes('has not started'));
    if(i%17===0){
      events.input();
      assert.equal(link.hidden,true);
      assert.equal(link.href,undefined);
      assert.equal(body.value,'');
      assert.equal(status.textContent,'');
    }
  }
  assert.equal(prevented,COUNT);
  console.log(JSON.stringify({kind:'FICTIONAL_FORM_INTERACTIONS',personas:COUNT,
    preventedSilentSubmissions:COUNT,automaticEnrollments:0,realMailtoClicks:0}));
});

test('adversarial input matrix rejects unsafe requests and identity collisions without sending',()=>{
  const p=persona(1);
  const bad=[
    {businessName:'A'},
    {businessName:'Bad\r\nBcc: buyer@example.com'},
    {businessName:' '.repeat(3)},
    {businessName:'x'.repeat(161)},
    {website:'http://www.example.com'},
    {website:'javascript:alert(1)'},
    {website:'https://127.0.0.1/admin'},
    {website:'https://intranet.local'},
    {website:'https://user:password@public.example.com'},
    {website:'https://public.example.com:8443'},
    {website:'https://public.example.com\nBcc:attacker@example.com'},
    {category:'other'},
    {territory:'NewJersey'},
  ];
  for(let i=0;i<260;i++){
    const mutation=bad[i%bad.length];
    assert.throws(()=>request.buildRequest({...p,...mutation}));
  }
  const admitted=trials.enroll(trials.createRegistry('TEST'),{
    businessName:'Audit One',businessDomain:'www.alias.example.com',
    recipientEmail:'original@example.com',category:'equipment',territory:'Brooklyn',requestedAt
  },{ownerApproved:true,reference:'TEST_ONLY',approvedAt});
  for(const alias of ['ALIAS.EXAMPLE.COM','www.alias.example.com','alias.example.com.']){
    assert.throws(()=>trials.enroll(admitted.registry,{
      businessName:'Different name',businessDomain:alias,
      recipientEmail:'another@example.com',category:'pos',territory:'Queens',requestedAt
    },{ownerApproved:true,reference:'TEST_ONLY',approvedAt}),/TRIAL_BUSINESS_ALREADY_ENROLLED/);
  }
  assert.throws(()=>trials.enroll(trials.createRegistry('LIVE'),{
    businessName:'Unauthorized',businessDomain:'unauthorized.example.com',
    recipientEmail:'buyer@example.com',category:'equipment',territory:'Brooklyn',requestedAt
  },{ownerApproved:false,reference:'',approvedAt}),/TRIAL_OWNER_SCOPE_APPROVAL_REQUIRED/);
  console.log(JSON.stringify({kind:'FICTIONAL_NEGATIVE_CASES',unsafeInputRejections:260,
    aliasRejections:3,unapprovedLiveAdmissionsBlocked:1,realPaymentsCreated:0}));
});

test('page, legal terms and source preserve the manual-consent and no-card boundaries',()=>{
  const html=fs.readFileSync(require.resolve('../trial-request').replace(/trial-request\.js$/,'trial.html'),'utf8');
  const terms=fs.readFileSync(require.resolve('../trial-request').replace(/trial-request\.js$/,'terms.html'),'utf8');
  assert(html.includes('data-trial-request'));
  assert(html.includes('data-trial-fallback'));
  assert(html.includes('Review and send email request'));
  assert(html.includes('Nothing is submitted until you send it from your email app'));
  assert(html.includes("form-action 'none'"));
  assert(!/<form[^>]*action=/i.test(html));
  assert(!/name=["']email["']/i.test(html),'sender identity comes from manual email, not web submission');
  assert(terms.includes('No card'));
  assert(terms.includes('never upgrades automatically'));
  assert(terms.includes('10-business pilot limit'));
  assert(terms.includes('first nonempty report'));
  assert(terms.includes('Provider acceptance does not guarantee inbox delivery'));
  assert(!/\bstripe\b/i.test(scriptWithoutNodeImports()));
  function scriptWithoutNodeImports(){return fs.readFileSync(require.resolve('../trial-request'),'utf8');}
});
