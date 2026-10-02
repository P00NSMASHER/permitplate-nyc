import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  handle,
  paymentDocument,
  runVendorGate,
} from '../docs/pa-entity-floot-release/vendor-intake-gate_GET.ts'

const endpointPath =
  'docs/pa-entity-floot-release/vendor-intake-gate_GET.ts'
const source = fs.readFileSync(endpointPath, 'utf8')

assert.ok(!source.includes('api-v2.appdeploy.ai'))
assert.ok(source.includes('https://data.pa.gov/resource/xvd7-5r2c.json'))
assert.ok(source.includes('geocoding.geo.census.gov'))
assert.ok(source.includes('sanctionslistservice.ofac.treas.gov'))
assert.ok(source.includes('https://data.iana.org/rdap/dns.json'))

const originalFetch = globalThis.fetch

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function csvResponse(text: string) {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'text/csv' },
  })
}

globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit
) => {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  const url = new URL(raw)

  if (raw === 'https://facilitator.payai.network/verify') {
    assert.equal(init?.method, 'POST')
    return jsonResponse({ isValid: true })
  }

  if (raw === 'https://facilitator.payai.network/settle') {
    assert.equal(init?.method, 'POST')
    return jsonResponse({
      success: true,
      transaction: '0xfixture',
      network: 'eip155:8453',
    })
  }

  if (url.hostname === 'data.pa.gov') {
    return jsonResponse([
      {
        business_name: 'OpenAI OpCo, LLC',
        filing_number: '0014879623',
        typeofbusinessregistration: 'Foreign Limited Liability Company',
        creationdate: '2025-04-23T00:00:00.000',
        address_line1: '600 North Second Street, Suite 401',
        address_line2: null,
        city: 'Harrisburg',
        state: 'PA',
        zip: '17101',
        shortcountyname: 'Dauphin',
        county_code: '22',
      },
    ])
  }

  if (url.hostname === 'geocoding.geo.census.gov') {
    const address = url.searchParams.get('address') ?? ''
    const isSilverHill = /Silver Hill/i.test(address)
    return jsonResponse({
      result: {
        addressMatches: [
          {
            matchedAddress: isSilverHill
              ? '4600 SILVER HILL RD, WASHINGTON, DC, 20233'
              : '600 N 2ND ST, HARRISBURG, PA, 17101',
            coordinates: isSilverHill
              ? { x: -76.92836638093, y: 38.84505589808 }
              : { x: -76.884, y: 40.2637 },
          },
        ],
      },
    })
  }

  if (
    raw ===
    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV'
  ) {
    return csvResponse(
      '123,SOME OTHER NAME,individual,SDGT,-0-,-0-,-0-,-0-,-0-,-0-,-0-,fixture\n'
    )
  }

  if (
    raw ===
    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV'
  ) {
    return csvResponse('123,-0-,aka,UNRELATED ALIAS,-0-\n')
  }

  if (raw === 'https://data.iana.org/rdap/dns.json') {
    return jsonResponse({
      services: [[['com'], ['https://rdap.fixture.test/']]],
    })
  }

  if (url.hostname === 'rdap.fixture.test') {
    const domain = decodeURIComponent(url.pathname.split('/').pop() ?? '')
    return jsonResponse({
      ldhName: domain,
      handle: 'fixture',
      status: ['active'],
      entities: [],
      events: [
        {
          eventAction: 'registration',
          eventDate: '2025-01-01T00:00:00Z',
        },
      ],
    })
  }

  throw new Error('unexpected fetch: ' + raw)
}) as typeof fetch

