import assert from 'node:assert/strict'
import {
  handle as handleTreasury,
  paymentDocument as treasuryPaymentDocument,
} from '../docs/pa-entity-floot-release/treasury-average-rates_GET.ts'
import {
  handle as handleRdap,
  paymentDocument as rdapPaymentDocument,
} from '../docs/pa-entity-floot-release/domain-rdap_GET.ts'
import {
  handle as handleCensus,
  paymentDocument as censusPaymentDocument,
} from '../docs/pa-entity-floot-release/us-address-geocode_GET.ts'
import {
  handle as handleSec,
  paymentDocument as secPaymentDocument,
} from '../docs/pa-entity-floot-release/sec-filings_GET.ts'
import {
  handle as handleOfac,
  paymentDocument as ofacPaymentDocument,
} from '../docs/pa-entity-floot-release/ofac-sdn-screen_GET.ts'

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

function csv(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/csv' },
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

function assertPaymentDocument(
  doc: ReturnType<typeof treasuryPaymentDocument>,
  resource: string
) {
  assert.equal(doc.x402Version, 2)
  assert.equal(doc.resource.url, resource)
  assert.equal(doc.accepts[0].amount, '5000')
  assert.equal(doc.accepts[0].network, 'eip155:8453')
  assert.equal(
    doc.accepts[0].asset.toLowerCase(),
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  )
  assert.equal(
    doc.accepts[0].payTo.toLowerCase(),
    '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
  )
  assert.equal(doc.extensions?.bazaar?.info?.input?.method, 'GET')
  assert.equal(doc.extensions?.bazaar?.schema?.type, 'object')
  assert.equal(
    doc.extensions?.bazaar?.schema?.properties?.input?.properties?.method?.const,
    'GET'
  )
  assert.equal(
    doc.extensions?.bazaar?.schema?.properties?.output?.properties?.type?.const,
    'json'
  )
  const serviceName = doc.resource.serviceName
  if (serviceName !== undefined) {
    assert.match(serviceName, /^[\x20-\x7E]+$/)
    assert.ok(serviceName.length >= 1 && serviceName.length <= 32)
  }
  const tags = doc.resource.tags ?? []
  assert.ok(tags.length <= 5)
  for (const tag of tags) {
    assert.match(tag, /^[\x20-\x7E]+$/)
    assert.ok(tag.length >= 1 && tag.length <= 32)
  }
}

async function assertChallenge(
  handler: (request: Request) => Promise<Response>,
  url: string
) {
  const response = await handler(new Request(url))
  assert.equal(status(response), 402)
  assert.ok(response.headers.get('payment-required'))
  assert.equal(response.headers.get('x402-network'), 'eip155:8453')
  assert.equal(response.headers.get('x402-price'), '$0.005')
}

assertPaymentDocument(
  treasuryPaymentDocument(),
  'https://pa-entity-x402.floot.app/_api/treasury-average-rates'
)
assertPaymentDocument(
  rdapPaymentDocument(),
  'https://pa-entity-x402.floot.app/_api/domain-rdap'
)
assertPaymentDocument(
  censusPaymentDocument(),
  'https://pa-entity-x402.floot.app/_api/us-address-geocode'
)
assertPaymentDocument(
  secPaymentDocument(),
  'https://pa-entity-x402.floot.app/_api/sec-filings'
)
assertPaymentDocument(
  ofacPaymentDocument(),
  'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen'
)

await assertChallenge(
  handleTreasury,
  'https://pa-entity-x402.floot.app/_api/treasury-average-rates'
)
await assertChallenge(
  handleRdap,
  'https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com'
)
await assertChallenge(
  handleCensus,
  'https://pa-entity-x402.floot.app/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233'
)
await assertChallenge(
  handleSec,
  'https://pa-entity-x402.floot.app/_api/sec-filings?ticker=AAPL&form=10-K&limit=1'
)
await assertChallenge(
  handleOfac,
  'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=3&minScore=90'
)

// Treasury paid success.
await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.includes('api.fiscaldata.treasury.gov')) {
    return json({
      data: [{
        record_date: '2026-08-31',
        security_type_desc: 'Marketable',
        security_desc: 'Total Marketable',
        avg_interest_rate_amt: '3.475',
      }],
    })
  }
  if (url.endsWith('/settle')) {
    return json({ success: true, transaction: '0xtreasury', network: 'eip155:8453' })
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

// RDAP success and source-failure non-settlement.
await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://data.iana.org/rdap/dns.json') {
    return json({ services: [[['com'], ['https://rdap.fixture.test/']]] })
  }
  if (url.startsWith('https://rdap.fixture.test/domain/')) {
    return json({
      handle: 'fixture',
      status: ['active'],
      entities: [],
      events: [{ eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' }],
      nameservers: [{ ldhName: 'NS1.EXAMPLE.TEST' }],
    })
  }
  if (url.endsWith('/settle')) {
    return json({ success: true, transaction: '0xrdap', network: 'eip155:8453' })
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
  const body = await response.json()
  assert.equal(body.domain, 'example.com')
  assert.equal(body.registered, true)
  assert.equal(body.authoritativeRdap, 'https://rdap.fixture.test/')
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://data.iana.org/rdap/dns.json') return new Response('down', { status: 503 })
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleRdap(
    new Request(
      'https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 502)
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 0)
})

// Census success and source-failure non-settlement.
await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.includes('geocoding.geo.census.gov')) {
    return json({
      result: {
        addressMatches: [{
          matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233',
          coordinates: { x: -76.92836638093, y: 38.84505589808 },
          addressComponents: { zip: '20233', city: 'WASHINGTON', state: 'DC' },
          geographies: {
            States: [{ STATE: '11' }],
            Counties: [{ COUNTY: '001', GEOID: '11001' }],
            'Census Tracts': [{ TRACT: '009802', GEOID: '11001009802' }],
          },
        }],
      },
    })
  }
  if (url.endsWith('/settle')) {
    return json({ success: true, transaction: '0xcensus', network: 'eip155:8453' })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleCensus(
    new Request(
      'https://pa-entity-x402.floot.app/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 200)
  const body = await response.json()
  assert.equal(body.matched, true)
  assert.equal(body.matchedAddress, '4600 SILVER HILL RD, WASHINGTON, DC, 20233')
  assert.equal(body.coordinates.latitude, 38.84505589808)
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.includes('geocoding.geo.census.gov')) return new Response('down', { status: 503 })
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleCensus(
    new Request(
      'https://pa-entity-x402.floot.app/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 502)
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 0)
})

// SEC success and source-failure non-settlement.
await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://www.sec.gov/files/company_tickers.json') {
    return json({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } })
  }
  if (url === 'https://data.sec.gov/submissions/CIK0000320193.json') {
    return json({
      name: 'Apple Inc.',
      tickers: ['AAPL'],
      exchanges: ['Nasdaq'],
      sic: '3571',
      sicDescription: 'Electronic Computers',
      filings: {
        recent: {
          form: ['10-K'],
          filingDate: ['2025-10-31'],
          reportDate: ['2025-09-27'],
          acceptanceDateTime: ['2025-10-31T14:01:26.000Z'],
          accessionNumber: ['0000320193-25-000079'],
          primaryDocument: ['aapl-20250927.htm'],
          primaryDocDescription: ['10-K'],
        },
      },
    })
  }
  if (url.endsWith('/settle')) {
    return json({ success: true, transaction: '0xsec', network: 'eip155:8453' })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleSec(
    new Request(
      'https://pa-entity-x402.floot.app/_api/sec-filings?ticker=AAPL&form=10-K&limit=1',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 200)
  const body = await response.json()
  assert.equal(body.company.cik, '0000320193')
  assert.equal(body.filings[0].form, '10-K')
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url === 'https://www.sec.gov/files/company_tickers.json') return new Response('down', { status: 503 })
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleSec(
    new Request(
      'https://pa-entity-x402.floot.app/_api/sec-filings?ticker=AAPL&limit=1',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 502)
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 0)
})

