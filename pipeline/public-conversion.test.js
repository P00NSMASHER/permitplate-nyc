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

assert(index.includes('View $79/month plan'));
assert(index.includes('Paid enrollment is on hold'));
assert(index.toLowerCase().includes('weekly founder-reviewed brief'));
assert(index.toLowerCase().includes('up to 10 matching signals'));
assert(index.includes('First payment refundable through 7 days after first brief is sent'));
assert(index.includes('/permitplate-nyc/start.html'));
assert(!index.includes(stripeUrl));

assert(!start.includes(stripeUrl));
assert.equal(manifest.checkout.public_enrollment,'ON_HOLD');
assert.equal(manifest.checkout.external_saved_payment_link_bypass_remains,true);
assert(start.includes('Request a supervised free trial'));
assert(start.includes('Paid membership enrollment is on hold'));
assert(!start.includes('Choose your vendor category and NYC territory at Stripe checkout.'));
assert(start.includes('data-paid-enrollment="hold"'));
assert(start.includes('/permitplate-nyc/trial.html'));
assert(start.indexOf('Request a supervised free trial')<start.indexOf('<ul>'),
  'no-card trial action must precede the long plan list on mobile');
assert(start.includes('One vendor category'));
assert(start.includes('One NYC territory'));
assert(start.toLowerCase().includes('weekly founder-reviewed brief'));
assert(start.includes('7-day refund after first brief'));
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
assert(terms.includes('prepared and sent within five business days'));
assert(refunds.includes('for seven calendar days after that first message'));

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
