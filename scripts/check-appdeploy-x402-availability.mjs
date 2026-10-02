const endpoints = [
  ['vendor-gate','https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=OpenAI%20OpCo&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101&domain=openai.com'],
  ['sec','https://api-v2.appdeploy.ai/app/sec-recent-filings-x402-f9qatj/api/sec-filings?ticker=AAPL&form=10-K&limit=1'],
  ['census','https://api-v2.appdeploy.ai/app/us-census-address-geocoder-x402-23mj4x/api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233'],
  ['ofac','https://api-v2.appdeploy.ai/app/ofac-sdn-name-screen-x402-m9ko96/api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=1&minScore=90'],
  ['rdap','https://api-v2.appdeploy.ai/app/domain-rdap-lookup-x402-spdfnq/api/domain-rdap?domain=example.com'],
  ['treasury','https://api-v2.appdeploy.ai/app/treasury-average-interest-rates-x402-xeqftl/api/treasury-average-rates'],
  ['vendor-demo','https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed'],
  ['vendor-discovery','https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402']
];

let healthy = 0;
for (const [name,url] of endpoints) {
  try {
    const r = await fetch(url,{headers:{accept:'application/json','user-agent':'x402-appdeploy-cloud-check/1.0'},signal:AbortSignal.timeout(15000)});
    const body = await r.text();
    let parsed=null; try{parsed=JSON.parse(body)}catch{}
    const paymentRequired = Boolean(r.headers.get('payment-required'));
    const availability = r.headers.get('x-appdeploy-app-availability');
    const code = parsed?.code ?? parsed?.error ?? null;
    const ok = name==='vendor-demo' || name==='vendor-discovery'
      ? r.status===200
      : r.status===402 && paymentRequired;
    if (ok) healthy += 1;
    console.log(JSON.stringify({name,status:r.status,paymentRequired,availability,code,ok,body:body.slice(0,180)}));
  } catch (e) {
    console.log(JSON.stringify({name,ok:false,error:e instanceof Error?e.message:String(e)}));
  }
}
console.log('SUMMARY '+healthy+'/'+endpoints.length+' healthy');
if (healthy !== endpoints.length) process.exitCode = 1;
