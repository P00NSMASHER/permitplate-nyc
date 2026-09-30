import assert from 'node:assert/strict'

const ORIGIN='https://pa-entity-x402.floot.app'
const PAID=ORIGIN+'/_api/pa-business?q=OpenAI&limit=1'
const PAY_TO='0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK='eip155:8453'
const AMOUNT='5000'

async function get(path,init={}){
  const res=await fetch(ORIGIN+path,init)
  const text=await res.text()
  return {res,text}
}

function decodeHeader(value){
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/')
  const padded=normalized.padEnd(normalized.length+((4-normalized.length%4)%4),'=')
  return JSON.parse(Buffer.from(padded,'base64').toString('utf8'))
}

for(const path of ['/.well-known/x402','/.well-known/x402.json','/.well-known/x402-services.json']){
  const {res,text}=await get(path)
  assert.equal(res.status,200,`${path} must be 200`)
  assert.match(res.headers.get('content-type')??'',/application\/json/i)
  const doc=JSON.parse(text)
  assert.equal(doc.x402Version,2)
  assert.equal(doc.accepts[0].network,NETWORK)
  assert.equal(doc.accepts[0].amount,AMOUNT)
  assert.equal(doc.accepts[0].payTo,PAY_TO)
}

{
  const {res,text}=await get('/skill.md')
  assert.equal(res.status,200)
  assert.match(res.headers.get('content-type')??'',/(text\/markdown|text\/plain)/i)
  assert.ok(text.startsWith('# PA Entity Lookup x402'))
  assert.ok(!text.toLowerCase().includes('<!doctype html'))
}

{
  const {res,text}=await get('/openapi.json')
  assert.equal(res.status,200)
  const o=JSON.parse(text)
  const op=o.paths['/_api/pa-business'].get
  assert.equal(op.operationId,'pennsylvaniaBusinessRegistryCompanyIdentityLookup')
  assert.equal(op['x-payment-info'].price.amount,'0.005000')
  assert.equal(op['x-payment-info'].network,NETWORK)
  assert.equal(op['x-payment-info'].payTo,PAY_TO)
}

{
  const res=await fetch(PAID)
  assert.equal(res.status,402)
  const body=await res.json()
  const ph=res.headers.get('payment-required')
  assert.ok(ph,'PAYMENT-REQUIRED required')
  const header=decodeHeader(ph)
  assert.deepEqual(header.accepts,body.accepts)
  assert.deepEqual(header.resource,body.resource)
  assert.equal(header.accepts[0].network,NETWORK)
  assert.equal(header.accepts[0].amount,AMOUNT)
  assert.equal(header.accepts[0].payTo,PAY_TO)
  assert.equal(res.headers.get('cache-control'),'no-store')
}

{
  const bad=Buffer.from('{}').toString('base64')
  const res=await fetch(PAID,{headers:{'PAYMENT-SIGNATURE':bad}})
  const body=await res.json()
  assert.equal(res.status,402,'invalid payment payload should be payment-invalid, not verifier outage')
  assert.notEqual(body.error,'payment_verifier_unavailable')
}

{
  const res=await fetch(ORIGIN+'/_api/pa-business',{
    headers:{'PAYMENT-SIGNATURE':Buffer.from('{}').toString('base64')}
  })
  assert.equal(res.status,400,'supplied payment + invalid query should fail before facilitator work')
}

{
  const res=await fetch(PAID,{headers:{Origin:'https://buyer.example'}})
  assert.equal(res.status,402)
  const allow=res.headers.get('access-control-allow-origin')
  assert.ok(allow==='*'||allow==='https://buyer.example','CORS allow-origin required')
  const expose=(res.headers.get('access-control-expose-headers')??'').toLowerCase()
  assert.ok(expose.includes('payment-required'),'PAYMENT-REQUIRED must be exposed')
}

{
  const res=await fetch(PAID,{
    method:'OPTIONS',
    headers:{
      Origin:'https://buyer.example',
      'Access-Control-Request-Method':'GET',
      'Access-Control-Request-Headers':'payment-signature'
    }
  })
  assert.equal(res.status,204)
  const allowed=(res.headers.get('access-control-allow-headers')??'').toLowerCase()
  assert.ok(allowed.includes('payment-signature'))
}

{
  const res=await fetch(ORIGIN+'/.well-known/security.txt')
  assert.equal(res.status,200)
  const text=await res.text()
  assert.match(text,/^Contact:/m)
}

console.log('PA_ENTITY_POST_DEPLOY_ACCEPTANCE=PASS')
