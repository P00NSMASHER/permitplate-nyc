'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'..');
const sample=fs.readFileSync(path.join(root,'sample.html'),'utf8');
const start=fs.readFileSync(path.join(root,'start.html'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const siteJs=fs.readFileSync(path.join(root,'site.js'),'utf8');

const stripeUrl='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';

assert(sample.includes('<tr><td>Equipment</td><td>100</td></tr>'));
assert(sample.includes('<tr><td>Hood/Fire</td><td>93</td></tr>'));
assert(!sample.includes('<tr><td>Hood/Fire</td><td>100</td></tr>'));
assert(sample.includes('current canonical Equipment priority is 100 and Hood/Fire is 93'));

assert.equal(start.split(stripeUrl).length-1,0);
assert(start.includes('Choose your feed inside secure Stripe Checkout.'));
assert(start.includes('Activation stays fail-closed.'));
assert(start.includes('Stripe will be the authoritative onboarding record.'));
assert(start.includes('Checkout activation is temporarily blocked.'));
assert(start.includes('No payment can start from this page'));
assert(start.includes('vendor category'));
assert(start.includes('NYC territory'));
assert(start.includes('Starter Snapshot preference'));
assert(start.includes('checkout email'));
assert(!start.includes('<form'));
assert(!/netlify/i.test(start));
assert(!start.includes('activation_ref'));
assert(!start.includes('client_reference_id'));
assert(!start.includes('locked_prefilled_email'));
assert(!/<script>([\s\S]*?)<\/script>/.test(start));
assert(!start.includes('<style>'));
assert(!start.includes(' style='));

assert(index.includes('https://p00nsmasher.github.io/permitplate-nyc/'));
assert(index.includes('/permitplate-nyc/start.html'));
assert(!index.includes('permitplate-nyc.netlify.app'));

assert(!siteJs.includes(stripeUrl));
assert(!siteJs.includes('permitplate-onboarding'));
assert(!siteJs.includes('client_reference_id'));
assert(!siteJs.includes('window.location.assign'));
assert(siteJs.includes('data.cityofnewyork.us'));

console.log('PermitPlate GitHub Pages conversion regression tests passed.');
