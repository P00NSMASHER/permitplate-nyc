#!/usr/bin/env node
const origin = process.argv[2] || 'https://pa-entity-x402.floot.app';
const endpoint = origin + '/_api/pa-business?q=OpenAI&limit=1';
let failures = 0;
function check(ok, label, detail='') {
  const line = `${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' :: ' + detail : ''}`;
  console.log(line);
  if (!ok) failures++;
}
async function read(url, init={}) {
  const started=Date.now();
  const res=await fetch(url,init);
  const text=await res.text();
  return {res,text,ms:Date.now()-started};
}
function decodeHeader(v){
  const normalized=v.replace(/-/g,'+').replace(/_/g,'/');
  const pad='='.repeat((4-normalized.length%4)%4);
  return JSON.parse(Buffer.from(normalized+pad,'base64').toString('utf8'));
}

const unpaid=await read(endpoint);
check(unpaid.res.status===402,'unpaid request returns 402',String(unpaid.res.status));
check(unpaid.res.headers.has('payment-required'),'PAYMENT-REQUIRED exists');
check((unpaid.res.headers.get('cache-control')||'').includes('no-store'),'payment challenge is no-store',unpaid.res.headers.get('cache-control')||'');
let body=null, hdr=null;
try { body=JSON.parse(unpaid.text); } catch {}
try { hdr=decodeHeader(unpaid.res.headers.get('payment-required')||''); } catch {}
check(body?.x402Version===2,'body x402Version=2');
check(hdr?.x402Version===2,'header x402Version=2');
check(JSON.stringify(body?.accepts)===JSON.stringify(hdr?.accepts),'header/body accepts parity');
check(JSON.stringify(body?.resource)===JSON.stringify(hdr?.resource),'header/body resource parity');
const req=hdr?.accepts?.[0]||{};
check(req.network==='eip155:8453','Base network',req.network);
check(req.amount==='5000','price atomic amount=5000',String(req.amount));
check(String(req.asset||'').toLowerCase()==='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','Base USDC asset',String(req.asset));
check(String(req.payTo||'').toLowerCase()==='0x708f7b52b56eafd7fc1de65fc7752ed732914021','seller wallet',String(req.payTo));
check(req.extra?.name==='USD Coin' && req.extra?.version==='2','USDC EIP-712 domain',JSON.stringify(req.extra));

for (const p of ['/.well-known/x402','/.well-known/x402.json','/.well-known/x402-services.json']) {
  const r=await read(origin+p);
  check(r.res.status===200,p+' returns 200',String(r.res.status));
  check((r.res.headers.get('content-type')||'').includes('json'),p+' is JSON',r.res.headers.get('content-type')||'');
}

const skill=await read(origin+'/skill.md');
check(skill.res.status===200,'skill.md returns 200',String(skill.res.status));
check(!/<!doctype html/i.test(skill.text),'skill.md is not HTML app shell',skill.res.headers.get('content-type')||'');
check(/^#\s+/m.test(skill.text),'skill.md looks like Markdown');

const malformed=await read(endpoint,{headers:{'PAYMENT-SIGNATURE':'not-base64-json'}});
check(malformed.res.status===402,'malformed payment returns 402',String(malformed.res.status));
check(/invalid_payment_header/i.test(malformed.text),'malformed payment labeled invalid_payment_header');

const emptyPayload=Buffer.from('{}').toString('base64');
const invalid=await read(endpoint,{headers:{'PAYMENT-SIGNATURE':emptyPayload}});
check(invalid.res.status===402,'decodable invalid payment returns 402, not outage',String(invalid.res.status));
check(!/payment_verifier_unavailable/i.test(invalid.text),'invalid payment not reported as facilitator outage');

const invalidQ=await read(origin+'/_api/pa-business?q=A&limit=1',{headers:{'PAYMENT-SIGNATURE':emptyPayload}});
check(invalidQ.res.status===400,'invalid q rejected before verifier',String(invalidQ.res.status));

const cors=await read(endpoint,{method:'OPTIONS',headers:{Origin:'https://buyer.example','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'PAYMENT-SIGNATURE'}});
check(cors.res.status===204 || cors.res.status===200,'OPTIONS supported',String(cors.res.status));
check(!!cors.res.headers.get('access-control-allow-origin'),'CORS allow origin present',cors.res.headers.get('access-control-allow-origin')||'');
check((cors.res.headers.get('access-control-allow-headers')||'').toLowerCase().includes('payment-signature'),'CORS allows payment signature',cors.res.headers.get('access-control-allow-headers')||'');

const openapi=await read(origin+'/openapi.json');
let spec=null; try {spec=JSON.parse(openapi.text)} catch {}
const op=spec?.paths?.['/_api/pa-business']?.get;
check(op?.operationId==='pennsylvaniaBusinessRegistryCompanyIdentityLookup','optimized operationId',String(op?.operationId));
check(/business registry/i.test(op?.summary||''),'summary contains buyer vocabulary',String(op?.summary));

console.log('\nFailures:',failures);
process.exitCode=failures ? 1 : 0;
