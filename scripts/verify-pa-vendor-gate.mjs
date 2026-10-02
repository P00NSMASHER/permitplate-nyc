import assert from 'node:assert/strict'

const origin = (
  process.argv[2] || 'https://pa-entity-x402.floot.app'
).replace(/\/+$/, '')

const hostname = new URL(origin).hostname
const apiPrefix =
  process.env.VENDOR_GATE_API_PREFIX ||
  (hostname.endsWith('.floot.app') ? '/_api' : '/api')

const routePath = apiPrefix + '/vendor-intake-gate'
const bare = origin + routePath
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
  assert.ok(value, 'PAYMENT-REQUIRED header missing')
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

async function readJsonResponse(url, expectedStatus) {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'pa-vendor-gate-zero-spend-verifier/2.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(
      'response was not JSON: status=' +
        res.status +
        ' content-type=' +
        String(res.headers.get('content-type')) +
        ' body=' +
        text.slice(0, 300)
    )
  }
  if (
    res.headers.get('x-appdeploy-app-availability') ===
      'temporarily-unavailable' ||
    body?.code === 'APP_TEMPORARILY_UNAVAILABLE'
  ) {
    throw new Error('public serving layer reported APP_TEMPORARILY_UNAVAILABLE')
  }
  assert.equal(res.status, expectedStatus)
  return { res, body }
}

function assertTerms(doc) {
  assert.equal(doc?.x402Version, 2)
  assert.ok(Array.isArray(doc?.accepts) && doc.accepts.length > 0)
  const accept = doc.accepts[0]
  assert.equal(accept.scheme, 'exact')
  assert.equal(accept.network, EXPECTED_NETWORK)
  assert.equal(String(accept.amount), EXPECTED_AMOUNT)
  assert.equal(String(accept.asset).toLowerCase(), EXPECTED_ASSET.toLowerCase())
  assert.equal(String(accept.payTo).toLowerCase(), EXPECTED_PAYTO.toLowerCase())
  assert.equal(accept.extra?.name, 'USD Coin')
}

await check('bare vendor gate unpaid challenge', async () => {
  const { res, body } = await readJsonResponse(bare, 402)
  assertTerms(body)
  assert.equal(body.price, EXPECTED_PRICE)
  const encoded = res.headers.get('payment-required')
  const headerDoc = decodeHeader(encoded)
  assertTerms(headerDoc)
  assert.deepEqual(headerDoc.accepts, body.accepts)
  assert.deepEqual(headerDoc.resource, body.resource)
})

await check('executable vendor gate unpaid challenge', async () => {
  const { res, body } = await readJsonResponse(executable, 402)
  assertTerms(body)
  assert.equal(body.resource?.url, bare)
  assert.equal(res.headers.get('x402-price'), EXPECTED_PRICE)
  assert.equal(res.headers.get('x402-network'), EXPECTED_NETWORK)
  assert.equal(
    String(res.headers.get('x402-pay-to')).toLowerCase(),
    EXPECTED_PAYTO.toLowerCase()
  )
})

await check('canonical x402 discovery advertises vendor gate', async () => {
  const { body } = await readJsonResponse(origin + '/.well-known/x402', 200)
  assert.equal(body.x402Version, 2)
  const resource = body.resources?.find(item => item?.resource === bare)
  assert.ok(resource, 'vendor gate missing from /.well-known/x402')
  const terms = resource.accepts?.[0]
  assert.equal(resource.price ?? '$0.020', EXPECTED_PRICE)
  assert.equal(terms?.network, EXPECTED_NETWORK)
  assert.equal(String(terms?.amount), EXPECTED_AMOUNT)
  assert.equal(String(terms?.asset).toLowerCase(), EXPECTED_ASSET.toLowerCase())
  assert.equal(String(terms?.payTo).toLowerCase(), EXPECTED_PAYTO.toLowerCase())
})

await check('OpenAPI exposes vendor gate decision operation', async () => {
  const { body } = await readJsonResponse(origin + '/openapi.json', 200)
  const operation = body.paths?.[routePath]?.get
  assert.ok(operation, 'vendor gate path missing from OpenAPI: ' + routePath)
  assert.equal(operation.operationId, 'checkPennsylvaniaVendorIntakeGate')
  assert.equal(operation['x-payment-info']?.price?.amount, '0.020000')
})

await check('agent guide explains decision semantics', async () => {
  const skillCandidates = hostname.endsWith('.floot.app')
    ? ['/skill.txt', '/skill.md']
    : ['/skill.md', '/skill.txt']
  let text = null
  for (const path of skillCandidates) {
    const res = await fetch(origin + path, {
      headers: { 'user-agent': 'pa-vendor-gate-zero-spend-verifier/2.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 200) {
      text = await res.text()
      break
    }
  }
  assert.ok(text, 'no readable skill document')
  assert.match(text, /vendor-intake/i)
  assert.match(text, /proceed/i)
  assert.match(text, /human_review/i)
  assert.match(text, /\$0\.020/)
  assert.match(text, /not .*sanctions clearance|not sanctions clearance/i)
})

const failed = checks.filter(item => !item.ok)
console.log(
  'SUMMARY',
  JSON.stringify(
    {
      origin,
      routePath,
      bare,
      executable,
      checks,
      failed,
      zeroSpend: true,
      paymentSent: false,
    },
    null,
    2
  )
)

if (failed.length) process.exitCode = 1
