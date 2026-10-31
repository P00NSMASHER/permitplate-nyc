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
test('3.0 local scope explorer reflects supported categories and territories without inventing leads',()=>{
  const plans=new Set();
  for(const category of request.categories){
    for(const territory of request.territories){
      const plan=request.scopePreview(category,territory);
      assert(plan&&plan.scope&&plan.focus&&plan.copy);
      assert(plan.copy.includes('no card or automatic paid upgrade'));
      assert(plan.copy.includes('no-matches note does not start the 14-day clock'));
      assert(plan.copy.includes('source-linked'));
      assert(!/buyer@|owner@|password|customer identity/i.test(plan.copy));
      plans.add(plan.scope);
    }
  }
  assert.equal(plans.size,96,'All 8 categories x 12 territories should be distinct');
  assert.equal(request.scopePreview('malicious','Brooklyn'),null);
  assert.equal(request.scopePreview('equipment','UnknownCity'),null);
  const page=fs.readFileSync(__dirname+'/trial.html','utf8');
  assert(page.includes('name="permitplate-product-version" content="3.0"'));
  assert(page.includes('data-trial-scope'));
  assert(page.includes('data-trial-scope-copy'));
  assert(page.includes('No-match updates do not start the 14-day clock'));
  assert(!/\b(?:localStorage|sessionStorage|sendBeacon)\b/.test(fs.readFileSync(__dirname+'/trial-request.js','utf8')));
});
test('public trial options match supported fulfillment categories and territories',()=>{
  assert.deepEqual(request.categories,[...offer.CATEGORY_VALUES]);
  assert.deepEqual(request.territories,[...offer.TERRITORY_VALUES]);
  const html=fs.readFileSync(__dirname+'/trial.html','utf8');
  for(const choice of [...request.categories,...request.territories])assert(html.includes('value="'+choice+'"'));
  assert(html.includes('never charge or enroll you automatically'));
  assert(html.includes('data-trial-success'));
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
