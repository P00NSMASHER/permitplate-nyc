import assert from 'node:assert/strict'
import { handle as handleTreasury } from '../docs/pa-entity-floot-release/treasury-average-rates_GET.ts'
import { handle as handleRdap } from '../docs/pa-entity-floot-release/domain-rdap_GET.ts'
import { handle as handleCensus } from '../docs/pa-entity-floot-release/us-address-geocode_GET.ts'
import { handle as handleSec } from '../docs/pa-entity-floot-release/sec-filings_GET.ts'
import { handle as handleOfac } from '../docs/pa-entity-floot-release/ofac-sdn-screen_GET.ts'
import { handle as handleVendor } from '../docs/pa-entity-floot-release/vendor-intake-gate_GET.ts'

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

function logicalStatus(response: Response) {
  return Number(response.headers.get('x-floot-status') ?? String(response.status))
}

let verifyCalls = 0
let settleCalls = 0
let upstreamCalls = 0

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  if (url === 'https://facilitator.payai.network/verify') {
    verifyCalls += 1
    return json({ isValid: true })
  }

  if (url === 'https://facilitator.payai.network/settle') {
    settleCalls += 1
    return json({
      success: true,
      transaction: '0xlocal-fixture-only',
      network: 'eip155:8453',
    })
  }

  upstreamCalls += 1
  return await realFetch(input as any, init)
}) as typeof fetch

const results: Array<{ name: string; ok: boolean; latencyMs: number; detail?: string }> = []

async function run(name: string, fn: () => Promise<void>) {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, latencyMs: Date.now() - started })
    console.log('PASS ' + name + ' latencyMs=' + (Date.now() - started))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, latencyMs: Date.now() - started, detail })
    console.log('FAIL ' + name + ' ' + detail)
  }
}

try {
  await run('Treasury exact release endpoint -> real Fiscal Data', async () => {
    const response = await handleTreasury(
      new Request(
        'https://pa-entity-x402.floot.app/_api/treasury-average-rates?security=Total%20Marketable',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    assert.equal(response.headers.get('x402-settled'), 'true')
    const body = await response.json()
    assert.equal(typeof body.recordDate, 'string')
    assert.ok(Array.isArray(body.rates) && body.rates.length >= 1)
    assert.equal(body.source.includes('U.S. Treasury'), true)
  })

  await run('RDAP exact release endpoint -> real IANA/registry', async () => {
    const response = await handleRdap(
      new Request(
        'https://pa-entity-x402.floot.app/_api/domain-rdap?domain=example.com',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    const body = await response.json()
    assert.equal(body.domain, 'example.com')
    assert.equal(body.registered, true)
    assert.match(String(body.authoritativeRdap), /^https?:\/\//)
  })

  await run('Census exact release endpoint -> real Census geocoder', async () => {
    const response = await handleCensus(
      new Request(
        'https://pa-entity-x402.floot.app/_api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    const body = await response.json()
    assert.equal(body.matched, true)
    assert.equal(typeof body.matchedAddress, 'string')
    assert.ok(Number.isFinite(body.coordinates?.latitude))
    assert.ok(Number.isFinite(body.coordinates?.longitude))
  })

  await run('SEC exact release endpoint -> real EDGAR', async () => {
    const response = await handleSec(
      new Request(
        'https://pa-entity-x402.floot.app/_api/sec-filings?ticker=AAPL&form=10-K&limit=1',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    const body = await response.json()
    assert.equal(body.company?.cik, '0000320193')
    assert.equal(body.filings?.[0]?.form, '10-K')
  })

  await run('OFAC exact release endpoint -> real SDN/ALT files', async () => {
    const response = await handleOfac(
      new Request(
        'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=3&minScore=90',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    const body = await response.json()
    assert.equal(body.query, 'VLADIMIR PUTIN')
    assert.equal(body.minScore, 90)
    assert.ok(body.totalCandidatesAboveThreshold >= 1)
    assert.ok(Array.isArray(body.candidates) && body.candidates.length >= 1)
  })

  await run('Vendor gate exact release endpoint -> real PA/Census/OFAC/RDAP', async () => {
    const response = await handleVendor(
      new Request(
        'https://pa-entity-x402.floot.app/_api/vendor-intake-gate' +
          '?name=OpenAI%20OpCo' +
          '&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101' +
          '&domain=openai.com',
        { headers: { 'payment-signature': paymentHeader() } }
      )
    )
    assert.equal(logicalStatus(response), 200)
    assert.equal(response.headers.get('x402-settled'), 'true')
    const body = await response.json()
    assert.equal(body.decision, 'proceed')
    assert.deepEqual(body.reviewTriggers, [])
    assert.equal(body.evidence.registry.complete, true)
    assert.equal(body.evidence.address.providedEvidenceComplete, true)
    assert.equal(body.evidence.address.registryEvidenceComplete, true)
    assert.equal(body.evidence.ofac.complete, true)
    assert.equal(body.evidence.domain.complete, true)
  })
} finally {
  globalThis.fetch = realFetch
}

const passed = results.filter((x) => x.ok).length
console.log(
  JSON.stringify(
    {
      zeroSpend: true,
      paymentSent: false,
      facilitatorNetworkCalls: 0,
      mockedVerifyCalls: verifyCalls,
      mockedSettleCalls: settleCalls,
      realUpstreamCalls: upstreamCalls,
      passed,
      total: results.length,
      results,
    },
    null,
    2
  )
)

if (passed !== results.length) process.exitCode = 1
