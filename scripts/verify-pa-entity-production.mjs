import assert from 'node:assert/strict'

const origin = process.argv[2] || 'https://pa-entity-x402.floot.app'
const endpoint = `${origin}/_api/pa-business?q=OpenAI&limit=1`
const bestEndpoint = `${origin}/_api/pa-entity-one?q=OpenAI`
const EXPECTED_PAYTO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const EXPECTED_NETWORK = 'eip155:8453'
const EXPECTED_AMOUNT = '5000'
const EXPECTED_BEST_AMOUNT = '1000'

function decodeHeader(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (normalized.length % 4)) % 4)
  return JSON.parse(Buffer.from(normalized + pad, 'base64').toString('utf8'))
}

async function fetchText(path, options) {
  const res = await fetch(origin + path, options)
  return { res, text: await res.text() }
}

function expectContentType(res, expected) {
  assert.match(
    res.headers.get('content-type') || '',
    expected,
    `${res.url} wrong content-type`,
  )
}

const checks = []

async function check(name, fn) {
  try {
    await fn()
    checks.push({ name, ok: true })
    console.log('PASS', name)
  } catch (error) {
    checks.push({ name, ok: false, error: String(error?.message || error) })
    console.error('FAIL', name, error)
  }
}

await check('openapi JSON', async () => {
  const { res, text } = await fetchText('/openapi.json')
  assert.equal(res.status, 200)
  expectContentType(res, /application\/json/i)
  const doc = JSON.parse(text)
  assert.equal(
    doc.paths['/_api/pa-business'].get.operationId,
    'pennsylvaniaBusinessRegistryCompanyIdentityLookup',
  )
  assert.equal(
    doc.paths['/_api/pa-business'].get['x-payment-info'].price.amount,
    '0.005000',
  )
  assert.equal(
    doc.paths['/_api/pa-entity-one'].get.operationId,
    'resolvePennsylvaniaBusinessBestMatch',
  )
  assert.equal(
    doc.paths['/_api/pa-entity-one'].get['x-payment-info'].price.amount,
    '0.001000',
  )
})

await check('llms.txt plain text', async () => {
  const { res, text } = await fetchText('/llms.txt')
  assert.equal(res.status, 200)
  expectContentType(res, /text\/plain/i)
  assert.match(text, /same PAYMENT-SIGNATURE/)
})

for (const path of [
  '/.well-known/x402.json',
  '/.well-known/x402-services.json',
  '/.well-known/x402-service.json',
  '/.well-known/x402-catalog.json',
  '/.well-known/agent-card.json',
]) {
  await check(`${path} JSON`, async () => {
    const { res, text } = await fetchText(path)
    assert.equal(res.status, 200)
    expectContentType(res, /application\/json/i)
    JSON.parse(text)
  })
}

await check('security.txt plain text', async () => {
  const { res, text } = await fetchText('/.well-known/security.txt')
  assert.equal(res.status, 200)
  expectContentType(res, /text\/plain/i)
  assert.match(text, /Contact:/)
})

await check('canonical extensionless x402 if supported', async () => {
  const { res, text } = await fetchText('/.well-known/x402')
  if (res.status === 403 || res.status === 404) {
    throw new Error(`canonical path unavailable: HTTP ${res.status}`)
  }
  assert.equal(res.status, 200)
  expectContentType(res, /application\/json/i)
  JSON.parse(text)
})

let paymentDoc

async function assertUnpaidChallenge(url, expectedAmount) {
  const res = await fetch(url)
  const text = await res.text()
  assert.equal(res.status, 402)
  expectContentType(res, /application\/json/i)
  assert.equal(res.headers.get('cache-control'), 'no-store')

  const encoded = res.headers.get('payment-required')
  assert.ok(encoded, 'PAYMENT-REQUIRED missing')
  const headerDoc = decodeHeader(encoded)
  const bodyDoc = JSON.parse(text)

  assert.deepEqual(headerDoc.accepts, bodyDoc.accepts)
  assert.deepEqual(headerDoc.resource, bodyDoc.resource)

  const accept = headerDoc.accepts[0]
  assert.equal(accept.network, EXPECTED_NETWORK)
  assert.equal(accept.amount, expectedAmount)
  assert.equal(accept.asset.toLowerCase(), EXPECTED_ASSET.toLowerCase())
  assert.equal(accept.payTo.toLowerCase(), EXPECTED_PAYTO.toLowerCase())
  assert.equal(accept.extra?.name, 'USD Coin')
  assert.equal(headerDoc.extensions?.bazaar?.info?.output?.example?.count, 1)
  return headerDoc
}

await check('unpaid enriched route real 402', async () => {
  paymentDoc = await assertUnpaidChallenge(endpoint, EXPECTED_AMOUNT)
})

