#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = 'docs/pa-entity-floot-recovery'
const manifest = JSON.parse(fs.readFileSync(root + '/x402.json', 'utf8'))
const openapi = JSON.parse(fs.readFileSync(root + '/openapi.json', 'utf8'))
const llms = fs.readFileSync(root + '/llms.txt', 'utf8')
const skill = fs.readFileSync(root + '/skill.txt', 'utf8')
const full = fs.readFileSync(root + '/llms-full.txt', 'utf8')
const extensionless = fs.readFileSync(root + '/x402', 'utf8')
const alias = fs.readFileSync(root + '/x402.json', 'utf8')
const servicesAlias = fs.readFileSync(root + '/x402-services.json', 'utf8')
const catalog = fs.readFileSync(root + '/x402-catalog.json', 'utf8')
const service = JSON.parse(fs.readFileSync(root + '/x402-service.json', 'utf8'))
const sitemap = fs.readFileSync(root + '/sitemap.xml', 'utf8')
const robots = fs.readFileSync(root + '/robots.txt', 'utf8')
const security = fs.readFileSync(root + '/security.txt', 'utf8')
const deployMap = JSON.parse(fs.readFileSync(root + '/deploy-map.json', 'utf8'))

const ORIGIN = 'https://pa-entity-x402.floot.app'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase()
const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'.toLowerCase()

const expected = new Map([
  [ORIGIN + '/_api/pa-entity-one', '1000'],
  [ORIGIN + '/_api/pa-business', '5000'],
  [ORIGIN + '/_api/vendor-intake-gate', '20000'],
  [ORIGIN + '/_api/sec-filings', '5000'],
  [ORIGIN + '/_api/us-address-geocode', '5000'],
  [ORIGIN + '/_api/ofac-sdn-screen', '5000'],
  [ORIGIN + '/_api/domain-rdap', '5000'],
  [ORIGIN + '/_api/treasury-average-rates', '5000'],
])

assert.equal(manifest.x402Version, 2)
assert.ok(Array.isArray(manifest.resources))
assert.equal(manifest.resources.length, 8)

const resourceUrls = manifest.resources.map(resource => resource.resource)
assert.equal(new Set(resourceUrls).size, 8, 'resources must be unique')

for (const resource of manifest.resources) {
  assert.ok(expected.has(resource.resource), 'unexpected resource ' + resource.resource)
  assert.ok(resource.resource.startsWith(ORIGIN + '/_api/'))
  assert.equal(resource.x402Version, 2)
  assert.equal(resource.type, 'http')
  assert.ok(Array.isArray(resource.accepts) && resource.accepts.length >= 1)
  const terms = resource.accepts[0]
  assert.equal(String(terms.amount), expected.get(resource.resource))
  assert.equal(terms.network, NETWORK)
  assert.equal(String(terms.asset).toLowerCase(), USDC)
  assert.equal(String(terms.payTo).toLowerCase(), PAY_TO)
  assert.equal(terms.extra?.name, 'USD Coin')
  assert.equal(terms.extra?.version, '2')
  assert.equal(resource.extensions?.bazaar?.info?.input?.method, 'GET')
}

const serializedManifest = JSON.stringify(manifest)
assert.ok(!serializedManifest.includes('api-v2.appdeploy.ai'))

assert.equal(extensionless, alias, 'extensionless and x402.json must be byte-identical')
assert.equal(extensionless, servicesAlias, 'x402-services alias must match canonical manifest')
assert.equal(extensionless, catalog, 'x402 catalog must match canonical recovery manifest')
assert.deepEqual(JSON.parse(extensionless), manifest)
assert.equal(service.x402Version, 2)
assert.equal(service.resourceCount, 8)
assert.equal(service.payment.network, NETWORK)
assert.equal(String(service.payment.address).toLowerCase(), PAY_TO)

assert.equal(openapi.openapi, '3.1.0')
assert.equal(openapi.info.version, '4.0.0')
assert.equal(Object.keys(openapi.paths).length, 8)

for (const resource of expected.keys()) {
  const path = new URL(resource).pathname
  assert.ok(openapi.paths[path], 'OpenAPI missing ' + path)
  const payment = openapi.paths[path]?.get?.['x-payment-info']
  assert.ok(payment, 'OpenAPI missing x-payment-info for ' + path)
  assert.equal(payment.network, NETWORK)
  assert.equal(String(payment.payTo).toLowerCase(), PAY_TO)
}

const serializedOpenApi = JSON.stringify(openapi)
assert.ok(!serializedOpenApi.includes('api-v2.appdeploy.ai'))

for (const path of expected.keys()) {
  const route = new URL(path).pathname
  assert.ok(llms.includes(route), 'llms.txt missing ' + route)
  assert.ok(skill.includes(route), 'skill.txt missing ' + route)
  assert.ok(full.includes(route), 'llms-full.txt missing ' + route)
}

assert.ok(llms.includes('eight') || llms.includes('Eight'))
assert.ok(skill.includes('x402 v2'))
assert.ok(llms.includes('payment is not settled'))
assert.ok(skill.includes('payment is not settled'))
assert.ok(sitemap.includes('/.well-known/x402'))
assert.ok(robots.includes('Sitemap: https://pa-entity-x402.floot.app/sitemap.xml'))
assert.ok(security.length > 0)
assert.ok(!security.toLowerCase().includes('mailto:'))

assert.equal(deployMap.projectId, 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4')
assert.equal(deployMap.productionOrigin, ORIGIN)
assert.equal(deployMap.expectedPaidResourceCount, 8)
assert.equal(deployMap.writes.length, 26)
assert.equal(new Set(deployMap.writes.map(entry => entry.target)).size, 26)
assert.ok(deployMap.preserveTargets.includes('endpoints/pa-business_GET.ts'))
assert.ok(deployMap.preserveTargets.includes('endpoints/pa-entity-one_GET.ts'))

for (const entry of deployMap.writes) {
  assert.ok(entry.source.startsWith('docs/pa-entity-floot-'))
  assert.ok(
    entry.target.startsWith('endpoints/') || entry.target.startsWith('static/'),
    'unexpected Floot target ' + entry.target
  )
  assert.match(entry.gitBlobSha, /^[0-9a-f]{40}$/)
  assert.ok(Number.isInteger(entry.size) && entry.size > 0)
}

const recoveryText = [
  serializedManifest,
  serializedOpenApi,
  llms,
  full,
  skill,
  extensionless,
  servicesAlias,
  catalog,
  JSON.stringify(service),
  sitemap,
  robots,
].join('\n')
assert.ok(!recoveryText.includes('api-v2.appdeploy.ai'))

console.log('FLOOT_RECOVERY_DISCOVERY=PASS')
console.log('RESOURCE_COUNT=8')
console.log('OPENAPI_PATH_COUNT=8')
console.log('APPDEPLOY_RUNTIME_DEPENDENCIES=0')
