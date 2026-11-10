'use strict';
// Historical filename kept for required CI wiring; now verifies the strict
// transition from a held sales surface to the owner-authorized live link.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const build=require('../build-site');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const manifest=JSON.parse(read('release-manifest.json'));
const LINK='https://buy.stripe.com/4gM28r1cL81x8dF9Xj9sk02';
const PAYMENT_LINK_ID='plink_1UG3RUDPW8riWrxQpZwHExK2';
const PRICE_ID='price_1UFjcWDPW8riWrxQhnrPX6nc';

test('live enrollment is specifically bound to the existing verified $79/month Stripe link',()=>{
  assert.equal(manifest.checkout.launch_mode,'FOUNDER_CURATED_NO_SCORE_V1');
  assert.equal(manifest.checkout.price,'$79/month');
  assert.equal(manifest.checkout.public_enrollment,'OPEN');
  assert.equal(manifest.checkout.public_checkout_url,LINK);
  assert.equal(manifest.checkout.payment_link_id,PAYMENT_LINK_ID);
  assert.equal(manifest.checkout.price_id,PRICE_ID);
  assert.equal(manifest.checkout.external_saved_payment_link_bypass_remains,false);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest.checkout,'hold_reason'),false);
  assert.deepEqual(manifest.checkout.required_preferences,[
    'vendor category','NYC territory','Starter Snapshot preference'
  ]);
  assert(manifest.release_stage.includes('No paid-customer proof claimed'));
  assert(manifest.commercial_proof.includes('real paid subscriber'));
});

test('only the reviewed membership page contains the exact live $79 checkout URL',()=>{
  const pages=build.PUBLIC_FILES.filter(file=>file.endsWith('.html'));
  assert(pages.length>5);
  const occurrences=pages.flatMap(page=>{
    const text=read(page);
    return Array(text.split(LINK).length-1).fill(page);
  });
  assert.deepEqual(occurrences,['start.html']);
  assert(!read('site.js').includes(LINK),'no hidden JS redirect to checkout');
  assert(!read('index.html').includes(LINK),'home requires review of the membership terms first');
  assert(!read('trial.html').includes(LINK),'no-card trial cannot become paid checkout');
});

test('no-JavaScript checkout requires explicit user navigation to hosted Stripe',()=>{
  const start=read('start.html');
  const home=read('index.html');
  assert(start.includes('data-paid-enrollment="open"'));
  assert(start.includes('Continue to secure Stripe checkout'));
  assert(start.includes('href="'+LINK+'" rel="noopener noreferrer"'));
  assert(start.indexOf('Continue to secure Stripe checkout')<start.indexOf('<ul>'),
    'paid action visible above plan bullets on mobile');
  assert(start.includes('Stripe shows your $79/month subscription and any applicable taxes'));
  assert(start.includes('Choosing checkout does not itself charge you'));
  assert(start.includes('category, NYC territory and Starter Snapshot preference'));
  for(const page of [home,start]){
    assert(!/Paid enrollment (is )?on hold/i.test(page));
    assert(!/Paid membership enrollment is on hold/i.test(page));
    assert(!/Future paid membership · not open/.test(page));
  }
  assert(home.includes('href="/permitplate-nyc/start.html">Join membership'));
  assert(home.includes('href="/permitplate-nyc/start.html">Review membership and checkout'));
  assert(home.includes('First payment refundable through 7 days after first brief is sent'));
  assert(start.includes('Seven-day refund after the first brief or no-matches note is sent'));
  for(const file of ['terms.html','privacy.html','refunds.html']){
    assert(start.includes('href="/permitplate-nyc/'+file+'"'));
  }
  assert(!start.includes('<form'),'card data and checkout preferences are collected by Stripe');
});

test('supervised trial and actual paid customer proof remain separately held',()=>{
  const trial=read('trial.html');
  const start=read('start.html');
  const readiness=read('pipeline/launch-readiness.js');
  assert(start.includes('Request a 14-day supervised free trial'));
  assert(trial.includes('No card required'));
  assert(trial.includes('No automatic paid upgrade'));
  assert(start.includes('Research signals are not guaranteed leads'));
  for(const gate of [
    'realPaidSubscriberEndToEndVerified',
    'providerBackedDeliveryVerified',
    'nextRunDuplicateSuppressionVerifiedForRealSubscriber',
    'stripeIntakeMonitoringVerified'
  ])assert(readiness.includes(gate),gate);
  assert(manifest.free_trial.automatic_upgrade===false);
});
