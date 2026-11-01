'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const request=require('./trial-request');
const offer=require('./pipeline/founder-curated-offer');
const build=require('./build-site');
const valid={businessName:'Example & Partners',website:'https://vendor.example.com/path',email:'owner@vendor.example.com',category:'equipment',territory:'Brooklyn'};
test('request remains an explicit email draft with no billing, credential or enrollment payload',()=>{
  const draft=request.buildRequest(valid);
  const url=new URL(draft.mailto);
  assert.equal(url.protocol,'mailto:');assert.equal(url.pathname,'jay@retallyrecovery.com');
  assert.equal(url.searchParams.get('body'),draft.body);
  assert(draft.body.includes('Business: Example & Partners'));
  assert(draft.body.includes('Business website: https://vendor.example.com'));
  assert(draft.body.includes('Contact email: owner@vendor.example.com'));
  assert.equal(request.onlineOrigin({origin:'https://permitplate.retallyrecovery.com'}),true);
  assert.equal(request.onlineOrigin({origin:'http://127.0.0.1:8080'}),false);
  assert(draft.body.includes('$79/month'));
  assert(draft.body.includes('No card or automatic paid upgrade'));
  for(const change of [{website:'javascript:alert(1)'},{website:'https://user:password@vendor.example.com'},
    {website:'https://127.0.0.1'},{website:'https://intranet.local'},{website:'https://host.internal'},
    {businessName:'Bad\nBcc: someone@example.com'},{category:'all'}, {territory:'Philadelphia'}]){
    assert.throws(()=>request.buildRequest({...valid,...change}));
  }
});
test('shared-host paths survive trial requests without leaking tracking or bypassing URL validation',()=>{
  const a={...valid,website:'https://sites.google.com/view/vendor-a/landing?utm_source=campaign#contact'};
  const b={...a,website:'https://sites.google.com/view/vendor-b/landing?ref=private'};
  const normalized=request.normalizeRequest(a,true);
  assert.equal(normalized.website,'https://sites.google.com/view/vendor-a/landing');
  assert.equal(request.normalizeRequest({...a,website:'https://vendor.example.com/?token=abc#section'},true).website,
    'https://vendor.example.com');
  const draftA=request.buildRequest(a),draftB=request.buildRequest(b);
  assert(draftA.body.includes('Business website: https://sites.google.com/view/vendor-a/landing'));
  assert(draftB.body.includes('Business website: https://sites.google.com/view/vendor-b/landing'));
  assert.notEqual(draftA.body,draftB.body,'distinct shared-host business pages must remain distinguishable');
  assert(!draftA.body.includes('utm_source')&&!draftA.body.includes('#contact'));
  assert(!draftB.body.includes('ref=private'));
  assert.throws(()=>request.buildRequest({...a,website:'https://vendor.example.com/'+
    'a'.repeat(701)}),/shorter public business website URL/);
});
test('v3 scope preview offers truthful, public-only plans for every supported territory and category',()=>{
  let checked=0;
  for(const category of request.categories){
    for(const territory of request.territories){
      const input={category,territory,website:'https://private.example',email:'private@example.com'};
      const preview=request.scopePreview(input),copy=request.buildScopeSummary(input);
      assert.equal(preview.category,category);assert.equal(preview.territory,territory);
      assert.equal(preview.maxSignalsPerReport,5);assert.equal(preview.trialDays,14);
      assert.equal(preview.automaticPaidUpgrade,false);
      assert(copy.includes(preview.categoryLabel)&&copy.includes(preview.territoryLabel));
      assert(copy.includes('not a submitted request')&&copy.includes('no automatic upgrade'));
      assert(!copy.includes(input.website)&&!copy.includes(input.email),'Copied scope contains no buyer identity');
      checked++;
    }
  }
  assert.equal(checked,request.categories.length*request.territories.length);
  assert.equal(request.scopePreview({category:'unapproved',territory:'Brooklyn'}),null);
  assert.equal(request.buildScopeSummary({category:'equipment',territory:'Boston'}),null);
});
test('public trial options match supported fulfillment categories and territories',()=>{
  assert.deepEqual(request.categories,[...offer.CATEGORY_VALUES]);
  assert.deepEqual(request.territories,[...offer.TERRITORY_VALUES]);
  const html=fs.readFileSync(__dirname+'/trial.html','utf8');
  for(const choice of [...request.categories,...request.territories])assert(html.includes('value="'+choice+'"'));
  assert(html.includes('never charge or enroll you automatically'));
  assert(html.includes('data-trial-success'));
  assert(html.includes('data-trial-preview'));
  assert(html.includes('data-trial-preview-copy'));
  assert(html.includes('name="permitplate-product-version" content="4.0"'));
  assert(html.includes('name="email" type="email"'));
  assert(html.includes('Send my free-trial request'));
  assert(html.includes('Work email for our reply'));
  assert(html.includes('data-trial-copy'));
  assert(!html.includes('data-trial-consent'));
  assert(html.includes('No card required'));assert(html.includes('No automatic paid upgrade'));
  assert(html.includes('A no-matches note does not start the clock'));
  assert(build.PUBLIC_FILES.includes('trial.html')&&build.PUBLIC_FILES.includes('trial-request.js'));
  assert(!build.PUBLIC_FILES.includes('pipeline/free-trial.js'));
  const js=fs.readFileSync(__dirname+'/trial-request.js','utf8');
  assert(!/\b(?:localStorage|sessionStorage|XMLHttpRequest)\b/.test(js));
  assert(js.includes("root.fetch('/api/trial-request'"));
  assert(js.includes("credentials:'omit'"));
  assert(js.includes("mode:'same-origin'"));
  assert(js.includes("redirect:'error'"));
  assert(!js.includes("root.fetch('https://"));
  assert(js.includes('event.preventDefault()'));
  const transformed=build.standaloneContent('trial.html',Buffer.from(html),build.STANDALONE_SITE_BASE).toString();
  assert(transformed.includes('https://permitplate.retallyrecovery.com/trial'));
  assert(!transformed.includes('/permitplate-nyc/'));
});