try {
  const doc = paymentDocument()
  assert.equal(doc.x402Version, 2)
  assert.equal(doc.resource.url, 'https://pa-entity-x402.floot.app/_api/vendor-intake-gate')
  assert.equal(doc.accepts[0].network, 'eip155:8453')
  assert.equal(doc.accepts[0].amount, '20000')
  assert.equal(
    doc.accepts[0].asset.toLowerCase(),
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  )
  assert.equal(
    doc.accepts[0].payTo.toLowerCase(),
    '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
  )
  assert.equal(doc.accepts[0].extra.name, 'USD Coin')
  assert.equal(typeof doc.resource.serviceName, 'string')
  assert.ok(doc.resource.serviceName.length > 0 && doc.resource.serviceName.length <= 32)
  assert.match(doc.resource.serviceName, /^[\x20-\x7E]+$/)
  assert.ok(Array.isArray(doc.resource.tags))
  assert.ok(doc.resource.tags.length <= 5)
  for (const tag of doc.resource.tags) {
    assert.ok(tag.length > 0 && tag.length <= 32)
    assert.match(tag, /^[\x20-\x7E]+$/)
  }

  const base =
    'https://pa-entity-x402.floot.app/_api/vendor-intake-gate'
  const goodUrl =
    base +
    '?name=OpenAI%20OpCo' +
    '&address=600%20North%20Second%20Street%2C%20Suite%20401%2C%20Harrisburg%2C%20PA%2017101' +
    '&domain=openai.com'

  const challenge = await handle(new Request(goodUrl))
  assert.equal(challenge.headers.get('x-floot-status'), '402')
  assert.equal(challenge.headers.get('x402-price'), '$0.020')
  const challengeBody = await challenge.json()
  assert.equal(challengeBody.x402Version, 2)
  assert.equal(challengeBody.accepts[0].amount, '20000')
  assert.ok(challenge.headers.get('payment-required'))

  const fakePayment = Buffer.from(
    JSON.stringify({ x402Version: 2, payload: { fixture: true } }),
    'utf8'
  ).toString('base64')

  const paid = await handle(
    new Request(goodUrl, {
      headers: { 'payment-signature': fakePayment },
    })
  )
  assert.equal(paid.headers.get('x-floot-status'), null)
  assert.equal(paid.headers.get('x402-settled'), 'true')
  assert.ok(paid.headers.get('payment-response'))
  const paidBody = await paid.json()
  assert.equal(paidBody.decision, 'proceed')
  assert.equal(paidBody.agentAction, 'continue_vendor_intake')
  assert.deepEqual(paidBody.reviewTriggers, [])
  assert.equal(paidBody.paid, true)
  assert.equal(paidBody.price, '$0.020')
  assert.equal(paidBody.evidence.registry.complete, true)
  assert.equal(paidBody.evidence.address.providedEvidenceComplete, true)
  assert.equal(paidBody.evidence.address.registryEvidenceComplete, true)
  assert.equal(paidBody.evidence.ofac.complete, true)
  assert.equal(paidBody.evidence.domain.complete, true)

  const addressReview = await runVendorGate({
    name: 'OpenAI OpCo',
    address: '4600 Silver Hill Rd, Washington, DC 20233',
    domain: 'openai.com',
  })
  assert.equal(addressReview.decision, 'human_review')
  assert.ok(
    addressReview.reviewTriggers.some(
      trigger => trigger.code === 'registered_address_differs'
    )
  )

  const domainReview = await runVendorGate({
    name: 'OpenAI OpCo',
    address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
    domain: 'example.com',
  })
  assert.equal(domainReview.decision, 'human_review')
  assert.ok(
    domainReview.reviewTriggers.some(
      trigger => trigger.code === 'domain_name_not_aligned'
    )
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: doc.resource.url,
        amount: doc.accepts[0].amount,
        network: doc.accepts[0].network,
        proceedDecision: paidBody.decision,
        addressReviewTriggers: addressReview.reviewTriggers.map(x => x.code),
        domainReviewTriggers: domainReview.reviewTriggers.map(x => x.code),
        appDeployDependencies: 0,
      },
      null,
      2
    )
  )
} finally {
  globalThis.fetch = originalFetch
}
