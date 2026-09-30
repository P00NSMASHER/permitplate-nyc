import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = 'docs/pa-entity-floot-release'
const readJson = name => JSON.parse(fs.readFileSync(`${root}/${name}`, 'utf8'))
const read = name => fs.readFileSync(`${root}/${name}`, 'utf8')

const openapi = readJson('openapi.json')
const x402 = readJson('x402.json')
const x402Services = readJson('x402-services.json')
const catalog = readJson('x402-catalog.json')
const service = readJson('x402-service.json')
const card = readJson('agent-card.json')
const llms = read('llms.txt')
const llmsFull = read('llms-full.txt')
const sitemap = read('sitemap.xml')
const endpoint = read('pa-business_GET.ts')

assert.deepEqual(x402Services, x402, 'x402 JSON aliases must be byte-semantic equivalents')
assert.equal(x402.x402Version, 2)
assert.equal(x402.accepts[0].network, 'eip155:8453')
assert.equal(x402.accepts[0].amount, '5000')
assert.equal(x402.accepts[0].asset.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
assert.equal(x402.accepts[0].payTo.toLowerCase(), '0x708f7b52b56eafd7fc1de65fc7752ed732914021')
assert.equal(x402.accepts[0].extra.name, 'USD Coin')
assert.equal(x402.extensions.bazaar.info.output.example.count, 1)
assert.equal(
  x402.extensions.bazaar.info.output.example.results[0].filingNumber,
  '0014371957',
)
assert.equal(
  x402.extensions.bazaar.info.input.queryParams.limit,
  1,
)
assert.equal(
  x402.extensions.bazaar.schema.properties.input.properties.queryParams.properties.q.maxLength,
  120,
)

const op = openapi.paths['/_api/pa-business'].get
assert.equal(op.operationId, 'pennsylvaniaBusinessRegistryCompanyIdentityLookup')
assert.match(op.summary, /Pennsylvania business registry/i)
assert.match(op.description, /company name/i)
assert.match(op.description, /principal\/officer/i)
assert.equal(op['x-payment-info'].price.amount, '0.005000')
assert.equal(op['x-payment-info'].network, 'eip155:8453')
assert.equal(
  op['x-payment-info'].payTo.toLowerCase(),
  '0x708f7b52b56eafd7fc1de65fc7752ed732914021',
)
const q = op.parameters.find(p => p.name === 'q')
const limit = op.parameters.find(p => p.name === 'limit')
assert.equal(q.schema.minLength, 2)
assert.equal(q.schema.maxLength, 120)
assert.equal(limit.schema.minimum, 1)
assert.equal(limit.schema.maximum, 25)
assert.equal(op.responses['200'].content['application/json'].example.count, 1)
assert.equal(
  op.responses['200'].content['application/json'].example.results[0].businessName,
  'Openai, L.l.c.',
)

assert.equal(catalog.x402Version, 2)
assert.match(catalog.skill, /^https:\/\/raw\.githubusercontent\.com\//)
assert.ok(!catalog.skill.includes('pa-entity-x402.floot.app/skill.md'))
assert.equal(catalog.resources[0].accepts[0].amount, '5000')

assert.equal(service.x402Version, 2)
assert.equal(service.protocol.version, 2)
assert.equal(service.payment.network, 'eip155:8453')
assert.equal(service.pricing.base, '0.005')
assert.match(service.skill, /^https:\/\/raw\.githubusercontent\.com\//)

assert.equal(card.version, '2.0.0')
assert.ok(card.skills[0].tags.includes('pennsylvania-business-registry'))
assert.ok(card.skills[0].tags.includes('vendor-verification'))

assert.match(llms, /settlement_pending/)
assert.match(llms, /same PAYMENT-SIGNATURE/)
assert.match(llmsFull, /duplicate settlement/i)
assert.match(llmsFull, /no fresh PAYMENT-REQUIRED/i)

assert.ok(!sitemap.includes('/skill.md'), 'broken Floot /skill.md must not be advertised')
assert.ok(sitemap.includes('/.well-known/x402.json'))
assert.ok(sitemap.includes('/.well-known/x402-services.json'))
assert.ok(sitemap.includes('/.well-known/security.txt'))

assert.match(endpoint, /settlement_pending/)
assert.match(endpoint, /duplicate_settlement/)
assert.match(endpoint, /retrySamePayment/)
assert.match(endpoint, /isValid !== true/)
assert.ok(!endpoint.includes('verified.success'), 'verification must never accept generic success=true')
assert.match(endpoint, /SOURCE_TIMEOUT_MS/)
assert.match(endpoint, /FACILITATOR_TIMEOUT_MS/)
assert.match(endpoint, /access-control-expose-headers/i)

console.log('PA Entity discovery fixture tests passed')