await check('unpaid $0.001 best-match route real 402', async () => {
  const doc = await assertUnpaidChallenge(bestEndpoint, EXPECTED_BEST_AMOUNT)
  assert.match(doc.resource.url, /\/pa-entity-one$/)
  assert.deepEqual(doc.extensions?.bazaar?.info?.input?.queryParams, { q: 'OpenAI' })
})

await check('CORS exposed on enriched GET', async () => {
  const res = await fetch(endpoint, {
    headers: { Origin: 'https://buyer.example' },
  })
  assert.equal(res.status, 402)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  const exposed = (
    res.headers.get('access-control-expose-headers') || ''
  ).toLowerCase()
  assert.match(exposed, /payment-required/)
  assert.match(exposed, /payment-response/)
})

await check('CORS exposed on $0.001 best-match GET', async () => {
  const res = await fetch(bestEndpoint, {
    headers: { Origin: 'https://buyer.example' },
  })
  assert.equal(res.status, 402)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

await check('CORS enriched OPTIONS', async () => {
  const res = await fetch(endpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://buyer.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'payment-signature',
    },
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.match(
    res.headers.get('access-control-allow-headers') || '',
    /payment-signature/i,
  )
})

await check('CORS best-match OPTIONS', async () => {
  const res = await fetch(bestEndpoint, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://buyer.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'payment-signature',
    },
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

await check('malformed payment stays 402', async () => {
  const res = await fetch(endpoint, {
    headers: { 'PAYMENT-SIGNATURE': 'not-base64-json' },
  })
  const data = await res.json()
  assert.equal(res.status, 402)
  assert.equal(data.error, 'invalid_payment_header')
})

await check('invalid decoded payment stays 402, not outage', async () => {
  const value = Buffer.from(JSON.stringify({ x402Version: 2 }), 'utf8').toString(
    'base64',
  )
  const res = await fetch(endpoint, {
    headers: { 'PAYMENT-SIGNATURE': value },
  })
  const data = await res.json()
  assert.equal(res.status, 402)
  assert.ok(
    ['invalid_payload', 'payment_verification_failed'].includes(data.error),
    `unexpected error: ${data.error}`,
  )
})

await check('invalid signed retry query returns 400', async () => {
  const value = Buffer.from(JSON.stringify({ x402Version: 2 }), 'utf8').toString(
    'base64',
  )
  const res = await fetch(`${origin}/_api/pa-business?q=A&limit=1`, {
    headers: { 'PAYMENT-SIGNATURE': value },
  })
  assert.equal(res.status, 400)
})

await check('oversized payment header rejected', async () => {
  const payload = Buffer.from(
    JSON.stringify({ x402Version: 2, x: 'A'.repeat(70000) }),
    'utf8',
  ).toString('base64')

  try {
    const res = await fetch(endpoint, {
      headers: { 'PAYMENT-SIGNATURE': payload },
    })
    assert.ok(
      [400, 402, 413, 431].includes(res.status),
      `unexpected HTTP ${res.status}`,
    )
  } catch (error) {
    // An edge/network layer may terminate an oversized-header request before
    // an HTTP response reaches the client. That is still a safe rejection.
    assert.ok(error)
  }
})

await check('Market402 selftest enriched route', async () => {
  const res = await fetch('https://market402.com/selftest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: endpoint }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.summary?.failed, 0)
})

await check('Market402 selftest $0.001 route', async () => {
  const res = await fetch('https://market402.com/selftest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: bestEndpoint }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.summary?.failed, 0)
})

async function assertCdpValid(resource) {
  const res = await fetch(
    'https://api.cdp.coinbase.com/platform/v2/x402/validate',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource, method: 'GET' }),
    },
  )
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.valid, true)
  return data
}

await check('CDP enriched x402 validation', async () => {
  const data = await assertCdpValid(endpoint)
  const simulation =
    data.simulation?.status ||
    data.simulation?.result ||
    data.simulation ||
    data.status
  assert.ok(
    JSON.stringify(simulation).toLowerCase().includes('accept') ||
      data.valid === true,
    'CDP validation did not accept resource',
  )
})

await check('CDP $0.001 best-match x402 validation', async () => {
  const data = await assertCdpValid(bestEndpoint)
  assert.equal(data.valid, true)
})

await check('PayAI public stats readable', async () => {
  const resource = encodeURIComponent(
    `${origin}/_api/pa-business`,
  )
  const res = await fetch(
    `https://facilitator.payai.network/discovery/resources/${resource}/stats`,
  )
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(
    data.resource,
    `${origin}/_api/pa-business`,
  )
  console.log(
    'PAYAI_STATS',
    JSON.stringify({
      settlements: data.settlements,
      volume: data.volume,
      buyers: data.buyers,
      reliability: data.reliability,
    }),
  )
})

const failed = checks.filter(item => !item.ok)
console.log('\nSUMMARY', JSON.stringify({ origin, checks, failed }, null, 2))

if (failed.length) {
  process.exitCode = 1
}
