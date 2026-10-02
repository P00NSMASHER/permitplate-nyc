import assert from 'node:assert/strict'
import {
  handle as handleTreasury,
  paymentDocument as treasuryPaymentDocument,
} from '../docs/pa-entity-floot-release/treasury-average-rates_GET.ts'
import {
  handle as handleRdap,
  paymentDocument as rdapPaymentDocument,
} from '../docs/pa-entity-floot-release/domain-rdap_GET.ts'

const realFetch = globalThis.fetch

function paymentHeader() {
  return Buffer.from(
    JSON.stringify({ x402Version: 2, payload: { fixture: true } }),
    'utf8'
  ).toString('base64')
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function status(response: Response) {
  return Number(response.headers.get('x-floot-status') ?? '200')
}

async function withMockFetch(
  responder: (
    url: string,
    init: RequestInit | undefined,
    calls: Array<{ url: string; init?: RequestInit }>
  ) => Response | Promise<Response>,
  fn: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return await responder(url, init, calls)
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = realFetch
  }
}

{
  const doc = treasuryPaymentDocument()
  assert.equal(doc.x402Version, 2)
  assert.equal(doc.resource.url, 'https://pa-entity-x402.floot.app/_api/treasury-average-rates')
  assert.equal(doc.accepts[0].amount, '5000')
  assert.equal(doc.accepts[0].network, 'eip155:8453')

  const challenge = await handleTreasury(
    new Request('https://pa-entity-x402.floot.app/_api/treasury-average-rates')
  )
  assert.equal(status(challenge), 402)
  assert.ok(challenge.headers.get('payment-required'))
}

await withMockFetch(async (url) => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.includes('api.fiscaldata.treasury.gov')) {
    return json({
      data: [
        {
          record_date: '2026-08-31',
          security_type_desc: 'Marketable',
          security_desc: 'Total Marketable',
          avg_interest_rate_amt: '3.475',
        },
      ],
    })
  }
  if (url.endsWith('/settle')) {
    return json({
      success: true,
      transaction: '0xtreasury',
      network: 'eip155:8453',
    })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleTreasury(
    new Request(
      'https://pa-entity-x402.floot.app/_api/treasury-average-rates?security=Total%20Marketable',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 200)
  assert.equal(response.headers.get('x402-settled'), 'true')
  const body = await response.json()
  assert.equal(body.recordDate, '2026-08-31')
  assert.equal(body.rates[0].averageInterestRatePercent, 3.475)
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

{
  const doc = rdapPaymentDocument()
  assert.equal(doc.x402Version, 2)
  assert.equal(doc.resource.url, 'https://pa-entity-x402.floot.app/_api/domain-rdap')
  assert.equal(doc.accepts[0].amount, '5000')
  assert.equal(doc.accepts[0].network, 'eip155:8453')

  const challenge = await handleRdap(
    new Request('https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com')
  )
  assert.equal(status(challenge), 402)
  assert.ok(challenge.headers.get('payment-required'))
}

await withMockFetch(async (url) => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://data.iana.org/rdap/dns.json') {
    return json({ services: [[['com'], ['https://rdap.fixture.test/']]] })
  }
  if (url.startsWith('https://rdap.fixture.test/domain/')) {
    return json({
      handle: 'fixture',
      status: ['active'],
      entities: [],
      events: [
        {
          eventAction: 'registration',
          eventDate: '1995-08-14T04:00:00Z',
        },
      ],
      nameservers: [{ ldhName: 'NS1.EXAMPLE.TEST' }],
    })
  }
  if (url.endsWith('/settle')) {
    return json({
      success: true,
      transaction: '0xrdap',
      network: 'eip155:8453',
    })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleRdap(
    new Request(
      'https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 200)
  assert.equal(response.headers.get('x402-settled'), 'true')
  const body = await response.json()
  assert.equal(body.domain, 'example.com')
  assert.equal(body.registered, true)
  assert.equal(body.authoritativeRdap, 'https://rdap.fixture.test/')
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

await withMockFetch(async (url) => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://data.iana.org/rdap/dns.json') {
    return new Response('down', { status: 503 })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleRdap(
    new Request(
      'https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 502)
  assert.equal(
    calls.filter(call => call.url.endsWith('/settle')).length,
    0,
    'RDAP source failure must not settle'
  )
})

console.log('Floot raw rehost endpoint tests passed: Treasury, RDAP')
