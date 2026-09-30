import assert from 'node:assert/strict'
import {
  AMOUNT,
  NETWORK,
  PAY_TO,
  canonicalBusinessName,
  classifySettleResponse,
  classifyVerifyResponse,
  decodePaymentHeader,
  buildEntitySearchUrl,
  buildPrincipalSearchUrl,
  matchScore,
  normalizeQuery,
  parseLimit,
  paymentDocument,
  dedupePrincipals,
} from './pa-entity-core.ts'

assert.equal(normalizeQuery('  OpenAI  '), 'OpenAI')
assert.equal(normalizeQuery('%_OpenAI__'), 'OpenAI')
assert.throws(() => normalizeQuery('A'), /query_too_short/)
assert.throws(() => normalizeQuery('A'.repeat(121)), /query_too_long/)

assert.equal(parseLimit(undefined), 10)
assert.equal(parseLimit('1'), 1)
assert.equal(parseLimit('25'), 25)
assert.throws(() => parseLimit('10garbage'), /invalid_limit/)
assert.throws(() => parseLimit('0'), /invalid_limit/)
assert.throws(() => parseLimit('26'), /invalid_limit/)

const sqlish=buildEntitySearchUrl("' OR 1=1 --", 'contains', 1)
assert.match(decodeURIComponent(sqlish), /upper\(business_name\) like/)
assert.match(decodeURIComponent(sqlish), /'' OR 1=1 --/)
assert.match(decodeURIComponent(buildEntitySearchUrl('Wawa','starts',5)), /like 'WAWA%'/)

const purl=buildPrincipalSearchUrl(['0000233685','0000326968','bad','0000233685'])
assert.ok(purl)
assert.match(decodeURIComponent(purl!), /0000233685/)
assert.match(decodeURIComponent(purl!), /0000326968/)
assert.equal(buildPrincipalSearchUrl(['bad']), null)

assert.equal(canonicalBusinessName('Sheetz, Inc.'), 'SHEETZ')
assert.equal(canonicalBusinessName('Openai, L.L.C.'), 'OPENAI')
assert.equal(matchScore('Sheetz, Inc.','Sheetz'), 0)
assert.ok(matchScore('Bob Sheetz Roofing','Sheetz') > 0)

assert.deepEqual(
  classifyVerifyResponse(400,{isValid:false,invalidReason:'invalid_payload'}),
  {kind:'invalid',reason:'invalid_payload',body:{isValid:false,invalidReason:'invalid_payload'}}
)
assert.equal(classifyVerifyResponse(200,{success:true}).kind,'unavailable')
assert.equal(classifyVerifyResponse(200,{isValid:true}).kind,'valid')
assert.equal(classifyVerifyResponse(503,null).kind,'unavailable')

assert.equal(classifySettleResponse(200,{success:true}).kind,'settled')
assert.equal(classifySettleResponse(409,{success:false,errorReason:'duplicate_settlement'}).kind,'retry_same_payment')
assert.equal(classifySettleResponse(500,{success:false,errorReason:'settlement_pending'}).kind,'retry_same_payment')
assert.equal(classifySettleResponse(402,{success:false,errorReason:'insufficient_funds'}).kind,'payment_failed')
assert.equal(classifySettleResponse(500,null).kind,'unavailable')

const doc=paymentDocument()
assert.equal(doc.x402Version,2)
assert.equal(doc.resource.url,'https://pa-entity-x402.floot.app/_api/pa-business')
assert.equal(doc.accepts[0].amount,AMOUNT)
assert.equal(doc.accepts[0].network,NETWORK)
assert.equal(doc.accepts[0].payTo,PAY_TO)
assert.equal(doc.extensions.bazaar.info.output.example.count,1)

const principals=dedupePrincipals([
  {filing_number:'0000326968',party_type:'Governor',first_name:'Travis',last_name:'Sheetz'},
  {filing_number:'0000326968',party_type:'Governor',first_name:'Travis',last_name:'Sheetz'},
  {filing_number:'0000326968',party_type:'President',first_name:'TRAVIS',last_name:'SHEETZ'},
])
assert.equal(principals.get('0000326968')?.length,2)

const encoded=Buffer.from(JSON.stringify({x402Version:2})).toString('base64url')
assert.deepEqual(decodePaymentHeader(encoded),{x402Version:2})
assert.throws(()=>decodePaymentHeader('A'.repeat(32769)),/payment_header_too_large/)

console.log('PA_ENTITY_HARDENED_CORE_TESTS=PASS')
