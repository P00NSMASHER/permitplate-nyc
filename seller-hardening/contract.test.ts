import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  AMOUNT, NETWORK, PAY_TO, PRICE_USD, RESOURCE_URL, paymentDocument
} from './pa-entity-core.ts'

const manifest=JSON.parse(fs.readFileSync(new URL('./x402-manifest.json',import.meta.url),'utf8'))
const openapi=JSON.parse(fs.readFileSync(new URL('./openapi.json',import.meta.url),'utf8'))
const skill=fs.readFileSync(new URL('./skill.md',import.meta.url),'utf8')
const security=fs.readFileSync(new URL('./security.txt',import.meta.url),'utf8')

assert.equal(manifest.x402Version,2)
assert.equal(manifest.resource.url,RESOURCE_URL)
assert.equal(manifest.accepts[0].amount,AMOUNT)
assert.equal(manifest.accepts[0].network,NETWORK)
assert.equal(manifest.accepts[0].payTo,PAY_TO)
assert.equal(manifest.accepts[0].extra.name,'USD Coin')
assert.equal(manifest.extensions.bazaar.info.output.example.count,1)
assert.equal(manifest.extensions.bazaar.info.output.example.results[0].filingNumber,'0014371957')

const op=openapi.paths['/_api/pa-business'].get
assert.equal(op.operationId,'pennsylvaniaBusinessRegistryCompanyIdentityLookup')
assert.equal(op['x-payment-info'].price.amount,PRICE_USD)
assert.equal(op['x-payment-info'].network,NETWORK)
assert.equal(op['x-payment-info'].payTo,PAY_TO)
assert.equal(op.parameters.find((p:any)=>p.name==='q').schema.maxLength,120)
assert.equal(op.parameters.find((p:any)=>p.name==='limit').schema.maximum,25)
assert.equal(op.responses['200'].content['application/json'].example.count,1)
assert.equal(op.responses['200'].content['application/json'].example.results[0].businessName,'Openai, L.l.c.')

for(const phrase of [
  'Pennsylvania business registry',
  'company identity',
  'vendor',
  'due diligence',
]){
  assert.ok(JSON.stringify(openapi).toLowerCase().includes(phrase.toLowerCase()),phrase)
  assert.ok(skill.toLowerCase().includes(phrase.toLowerCase()),phrase)
}

for(const unsupported of [
  'sanctions screening',
  'risk score',
  'proof of current good standing',
]){
  assert.ok(skill.toLowerCase().includes(unsupported), `skill must explicitly disclaim ${unsupported}`)
}

assert.ok(security.includes('Contact: https://github.com/P00NSMASHER/permitplate-nyc/issues'))
assert.ok(security.includes('Expires: 2027-09-30'))

const coreDoc=paymentDocument()
assert.equal(coreDoc.accepts[0].amount,manifest.accepts[0].amount)
assert.equal(coreDoc.accepts[0].network,manifest.accepts[0].network)
assert.equal(coreDoc.accepts[0].payTo,manifest.accepts[0].payTo)
assert.equal(coreDoc.resource.url,manifest.resource.url)

console.log('PA_ENTITY_CONTRACT_TESTS=PASS')
