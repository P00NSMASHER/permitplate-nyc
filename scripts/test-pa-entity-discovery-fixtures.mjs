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
const llms = read('llms.txt')
const llmsFull = read('llms-full.txt')
const skill = read('skill.txt')
const security = read('security.txt')
const sitemap = read('sitemap.xml')
const endpoint = read('pa-business_GET.ts')
const bestEndpoint = read('pa-entity-one_GET.ts')

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
const bestOp = openapi.paths['/_api/pa-entity-one'].get
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
assert.equal(bestOp.operationId, 'resolvePennsylvaniaBusinessBestMatch')
assert.match(bestOp.summary, /best Pennsylvania legal-entity match/i)
assert.equal(bestOp['x-payment-info'].price.amount, '0.001000')
assert.equal(bestOp['x-payment-info'].network, 'eip155:8453')
assert.equal(
  bestOp['x-payment-info'].payTo.toLowerCase(),
  '0x708f7b52b56eafd7fc1de65fc7752ed732914021',
)
assert.deepEqual(bestOp.parameters.map(p => p.name), ['q'])
assert.equal(bestOp.parameters[0].schema.maxLength, 120)
assert.equal(bestOp.responses['200'].content['application/json'].example.count, 1)
assert.equal(
  op.responses['200'].content['application/json'].example.results[0].businessName,
  'Openai, L.l.c.',
)

assert.equal(catalog.x402Version, 2)
assert.equal(catalog.skill, 'https://pa-entity-x402.floot.app/skill.txt')
assert.ok(!catalog.skill.includes('/skill.md'))
assert.equal(catalog.resources.length, 2)
const catalogMain = catalog.resources.find(r => r.resource.endsWith('/_api/pa-business'))
const catalogBest = catalog.resources.find(r => r.resource.endsWith('/_api/pa-entity-one'))
assert.ok(catalogMain)
assert.ok(catalogBest)
assert.equal(catalogMain.accepts[0].amount, '5000')
assert.equal(catalogBest.accepts[0].amount, '1000')
assert.deepEqual(catalogBest.extensions.bazaar.info.input.queryParams, { q: 'OpenAI' })

assert.equal(service.x402Version, 2)
assert.equal(service.protocol.version, 2)
assert.equal(service.payment.network, 'eip155:8453')
assert.equal(service.pricing.base, '0.001')
assert.equal(
  service.endpoint,
  'https://pa-entity-x402.floot.app/_api/pa-entity-one?q=OpenAI',
)
assert.equal(service.skill, 'https://pa-entity-x402.floot.app/skill.txt')

assert.match(skill, /^# PA Entity Lookup x402/m)
assert.ok(!/<html|<!doctype html/i.test(skill), 'skill.txt must contain text, not SPA HTML')
assert.match(skill, /\$0\.001/)
assert.match(skill, /\$0\.005/)
assert.match(skill, /pa-entity-one/)

assert.match(
  security,
  /^Contact: https:\/\/github\.com\/P00NSMASHER\/permitplate-nyc\/security/m,
)
assert.match(
  security,
  /^Canonical: https:\/\/pa-entity-x402\.floot\.app\/\.well-known\/security\.txt/m,
)

assert.match(llms, /\$0\.001/)
assert.match(llms, /pa-entity-one/)
assert.match(llms, /\$0\.005/)
assert.match(llmsFull, /best match/i)
assert.match(llms, /settlement_pending/)
assert.match(llms, /same PAYMENT-SIGNATURE/)
assert.match(llmsFull, /duplicate settlement/i)
assert.match(llmsFull, /no fresh PAYMENT-REQUIRED/i)
assert.match(llms, /https:\/\/pa-entity-x402\.floot\.app\/skill\.txt/)
assert.match(llmsFull, /https:\/\/pa-entity-x402\.floot\.app\/skill\.txt/)
assert.ok(!llmsFull.includes('/.well-known/agent-card.json'))
assert.equal(openapi.externalDocs.url, 'https://pa-entity-x402.floot.app/skill.txt')

assert.ok(!sitemap.includes('/skill.md'), 'broken Floot /skill.md must not be advertised')
assert.ok(sitemap.includes('/skill.txt'))
assert.ok(!sitemap.includes('/agent-card.json'), 'do not advertise A2A without an A2A binding')
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
assert.match(endpoint, /status === 402 \|\| status === 503 \? 'no-store'/)

assert.match(bestEndpoint, /const AMOUNT = '1000'/)
assert.match(bestEndpoint, /const PRICE = '\$0\.001'/)
assert.match(bestEndpoint, /\/pa-entity-one'/)
assert.match(bestEndpoint, /searchPennsylvania\(query, 1\)/)
assert.match(bestEndpoint, /settlement_pending/)
assert.match(bestEndpoint, /duplicate_settlement/)
assert.match(bestEndpoint, /retrySamePayment/)
assert.ok(!bestEndpoint.includes('verified.success'))
assert.match(bestEndpoint, /status === 402 \|\| status === 503 \? 'no-store'/)

console.log('PA Entity discovery fixture tests passed')
