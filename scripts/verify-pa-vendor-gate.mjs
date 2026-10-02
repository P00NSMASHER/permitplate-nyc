import assert from 'node:assert/strict'

const origin =
  process.argv[2] ||
  'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s'

const bare = origin + '/api/vendor-intake-gate'
const executable =
  bare +
  '?name=OpenAI%20OpCo' +
  '&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101' +
  '&domain=openai.com'

const EXPECTED_PAYTO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const EXPECTED_NETWORK = 'eip155:8453'
const EXPECTED_AMOUNT = '20000'
const EXPECTED_PRICE = '$0.020'

const checks = []

function decodeHeader(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (normalized.length % 4)) % 4)
  return JSON.parse(Buffer.from(normalized + pad, 'base64').toString('utf8'))
}

async function check(name, fn) {
  try {
    await fn()
    checks.push({ name, ok: true })
    console.log('PASS', name)
  } catch (error) {
    const message = String(error?.stack || error?.message || error)
    checks.push({ name, ok: false, error: message })
    console.error('FAIL', name, message)
  }
}

async function assertChallenge(url) {
  const res = await fetch(url, { redirect: 'follow' })
  const text = await res.text()
  assert.equal(res.status, 402, 'expected unpaid HTTP 402')
  assert.match(res.headers.get('content-type') || '', /application\/json/i)

  const body = JSON.parse(text)
  assert.equal(body.x402Version, 2, '402 body missing x402Version=2')
  assert.ok(Array.isArray(body.accepts) && body.accepts.length > 0, '402 body accepts[] missing')

  const accept = body.accepts[0]
  assert.equal(accept.scheme, 'exact')
  assert.equal(accept.network, EXPECTED_NETWORK)
  assert.equal(String(accept.amount), EXPECTED_AMOUNT)
  assert.equal(String(accept.asset).toLowerCase(), EXPECTED_ASSET.toLowerCase())
  assert.equal(String(accept.payTo).toLowerCase(), EXPECTED_PAYTO.toLowerCase())
  assert.equal(accept.extra?.name, 'USD Coin')

  assert.equal(body.price, EXPECTED_PRICE)
  assert.equal(body.network, EXPECTED_NETWORK)
  assert.equal(String(body.payTo).toLowerCase(), EXPECTED_PAYTO.toLowerCase())

  const encoded = res.headers.get('payment-required')
  assert.ok(encoded, 'PAYMENT-REQUIRED header missing')
  const headerDoc = decodeHeader(encoded)
  assert.equal(headerDoc.x402Version, 2)
  assert.deepEqual(headerDoc.accepts, body.accepts)
  assert.deepEqual(headerDoc.resource, body.resource)

  assert.equal(res.headers.get('x402-price'), EXPECTED_PRICE)
  assert.equal(res.headers.get('x402-network'), EXPECTED_NETWORK)
  assert.equal(res.headers.get('x402-asset'), 'USDC')
  assert.equal(
    String(res.headers.get('x402-pay-to')).toLowerCase(),
    EXPECTED_PAYTO.toLowerCase(),
  )

  return { res, body, headerDoc }
}

await check('bare vendor gate unpaid challenge', async () => {
  await assertChallenge(bare)
})

await check('executable vendor gate unpaid challenge', async () => {
  const { body } = await assertChallenge(executable)
  assert.equal(body.resource?.url, bare)
})

await check('canonical x402 discovery advertises vendor gate', async () => {
  const res = await fetch(origin + '/.well-known/x402')
  assert.equal(res.status, 200)
  const doc = await res.json()
  assert.equal(doc.x402Version, 2)
  const resource = doc.resources?.find(item => item?.resource === bare)
  assert.ok(resource, 'vendor gate missing from /.well-known/x402')
  assert.equal(resource.price, EXPECTED_PRICE)
  assert.equal(resource.accepts?.[0]?.network, EXPECTED_NETWORK)
  assert.equal(String(resource.accepts?.[0]?.amount), EXPECTED_AMOUNT)
})

await check('OpenAPI exposes typed vendor gate', async () => {
  const res = await fetch(origin + '/openapi.json')
  assert.equal(res.status, 200)
  const doc = await res.json()
  assert.equal(
    doc.paths?.['/api/vendor-intake-gate']?.get?.operationId,
    'checkPennsylvaniaVendorIntakeGate',
  )
  const schema =
    doc.paths?.['/api/vendor-intake-gate']?.get?.responses?.['200']?.content?.[
      'application/json'
    ]?.schema
  assert.equal(schema?.properties?.decision?.type, 'string')
  assert.ok(schema?.properties?.evidence?.properties?.registry)
  assert.ok(schema?.properties?.evidence?.properties?.address)
  assert.ok(schema?.properties?.evidence?.properties?.ofac)
  assert.ok(schema?.properties?.evidence?.properties?.domain)
})

async function demo(sampleCase) {
  const res = await fetch(
    origin + '/api/vendor-intake-demo?case=' + encodeURIComponent(sampleCase),
  )
  assert.equal(res.status, 200)
  return await res.json()
}

await check('fixed proceed decision fixture', async () => {
  const data = await demo('proceed')
  assert.equal(data.decision, 'proceed')
  assert.equal(data.agentAction, 'continue_vendor_intake')
  assert.deepEqual(data.reviewTriggers, [])
  assert.equal(data.evidence?.registry?.complete, true)
  assert.equal(data.evidence?.address?.providedEvidenceComplete, true)
  assert.equal(data.evidence?.address?.registryEvidenceComplete, true)
  assert.equal(data.evidence?.ofac?.complete, true)
  assert.equal(data.evidence?.domain?.complete, true)
})

await check('fixed address mismatch fixture', async () => {
  const data = await demo('address_mismatch')
  assert.equal(data.decision, 'human_review')
  assert.ok(
    data.reviewTriggers?.some(
      trigger => trigger?.code === 'registered_address_differs',
    ),
  )
})

await check('fixed domain mismatch fixture', async () => {
  const data = await demo('domain_mismatch')
  assert.equal(data.decision, 'human_review')
  assert.ok(
    data.reviewTriggers?.some(
      trigger => trigger?.code === 'domain_name_not_aligned',
    ),
  )
})

await check('Market402 executable-url selftest', async () => {
  const res = await fetch('https://market402.com/selftest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: executable }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  console.log('MARKET402_VENDOR_GATE', JSON.stringify(data))
  assert.equal(data.ok, true)
  assert.equal(data.summary?.failed, 0)
})

const failed = checks.filter(item => !item.ok)
console.log(
  'SUMMARY',
  JSON.stringify({ origin, bare, executable, checks, failed }, null, 2),
)

if (failed.length) process.exitCode = 1
