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
  assert(html.includes('Online requests are securely stored for manual review'));
  assert(html.includes('data-trial-success'));
  assert(html.includes('name="email" type="email"'));
  assert(html.includes('No card or automatic paid upgrade'));
  assert(html.includes("form-action 'none'"));
  assert(!/<form[^>]*action=/i.test(html));
  assert(/name=["']email["']/i.test(html),'online requests must provide an email for manual reply');
  assert(terms.toLowerCase().includes('no card'));
  assert(terms.includes('never upgrades automatically'));
  assert(terms.includes('10-business pilot limit'));
  assert(terms.includes('first nonempty report'));
  assert(terms.includes('Provider acceptance does not guarantee inbox delivery'));
  assert(!/\bstripe\b/i.test(scriptWithoutNodeImports()));
  function scriptWithoutNodeImports(){return fs.readFileSync(require.resolve('../trial-request'),'utf8');}
});


test('1,000 simulated customer full lifecycles produce source-bound first and weekly reports, never real sends',()=>{
  const simulation=require('./trial-customer-simulation');
  const research=require('./curated-research-ledger');
  const boroughs=['Manhattan','Brooklyn','Queens','Bronx','Staten Island'];
  let simulated=0, reports=0, failed=0, unsupportedUpgrade=0, noSend=0;
  for(let world=0;world<500;world++){
    const borough=boroughs[world%boroughs.length], observedAt='2026-10-27T10:00:00.000Z';
    const candidates=Array.from({length:6},(_,i)=>{
      const id=String(50000000+world*10+i);
      return {entityId:'CAMIS:'+id,camis:id,
        canonicalName:'FICTIONAL Restaurant '+world+'-'+i,address:(10+i)+' TEST STREET',
        borough,lifecycleStage:'JUST FILED',sourceSystems:['DOHMH'],
        acceptedCorroboration:[],rejectedCorroboration:[],commercialEvidence:[],
        sourceFirstEffectiveAt:'2026-10-26T08:00:00.000Z',
        sourceLatestEffectiveAt:'2026-10-26T08:00:00.000Z',
        deliverySuppressed:false,crossCamisOperationalConflicts:[]};
    });
    const sourceObservations=Object.fromEntries(research.REQUIRED_SOURCES.map(key=>[key,{
      observationId:'OBS:FICTIONAL:'+key+':'+world,observedAt,
      state:'COMPLETE_NONEMPTY',supportsAbsenceConclusion:true,sourceFresh:true,
      transportOk:true,publisherCount:6,fetchedCount:6
    }]));
    const graph={runnerVersion:'PermitPlate-current-graph-v1.0.0',observedAt,
      graphState:'COMPLETE',graphDigest:research.hash(candidates),sourceObservations,
      metrics:{candidateCount:6},knownRegressionChecks:{passed:true},candidates,passed:true};
    graph.artifactFingerprint=research.graphFingerprint(graph);
    const before=graph.artifactFingerprint,result=simulation.simulate(graph);
    assert.equal(graph.artifactFingerprint,before);
    assert.equal(result.scenarios.length,2);
    assert.equal(result.controls.realProviderCalls,0);
    assert.equal(result.controls.realMessagesSent,0);
    assert.equal(result.controls.realPaymentsCreated,0);
    assert.equal(result.controls.commercialProofEstablished,false);
    for(const scenario of result.scenarios){
      simulated++;
      assert.equal(scenario.lifecycle.reportCount,2);
      assert.equal(scenario.lifecycle.repeatedSignalCount,0);
      assert.equal(scenario.lifecycle.testReviewRejectedInLive,true);
      assert.equal(scenario.lifecycle.automaticBilling,false);
      assert.equal(scenario.lifecycle.realMessagesSent,0);
      assert.equal(scenario.lifecycle.realPaymentsCreated,0);
      assert.equal(scenario.lifecycle.noMatchesStartsClock,false);
      assert.equal(scenario.lifecycle.secondReportExtendsTrial,false);
      assert.equal(scenario.lifecycle.expiredTrialBlocked,true);
      reports+=2;
      for(const packet of [scenario.firstBrief,scenario.weeklyBrief]){
        assert.match(packet.subject,/^\[TEST SIMULATION\]/);
        assert.match(packet.html,/not a real customer report/);
        assert.match(packet.html,/No card, automatic charge or automatic paid upgrade/);
        assert(packet.signals.every(x=>x.borough===borough));
        assert(!packet.html.includes('<strong>JUST FILED</strong>'));
      }
      for(const feedback of [scenario.firstFeedback,scenario.weeklyFeedback]){
        assert.equal(feedback.criteria.sourceAccuracy.result,'MATCHES_INPUT_SNAPSHOT');
        assert.equal(feedback.criteria.territory.result,'MATCH');
        assert.equal(feedback.criteria.upgradeTerms.result,'CLEAR');
        assert.equal(feedback.actualConversion,false);
        assert.equal(feedback.actualSatisfactionMeasured,false);
        if(feedback.simulatedUpgradeDecision!=='CONSIDER_ONLY_AFTER_REAL_VALUE_VALIDATION')unsupportedUpgrade++;
      }
      noSend+=Number(scenario.lifecycle.realMessagesSent===0);
    }
  }
  assert.equal(simulated,1000);
  assert.equal(reports,2000);
  assert.equal(noSend,1000);
  assert.equal(failed,0);
  console.log(JSON.stringify({kind:'FICTIONAL_COMPLETE_TRIAL_LIFECYCLES',
    simulatedCustomers:simulated,firstAndWeeklyReports:reports,
    sourceTerritories:boroughs.length,sourceCategoryPersonas:2,
    noRealSends:noSend,realPayments:0,actualCustomerSatisfactionMeasured:0,
    simulatedUpgradeDeferOrDeclineAssessments:unsupportedUpgrade}));
});
