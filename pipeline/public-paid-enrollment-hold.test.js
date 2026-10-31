'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const build=require('../build-site');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const manifest=JSON.parse(read('release-manifest.json'));
const PAID_LINK='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';

test('staged enrollment is explicit and does not claim Stripe link deactivation',()=>{
  assert.equal(manifest.checkout.price,'$79/month');
  assert.equal(manifest.checkout.public_enrollment,'ON_HOLD');
  assert.equal(manifest.checkout.external_saved_payment_link_bypass_remains,true,
    'a website source change alone cannot deactivate a reusable provider payment link');
  assert.deepEqual(manifest.checkout.required_preferences,
    ['vendor category','NYC territory','Starter Snapshot preference']);
});
test('published HTML and browser JS never send a visitor into blocked $79 checkout',()=>{
  const pages=build.PUBLIC_FILES.filter(file=>file.endsWith('.html'));
  assert(pages.length>5);
  for(const page of pages)assert(!read(page).includes(PAID_LINK),page+' still exposes $79 checkout');
  assert(!read('site.js').includes(PAID_LINK));
  const home=read('index.html');
  assert(!home.includes('Start secure checkout'));
  assert(!home.includes('Start for $79/month'));
  assert(home.includes('Paid enrollment is on hold'));
});
test('no-JavaScript membership page reports hold and offers an opt-in no-card trial',()=>{
  const start=read('start.html');
  assert(start.includes('data-paid-enrollment="hold"'));
  assert(start.includes('Paid membership enrollment is on hold'));
  assert(start.includes('No purchase is offered on this page'));
  assert(start.includes('href="/permitplate-nyc/trial.html"'));
  assert(start.includes('Request a supervised free trial'));
  assert(!start.includes('Continue to secure checkout'));
  assert(!start.includes(PAID_LINK));
  const trial=read('trial.html');
  assert(trial.includes('No card required'));
  assert(trial.includes('No automatic paid upgrade'));
});
