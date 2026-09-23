'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('index.html');
const sample=read('sample.html');
const start=read('start.html');
const methodology=read('methodology.html');
const terms=read('terms.html');
const refunds=read('refunds.html');
const siteJs=read('site.js');
const manifest=JSON.parse(read('release-manifest.json'));
const stripeUrl='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';

assert.equal(manifest.checkout.price,'$79/month');
assert.equal(manifest.checkout.launch_mode,'FOUNDER_CURATED_NO_SCORE_V1');
assert.equal(manifest.customer_contract.max_signals_per_brief,10);
assert(manifest.customer_contract.delivery.includes('five business days'));

assert(index.includes('Start for $79/month'));
assert(index.toLowerCase().includes('weekly founder-reviewed brief'));
assert(index.toLowerCase().includes('up to 10 matching signals'));
assert(index.includes('7-day first-payment refund'));
assert(index.includes('/permitplate-nyc/start.html'));
assert(!index.includes(stripeUrl));

assert(start.includes(stripeUrl));
assert(start.includes('Continue to secure checkout'));
assert(start.includes('Choose what you sell and where you work'));
assert(start.includes('One vendor category'));
assert(start.includes('One NYC territory'));
assert(start.toLowerCase().includes('weekly founder-reviewed brief'));
assert(start.includes('7-day first-payment refund'));
assert(!start.includes('paused'));
assert(!start.includes('No payment'));
assert(!start.includes('<form'));
assert(!/netlify/i.test(start));

assert(sample.includes('fictional examples · not current leads'));
assert(sample.includes('Why it matters'));
assert(sample.includes('Evidence included'));
assert(!sample.includes('Equipment priority'));
assert(!sample.includes('<td>100</td>'));

assert(methodology.includes('paid brief does not use or show a model score'));
assert(methodology.includes('at least one direct official source link'));
assert(terms.includes('weekly brief contains up to 10 matching signals'));
assert(terms.includes('prepared within five business days'));
assert(refunds.includes('within seven calendar days'));

for(const stale of [
  'Request launch access','Self-serve checkout remains paused','No payment collected yet',
  'Paid enrollment stays fail-closed','Up to 25 qualifying signals'
]){
  for(const [name,html] of Object.entries({index,start,sample,methodology,terms,refunds})){
    assert.equal(html.includes(stale),false,name+' contains stale launch copy: '+stale);
  }
}

assert(!siteJs.includes(stripeUrl));
assert(!siteJs.includes('client_reference_id'));
assert(siteJs.includes('data-menu-toggle'));
assert(siteJs.includes("fetch('/permitplate-nyc/build-info.json'"));
assert(siteJs.includes('upstream metadata only'));

console.log('PermitPlate payment and conversion regression tests passed.');
