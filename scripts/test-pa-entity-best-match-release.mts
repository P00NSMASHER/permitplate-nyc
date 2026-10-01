import assert from 'node:assert/strict'
import {
  handle,
  normalizeCreationDate,
  paymentDocument,
} from '../docs/pa-entity-floot-release/pa-entity-one_GET.ts'

const realFetch = globalThis.fetch

function signature(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function req(
  url = 'https://pa-entity-x402.floot.app/_api/pa-entity-one?q=OpenAI',
  payment?: unknown,
) {
  const headers: Record<string, string> = {}
  if (payment !== undefined) headers['PAYMENT-SIGNATURE'] = signature(payment)
  return new Request(url, { headers })
}

async function body(res: Response) {
  return JSON.parse(await res.text())
}

function status(res: Response) {
  return Number(res.headers.get('x-floot-status') ?? '200')
}

async function withMockFetch(
  fn: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
  responder: (
    url: string,
    init: RequestInit | undefined,
    calls: Array<{ url: string; init?: RequestInit }>,
  ) => Promise<Response> | Response,
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

const doc = paymentDocument()
assert.equal(doc.resource.url, 'https://pa-entity-x402.floot.app/_api/pa-entity-one')
assert.equal(doc.accepts[0].amount, '1000')
assert.equal(doc.accepts[0].network, 'eip155:8453')
assert.equal(doc.accepts[0].extra.name, 'USD Coin')
assert.deepEqual(doc.extensions.bazaar.info.input.queryParams, { q: 'OpenAI' })
assert.equal(normalizeCreationDate('1753-01-01T00:00:00.000'), null)
assert.equal(normalizeCreationDate('1768-04-01T00:00:00.000'), '1768-04-01')
assert.equal(normalizeCreationDate('2025-04-23T00:00:00.000'), '2025-04-23')

{
  const res = await handle({ request: req() })
  assert.equal(status(res), 402)
  assert.equal((await body(res)).price, '$0.001')
  assert.ok(res.headers.get('PAYMENT-REQUIRED'))
}

await withMockFetch(async calls => {
  const res = await handle({
    request: req('https://pa-entity-x402.floot.app/_api/pa-entity-one?q=A', {
      x402Version: 2,
    }),
  })
  assert.equal(status(res), 400)
  assert.equal(calls.length, 0)
}, () => {
  throw new Error('invalid query must not call fetch')
})

await withMockFetch(async calls => {
  const res = await handle({ request: req(undefined, { x402Version: 2 }) })
  const parsed = await body(res)
  assert.equal(status(res), 200)
  assert.equal(parsed.found, true)
  assert.equal(parsed.result.businessName, 'Openai, L.l.c.')
  assert.equal(parsed.count, 1)
  assert.equal(parsed.results.length, 1)
  assert.equal(parsed.results[0].businessName, 'Openai, L.l.c.')
  assert.equal(parsed.results[0].filingNumber, '0014371957')
  assert.equal(parsed.results[0].creationDate, '2025-04-23')
  assert.equal(parsed.results[0].principals[0].role, 'Governor')
  assert.equal(res.headers.get('x402-settled'), 'true')
  assert.ok(res.headers.get('PAYMENT-RESPONSE'))

  const settleCalls = calls.filter(c => c.url.endsWith('/settle'))
  assert.equal(settleCalls.length, 1)
  const settleBody = JSON.parse(String(settleCalls[0].init?.body))
  assert.equal(settleBody.paymentRequirements.amount, '1000')
}, async url => {
  if (url.endsWith('/verify')) {
    return new Response(JSON.stringify({ isValid: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (url.includes('data.pa.gov') && url.includes('party_type')) {
    return new Response(
      JSON.stringify([
        { filing_number: '0014371957', party_type: 'Governor' },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  if (url.includes('data.pa.gov')) {
    return new Response(
      JSON.stringify([
        {
          business_name: 'Openai Opco, Llc',
          filing_number: '0014879623',
          typeofbusinessregistration: 'Foreign Limited Liability Company',
          creationdate: '2025-09-29T00:00:00.000',
        },
        {
          business_name: 'Openai, L.l.c.',
          filing_number: '0014371957',
          typeofbusinessregistration: 'Foreign Limited Liability Company',
          creationdate: '2025-04-23T00:00:00.000',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  if (url.endsWith('/settle')) {
    return new Response(
      JSON.stringify({
        success: true,
        transaction: '0xcheap',
        network: 'eip155:8453',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  throw new Error('unexpected URL ' + url)
})

await withMockFetch(async calls => {
  const res = await handle({ request: req(undefined, { x402Version: 2 }) })
  const parsed = await body(res)
  assert.equal(status(res), 503)
  assert.equal(parsed.retrySamePayment, true)
  assert.equal(res.headers.get('PAYMENT-REQUIRED'), null)
  assert.equal(calls.filter(c => c.url.endsWith('/settle')).length, 3)
  const bodies = calls
    .filter(c => c.url.endsWith('/settle'))
    .map(c => String(c.init?.body))
  assert.ok(bodies.every(value => value === bodies[0]))
}, async url => {
  if (url.endsWith('/verify')) {
    return new Response(JSON.stringify({ isValid: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (url.includes('data.pa.gov') && url.includes('party_type')) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (url.includes('data.pa.gov')) {
    return new Response(
      JSON.stringify([
        {
          business_name: 'Openai, L.l.c.',
          filing_number: '0014371957',
          typeofbusinessregistration: 'Foreign Limited Liability Company',
          creationdate: '2025-04-23T00:00:00.000',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  if (url.endsWith('/settle')) {
    return new Response(
      JSON.stringify({
        success: false,
        errorReason: 'settlement_pending',
      }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    )
  }

  throw new Error('unexpected URL ' + url)
})

console.log('PA Entity $0.001 best-match release tests passed')
