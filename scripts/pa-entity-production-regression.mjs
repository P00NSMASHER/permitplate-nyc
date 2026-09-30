#!/usr/bin/env node

// External production regression harness for PA Entity Lookup x402.
// Run after a production publish. It performs only unpaid / invalid-payment
// checks; it does NOT spend USDC.

const ORIGIN = process.env.PA_ENTITY_ORIGIN || 'https://pa-entity-x402.floot.app';
const PAID = `${ORIGIN}/_api/pa-business`;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function req(label, url, init = {}) {
  const started = Date.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const headers = Object.fromEntries(res.headers.entries());
  console.log(JSON.stringify({
    label,
    status: res.status,
    ms: Date.now() - started,
    contentType: headers['content-type'] || null,
    paymentRequired: Boolean(headers['payment-required']),
    paymentResponse: Boolean(headers['payment-response']),
    bodyPreview: text.slice(0, 300)
  }));
  return { res, text, headers };
}

function decodeHeader(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(normalized + pad, 'base64').toString('utf8'));
}

const manifests = [
  '/.well-known/x402',
  '/.well-known/x402.json',
  '/.well-known/x402-services.json'
];

const docs = {};
for (const path of manifests) {
  const r = await req(`manifest ${path}`, ORIGIN + path);
  check(r.res.status === 200, `${path} must return 200`);
  check((r.headers['content-type'] || '').includes('json'), `${path} must return JSON`);
  try { docs[path] = JSON.parse(r.text); }
  catch { failures.push(`${path} must contain valid JSON`); }
}

if (docs[manifests[0]] && docs[manifests[1]] && docs[manifests[2]]) {
  const terms = d => JSON.stringify(d.accepts ?? d.resources?.[0]?.accepts ?? null);
  check(terms(docs[manifests[0]]) === terms(docs[manifests[1]]), 'x402 and x402.json accepts must match');
  check(terms(docs[manifests[0]]) === terms(docs[manifests[2]]), 'x402 and x402-services.json accepts must match');
}

const skill = await req('skill.md', ORIGIN + '/skill.md');
check(skill.res.status === 200, '/skill.md must return 200');
check(!/<html|<!doctype html/i.test(skill.text), '/skill.md must not be the SPA HTML shell');
check(/PA Entity Lookup|Pennsylvania/i.test(skill.text), '/skill.md must contain the real skill document');

const unpaid = await req('unpaid paid-route', PAID + '?q=OpenAI&limit=1');
check(unpaid.res.status === 402, 'unpaid route must return 402');
check(Boolean(unpaid.headers['payment-required']), 'unpaid route must expose PAYMENT-REQUIRED');
check((unpaid.headers['cache-control'] || '').includes('no-store'), '402 should be no-store');

let body;
try { body = JSON.parse(unpaid.text); } catch { failures.push('402 body must be valid JSON'); }
if (body && unpaid.headers['payment-required']) {
  try {
    const hd = decodeHeader(unpaid.headers['payment-required']);
    check(hd.x402Version === body.x402Version, '402 header/body x402Version mismatch');
    check(JSON.stringify(hd.accepts) === JSON.stringify(body.accepts), '402 header/body accepts mismatch');
    check(JSON.stringify(hd.resource) === JSON.stringify(body.resource), '402 header/body resource mismatch');

    const a = hd.accepts?.[0] || {};
    check(a.network === 'eip155:8453', 'network must remain Base mainnet eip155:8453');
    check(a.amount === '5000', 'price must remain 5000 atomic USDC');
    check(String(a.asset).toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'asset must remain Base USDC');
    check(String(a.payTo).toLowerCase() === '0x708f7b52b56eafd7fc1de65fc7752ed732914021', 'payTo changed unexpectedly');
  } catch (e) {
    failures.push('PAYMENT-REQUIRED must be decodable x402 JSON: ' + e.message);
  }
}

const invalidB64 = await req('invalid base64 payment', PAID + '?q=OpenAI&limit=1', {
  headers: { 'PAYMENT-SIGNATURE': 'not-base64-json' }
});
check(invalidB64.res.status === 402, 'invalid base64 payment must return 402, not 5xx');

const emptyPayload = Buffer.from('{}').toString('base64');
const invalidDecoded = await req('decoded invalid payment', PAID + '?q=OpenAI&limit=1', {
  headers: { 'PAYMENT-SIGNATURE': emptyPayload }
});
check(invalidDecoded.res.status === 402, 'decoded invalid payment must return 402, not verifier 503');
check(/invalid_payload|payment_verification_failed|invalid_payment/i.test(invalidDecoded.text), 'decoded invalid payment should expose invalid-payment reason');

for (const [label, extra] of [
  ['paid=true spoof', '&paid=true'],
  ['settled query spoof', '&x402-settled=true']
]) {
  const r = await req(label, PAID + '?q=OpenAI&limit=1' + extra);
  check(r.res.status === 402, `${label} must remain paywalled`);
}

for (const [label, headers] of [
  ['settled header spoof', { 'x402-settled': 'true' }],
  ['payment response spoof', { 'PAYMENT-RESPONSE': Buffer.from('{"success":true}').toString('base64') }],
  ['authorization spoof', { 'Authorization': 'Bearer paid' }],
  ['internal status spoof', { 'x-floot-status': '200' }],
]) {
  const r = await req(label, PAID + '?q=OpenAI&limit=1', { headers });
  check(r.res.status === 402, `${label} must remain paywalled`);
}

const cors = await req('CORS GET', PAID + '?q=OpenAI&limit=1', {
  headers: { Origin: 'https://buyer.example' }
});
check(Boolean(cors.headers['access-control-allow-origin']), 'paid GET must expose Access-Control-Allow-Origin');
check((cors.headers['access-control-expose-headers'] || '').toLowerCase().includes('payment-required'), 'CORS must expose PAYMENT-REQUIRED');

const options = await req('CORS OPTIONS', PAID + '?q=OpenAI&limit=1', {
  method: 'OPTIONS',
  headers: {
    Origin: 'https://buyer.example',
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'payment-signature'
  }
});
check(options.res.status === 204 || options.res.status === 200, 'OPTIONS should succeed');
check((options.headers['access-control-allow-headers'] || '').toLowerCase().includes('payment-signature'), 'OPTIONS must allow PAYMENT-SIGNATURE');

const legacy = await req('legacy API-looking route', ORIGIN + '/api/pa-business?q=OpenAI&limit=1');
check(legacy.res.status !== 200 || !/<html|<!doctype html/i.test(legacy.text), '/api/pa-business should not return HTML SPA with 200');

const hugeQ = 'A'.repeat(5000);
const huge = await req('huge q unpaid', PAID + '?q=' + encodeURIComponent(hugeQ) + '&limit=1');
check([400, 402, 414, 431].includes(huge.res.status), 'huge q should be bounded safely');

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures
}, null, 2));

if (failures.length) process.exit(1);
