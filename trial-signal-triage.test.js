'use strict';
// Offline exhaustive 4.0 local triage QA, no network, customer data, email or payments.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const t=require('./assets/v4-triage');
test('every source/evidence state is buyer-marked, never a verified lead',()=>{
 let count=0;const scopes=new Set();
 for(const category of Object.keys(t.CATEGORIES))for(const territory of Object.keys(t.TERRITORIES)){
   scopes.add(category+'|'+territory);
   for(const event of Object.keys(t.EVENT_STATES))
   for(const corroboration of Object.keys(t.CORROBORATION))
   for(const fit of Object.keys(t.FIT)){
     const r=t.triage({category,territory,kind:'inspection',event,corroboration,fit});
     assert.match(r.report,/BUYER-MARKED, UNVERIFIED/);
     assert.match(r.report,/NO SOURCE WAS FETCHED OR VERIFIED/);
     assert(!/OPENING CONFIRMED|VERIFIED LEAD|SCORE [0-9]+|CUSTOMER APPROVED/.test(r.outcome));
     assert(!/Contact email|Business name|Paid status|Authorization: approved/.test(r.report));
     if(event==='conflict'||corroboration==='conflict')assert.match(r.outcome,/HOLD/);
     if(event==='listing'||event==='unchecked')
       if(corroboration!=='conflict')assert.match(r.outcome,/LISTING ALONE/);
     count++;
   }
 }
 assert.equal(scopes.size,96);
 assert.equal(count,96*4*3*3);
});
test('reconciliation, corroboration and possible fit never claim verified buyer demand',()=>{
 const base={category:'equipment',territory:'Brooklyn',kind:'permit',url:'https://data.cityofnewyork.us/resource/w9ak-ipjd.json'};
 assert.match(t.triage({...base,event:'dated_change',corroboration:'none',fit:'possible'}).outcome,/AWAIT/);
 assert.match(t.triage({...base,event:'dated_change',corroboration:'independent',fit:'possible'}).outcome,/NOT A VERIFIED LEAD/);
 assert.match(t.triage({...base,event:'dated_change',corroboration:'independent',fit:'not_shown'}).outcome,/NOT ESTABLISHED/);
 assert.match(t.triage({...base,event:'dated_change',corroboration:'conflict',fit:'possible'}).outcome,/HOLD/);
});
test('untrusted record URLs cannot become local, credentialed, non-NYC or tracking links',()=>{
 for(const url of [
  'javascript:alert(1)','file:///etc/passwd','http://data.cityofnewyork.us/resource/id',
  'https://data.cityofnewyork.us.evil.test/resource/id',
  'https://evil.example/a',
  'https://user:password@www.nyc.gov/a',
  'https://a.nyc.gov/a?token=secret','https://a.nyc.gov/a#fragment',
  'https://localhost/a','https://127.0.0.1/a',
  'https://www.nyc.gov/a\nBcc:someone@example.com'
 ])assert.throws(()=>t.publicRecordUrl(url),'Expected URL refusal '+url);
 assert.match(t.publicRecordUrl('https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet'),/^https:/);
 assert.match(t.publicRecordUrl('https://data.cityofnewyork.us/resource/w9ak-ipjd.json'),/^https:/);
 assert.equal(t.publicRecordUrl(''),'');
 assert.throws(()=>t.triage({category:'equipment',territory:'Brooklyn',fit:'confirmed'}));
});
test('separate local workbench never modifies the private trial submission contract',()=>{
 const html=fs.readFileSync('trial.html','utf8');
 const js=fs.readFileSync('assets/v4-triage.js','utf8');
 assert(html.includes('name="permitplate-product-version" content="4.0"'));
 assert(html.includes('data-v4-signal hidden'));
 assert(html.includes('data-trial-request'));
 assert(html.includes('data-trial-preview'));
 assert(html.includes('data-v4-copy'));
 assert(!/\b(?:fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|Stripe|sendMail|PaymentIntent)\b/.test(js));
 assert(!/\b(?:POST|autoEnroll|contactProspect)\b/.test(js));
 assert(html.includes('No trial spot is reserved here.'));
});
