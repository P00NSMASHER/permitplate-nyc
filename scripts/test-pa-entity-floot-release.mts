import assert from 'node:assert/strict'
import {
  decodePayment,
  handle,
  normalizeCreationDate,
  parseLimit,
  paymentDocument,
} from '../docs/pa-entity-floot-release/pa-business_GET.ts'

const realFetch = globalThis.fetch

function signature(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function req(
  url = 'https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1',
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

assert.equal(parseLimit(null), 10)
assert.equal(parseLimit('25'), 25)
assert.throws(() => parseLimit('10garbage'), /invalid_limit/)
assert.throws(() => parseLimit('0'), /invalid_limit/)
assert.throws(() => decodePayment(signature({})), /invalid_payment_payload/)
assert.equal(paymentDocument().accepts[0].extra.name, 'USD Coin')
assert.equal(normalizeCreationDate('1753-01-01T00:00:00.000'), null)
assert.equal(normalizeCreationDate('1768-04-01T00:00:00.000'), '1768-04-01')
assert.equal(normalizeCreationDate('2025-04-23T00:00:00.000'), '2025-04-23')

{
  const res = await handle(req())
  assert.equal(status(res), 402)
  assert.ok(res.headers.get('PAYMENT-REQUIRED'))
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
}

{
  const request = new Request(
    'https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1',
    { headers: { 'PAYMENT-SIGNATURE': 'not-json' } },
  )
  const res = await handle(request)
  assert.equal(status(res), 402)
  assert.equal((await body(res)).error, 'invalid_payment_header')
}

await withMockFetch(async calls => {
  const res = await handle(req(
      'https://pa-entity-x402.floot.app/_api/pa-business',
      { x402Version: 2 },
    ))
  assert.equal(status(res), 400)
  assert.equal(calls.length, 0, 'invalid query must not call facilitator')
}, () => {
  throw new Error('fetch should not run')
})

await withMockFetch(async calls => {
  const res = await handle(req(undefined, { x402Version: 2 }))
  const parsed = await body(res)
  assert.equal(status(res), 402)
  assert.equal(parsed.error, 'invalid_payload')
  assert.equal(calls.length, 1)
}, async url => {
  assert.match(url, /\/verify$/)
  return new Response(
    JSON.stringify({
      isValid: false,
      invalidReason: 'invalid_payload',
      invalidMessage: 'x402Version: Invalid input',
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
})

await withMockFetch(async () => {
  const res = await handle(req(undefined, { x402Version: 2 }))
  const parsed = await body(res)
  assert.equal(status(res), 503)
  assert.equal(parsed.error, 'payment_verifier_unavailable')
  assert.equal(parsed.retrySamePayment, true)
  assert.equal(res.headers.get('PAYMENT-REQUIRED'), null)
}, async () => {
  throw new Error('network down')
})

await withMockFetch(async calls => {
  const res = await handle(req(undefined, { x402Version: 2 }))
  assert.equal(status(res), 502)
  assert.equal(
    calls.filter(c => c.url.endsWith('/settle')).length,
    0,
    'source failure must never settle',
  )
}, async url => {
  if (url.endsWith('/verify')) {
    return new Response(JSON.stringify({ isValid: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (url.includes('data.pa.gov')) {
    return new Response('upstream fail', { status: 503 })
  }
  throw new Error('unexpected URL ' + url)
})

await withMockFetch(async calls => {
  const res = await handle(req(undefined, { x402Version: 2 }))
  const parsed = await body(res)

  assert.equal(status(res), 200)
  assert.equal(parsed.count, 1)
  assert.equal(parsed.results[0].businessName, 'Openai, L.l.c.')
  assert.equal(parsed.results[0].creationDate, '2025-04-23')
  assert.equal(parsed.results[0].principals[0].role, 'Governor')
  assert.equal(parsed.enrichment.principals, 'complete')
  assert.equal(res.headers.get('x402-settled'), 'true')
  assert.ok(res.headers.get('PAYMENT-RESPONSE'))

  const settlements = calls.filter(c => c.url.endsWith('/settle'))
  assert.equal(settlements.length, 2)
  assert.equal(
    String(settlements[0].init?.body),
    String(settlements[1].init?.body),
    'pending retry must submit identical settlement body',
  )
}, async (url, _init, calls) => {
  if (url.endsWith('/verify')) {
    return new Response(JSON.stringify({ isValid: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (url.includes('data.pa.gov') && url.includes('party_type')) {
    return new Response(
      JSON.stringify([
        {
          filing_number: '0014371957',
          party_type: 'Governor',
        },
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
          address_line1: '600 North Second Street, Suite 401',
          city: 'Harrisburg',
          state: 'PA',
          zip: '17101',
          typeofbusinessregistration: 'Foreign Limited Liability Company',
          creationdate: '2025-09-29T00:00:00.000',
          shortcountyname: 'Dauphin',
          county_code: '22',
        },
        {
          business_name: 'Openai, L.l.c.',
          filing_number: '0014371957',
          address_line1: '600 North Second Street, Suite 401',
          city: 'Harrisburg',
          state: 'PA',
          zip: '17101',
          typeofbusinessregistration: 'Foreign Limited Liability Company',
          creationdate: '2025-04-23T00:00:00.000',
          shortcountyname: 'Dauphin',
          county_code: '22',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  if (url.endsWith('/settle')) {
    const count = calls.filter(c => c.url.endsWith('/settle')).length
    if (count === 1) {
      return new Response(
        JSON.stringify({
          success: false,
          errorReason: 'settlement_pending',
          errorMessage: 'still confirming',
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        transaction: '0xabc',
        network: 'eip155:8453',
        payer: '0xbuyer',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  throw new Error('unexpected URL ' + url)
})

await withMockFetch(async calls => {
  const res = await handle(req(undefined, { x402Version: 2 }))
  const parsed = await body(res)
  assert.equal(status(res), 503)
  assert.equal(parsed.paymentState, 'unresolved')
  assert.equal(parsed.retrySamePayment, true)
  assert.equal(res.headers.get('PAYMENT-REQUIRED'), null)
  assert.equal(res.headers.get('Retry-After'), '2')
  assert.equal(calls.filter(c => c.url.endsWith('/settle')).length, 3)
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
        errorReason: 'duplicate_settlement',
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )
  }

  throw new Error('unexpected URL ' + url)
})

console.log('PA Entity Floot hardened release tests passed')