// OFAC success and source-failure non-settlement.
await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.endsWith('/SDN.CSV') || url.endsWith('/ALT.CSV')) {
    return new Response('down', { status: 503 })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleOfac(
    new Request(
      'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=3&minScore=90',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 502)
  assert.equal(
    calls.filter(call => call.url.endsWith('/settle')).length,
    0,
    'OFAC source failure must not settle'
  )
})

await withMockFetch(async url => {
  if (url.endsWith('/verify')) return json({ isValid: true })
  if (url.endsWith('/SDN.CSV')) {
    return csv(
      '35096,"PUTIN, Vladimir Vladimirovich",individual,RUSSIA-EO14024,President,-0-,-0-,-0-,-0-,-0-,-0-,fixture\n'
    )
  }
  if (url.endsWith('/ALT.CSV')) {
    return csv('35096,-0-,aka,VLADIMIR PUTIN,-0-\n')
  }
  if (url.endsWith('/settle')) {
    return json({ success: true, transaction: '0xofac', network: 'eip155:8453' })
  }
  throw new Error('unexpected URL ' + url)
}, async calls => {
  const response = await handleOfac(
    new Request(
      'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=3&minScore=90',
      { headers: { 'payment-signature': paymentHeader() } }
    )
  )
  assert.equal(status(response), 200)
  const body = await response.json()
  assert.equal(body.minScore, 90)
  assert.equal(body.totalCandidatesAboveThreshold, 1)
  assert.equal(body.candidates[0].uid, '35096')
  assert.equal(calls.filter(call => call.url.endsWith('/settle')).length, 1)
})

console.log('Floot raw rehost endpoint tests passed: Treasury, RDAP, Census, SEC, OFAC')