test('async trial receipts bind to submitted fields, not later edits or repeated submits',async()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(__dirname+'/trial-request.js','utf8');
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  function harness(){
    const fields={businessName:'Fictional Vendor',website:'https://fictional-vendor.com/',
      email:'owner@fictional-vendor.com',category:'equipment',territory:'Brooklyn',fax:''};
    const events={},pending=[];
    const submitButton={disabled:false,textContent:'Send my free-trial request'};
    const form={hidden:false,querySelector:()=>submitButton,reportValidity:()=>true,
      addEventListener:(event,listener)=>{events[event]=listener;}};
    const link={hidden:true,removeAttribute(name){delete this[name];}};
    const status={textContent:''},fallback={hidden:true},body={value:''};
    const success={hidden:true,querySelector:()=>({focus(){}})};
    const elements={'[data-trial-request]':form,'[data-trial-email]':link,
      '[data-trial-status]':status,'[data-trial-fallback]':fallback,
      '[data-trial-body]':body,'[data-trial-success]':success};
    const window={document:{querySelector:key=>elements[key]||null},
      location:{origin:'https://permitplate.retallyrecovery.com'},navigator:{},
      fetch:(url,options)=>new Promise((resolve,reject)=>{pending.push({url,options,resolve,reject});})};
    class FormDataStub{
      [Symbol.iterator](){return Object.entries(fields)[Symbol.iterator]();}
    }
    vm.runInNewContext(source,{window,FormData:FormDataStub,URL,AbortController,
      setTimeout,clearTimeout},{timeout:1000});
    return {fields,form,submitButton,link,status,fallback,body,success,pending,
      submit:()=>events.submit({preventDefault(){}}),
      edit:(key,value)=>{fields[key]=value;events.input();events.change();}};
  }
  const response={status:202,json:async()=>({status:'RECEIVED_FOR_REVIEW'})};
  const normal=harness();
  normal.submit();await flush();
  assert.equal(normal.pending.length,1);
  normal.pending[0].resolve(response);await flush();await flush();
  assert.equal(normal.form.hidden,true,'unchanged request still shows genuine receipt');
  assert.equal(normal.success.hidden,false);

  const changed=harness();
  changed.submit();await flush();
  assert.equal(changed.submitButton.disabled,true);
  changed.submit();await flush();
  assert.equal(changed.pending.length,1,'repeated Enter cannot queue overlapping POSTs');
  assert.equal(JSON.parse(changed.pending[0].options.body).territory,'Brooklyn');
  changed.edit('territory','Queens');
  changed.pending[0].resolve(response);await flush();await flush();
  assert.equal(changed.form.hidden,false,'edits not sent with earlier POST remain visible');
  assert.equal(changed.success.hidden,true,'no receipt attributed to edited scope');
  assert.match(changed.status.textContent,/Later edits were not sent/);
  assert.equal(changed.submitButton.disabled,false);

  const failed=harness();
  failed.submit();await flush();
  failed.edit('territory','Bronx');
  failed.pending[0].reject(Error('SIMULATED_OFFLINE'));await flush();await flush();
  assert.equal(failed.link.hidden,true,'stale email draft must not reappear');
  assert.equal(failed.fallback.hidden,true,'stale email copy must not reappear');
  assert.equal(failed.body.value,'');
  assert.match(failed.status.textContent,/edited details were not sent/);
  assert.match(failed.status.textContent,/may still be on file/);
  assert.equal(failed.submitButton.disabled,false);
});

test('work-email dot-atom syntax is validated before composing a buyer request',()=>{
  const invalid=['buyer..contact@vendor.example.com','.buyer@vendor.example.com',
    'buyer.@vendor.example.com','a'.repeat(65)+'@vendor.example.com'];
  for(const email of invalid){
    assert.throws(()=>request.normalizeEmail(email,true),/valid work email/,email);
    assert.throws(()=>request.buildRequest({...valid,email}),/valid work email/,email);
  }
  assert.equal(request.normalizeEmail('first.last+sales@vendor.example.com',true),
    'first.last+sales@vendor.example.com');
  assert.equal(request.normalizeEmail('',false),'','optional email remains optional');
});


test('trial browser and private intake agree on domain length, DEL controls and NFC business names',()=>{
  const hugeHost=['a'.repeat(63),'b'.repeat(63),'c'.repeat(63),'d'.repeat(60),'com'].join('.');
  assert.equal(hugeHost.length,256);
  assert.throws(()=>request.normalizeRequest({...valid,website:'https://'+hugeHost},true),
    /public business domain/, 'oversized FQDN must fail before submit, not bounce from private API');
  assert.throws(()=>request.buildRequest({...valid,website:'https://'+hugeHost}),
    /public business domain/, 'offline email path must share the same domain boundary');
  for(const businessName of ['Acme\x7f Partners','AB\x7f']){
    const control=businessName.replace('\x7f','\x7f');
    assert.throws(()=>request.normalizeRequest({...valid,businessName:control},true),
      /business name/, 'DEL character must be blocked before submit');
  }
  const canon=request.normalizeRequest({...valid,businessName:'Cafe\u0301 Supplies'},true);
  assert.equal(canon.businessName,'Caf\u00e9 Supplies'.replace('\u00e9','é'));
  assert.equal(request.normalizeRequest(valid,true).website,'https://vendor.example.com/path');
});
