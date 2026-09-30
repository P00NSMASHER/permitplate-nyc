const ORIGIN = 'https://pa-entity-x402.floot.app';
const PAID = ORIGIN + '/_api/pa-business?q=OpenAI&limit=1';

function decodeHeader(value) {
  const raw = String(value || '').replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(Buffer.from(raw + '='.repeat((4-raw.length%4)%4),'base64').toString('utf8'));
}

async function get(path, opts={}) {
  const r = await fetch(ORIGIN + path, {redirect:'manual', signal:AbortSignal.timeout(15000), ...opts});
  const text = await r.text();
  return {r,text};
}

let failed = 0;
const check = (ok, label) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) failed++;
};

for (const path of ['/.well-known/x402','/.well-known/x402.json','/.well-known/x402-services.json']) {
  const {r,text} = await get(path);
  check(r.status === 200, path + ' status 200');
  check((r.headers.get('content-type')||'').includes('application/json'), path + ' content-type json');
  try {
    const j = JSON.parse(text);
    check(j.x402Version === 2, path + ' x402Version=2');
    check(j.accepts?.[0]?.network === 'eip155:8453' || j.resources?.[0]?.accepts?.[0]?.network === 'eip155:8453', path + ' Base network');
  } catch {
    check(false, path + ' parses as JSON');
  }
}

{
  const {r,text} = await get('/skill.txt');
  const ct = r.headers.get('content-type') || '';
  const html = /<!doctype html/i.test(text);
  check(r.status === 200, '/skill.txt status 200');
  check(!html, '/skill.txt is not SPA HTML');
  check(/markdown|text\/plain/i.test(ct), '/skill.txt machine-readable content type');
}

{
  const r = await fetch(PAID, {signal:AbortSignal.timeout(15000)});
  const text = await r.text();
  check(r.status === 402, 'unpaid route returns 402');
  check((r.headers.get('cache-control')||'').includes('no-store'), '402 cache-control no-store');
  const pr = r.headers.get('payment-required');
  check(!!pr, 'PAYMENT-REQUIRED present');
  if (pr) {
    const j = decodeHeader(pr);
    check(j.x402Version === 2, 'PAYMENT-REQUIRED x402 v2');
    check(j.accepts?.[0]?.amount === '5000', 'price 5000 atomic');
    check(j.accepts?.[0]?.payTo === '0x708f7b52b56eafd7fc1de65fc7752ed732914021', 'payTo unchanged');
    check(j.accepts?.[0]?.extra?.name === 'USD Coin', 'EIP-712 domain USD Coin');
  }
  const body = JSON.parse(text);
  check(body.extensions?.bazaar?.info?.output?.example?.count > 0, 'Bazaar example demonstrates a real successful result');
}

{
  const bad = Buffer.from('{}').toString('base64');
  const r = await fetch(PAID, {headers:{'PAYMENT-SIGNATURE':bad}, signal:AbortSignal.timeout(15000)});
  const text = await r.text();
  check(r.status === 402, 'invalid-but-decodable payment returns 402, not 503');
  check(!/payment_verifier_unavailable/.test(text), 'invalid payment is not mislabeled as verifier outage');
}

{
  const r = await fetch(PAID, {
    method:'OPTIONS',
    headers:{
      Origin:'https://buyer.example',
      'Access-Control-Request-Method':'GET',
      'Access-Control-Request-Headers':'payment-signature'
    },
    signal:AbortSignal.timeout(15000)
  });
  check(r.status === 204 || r.status === 200, 'OPTIONS preflight accepted');
  const allow = (r.headers.get('access-control-allow-headers')||'').toLowerCase();
  const expose = (r.headers.get('access-control-expose-headers')||'').toLowerCase();
  check(allow.includes('payment-signature'), 'CORS allows PAYMENT-SIGNATURE');
  check(expose.includes('payment-required'), 'CORS exposes PAYMENT-REQUIRED');
  check(expose.includes('payment-response'), 'CORS exposes PAYMENT-RESPONSE');
}

for (const [label,opts] of [
  ['paid query spoof',{}],
  ['settled header spoof',{headers:{'x402-settled':'true'}}],
  ['payment response spoof',{headers:{'PAYMENT-RESPONSE':'eyJzdWNjZXNzIjp0cnVlfQ=='}}],
  ['authorization spoof',{headers:{Authorization:'Bearer paid'}}],
]) {
  const url = label === 'paid query spoof' ? PAID + '&paid=true' : PAID;
  const r = await fetch(url,{...opts,signal:AbortSignal.timeout(15000)});
  check(r.status === 402, label + ' cannot bypass payment');
}

const statsUrl='https://facilitator.payai.network/discovery/resources/' +
  encodeURIComponent('https://pa-entity-x402.floot.app/_api/pa-business') + '/stats';
{
  const r=await fetch(statsUrl,{signal:AbortSignal.timeout(15000)});
  const j=await r.json();
  console.log('PAYAI_STATS',JSON.stringify(j));
}

console.log('TOTAL_FAILURES=' + failed);
process.exitCode = failed ? 1 : 0;
