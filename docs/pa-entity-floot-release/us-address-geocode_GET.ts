const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/us-address-geocode'
const CENSUS_URL =
  'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'

const MAX_PAYMENT_HEADER_LENGTH = 16_384
const SOURCE_TIMEOUT_MS = 12_000
const FACILITATOR_TIMEOUT_MS = 6_000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers':
    'PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept',
  'access-control-expose-headers':
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, Retry-After',
}

type JsonRecord = Record<string, unknown>

function flootJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'content-type': 'application/json',
    'cache-control': status === 402 || status === 503 ? 'no-store' : 'no-cache',
    ...extraHeaders,
  }
  if (status !== 200) headers['x-floot-status'] = String(status)
  return new Response(JSON.stringify(body), { status: 200, headers })
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

function decodePayment(value: string): JsonRecord {
  if (value.length > MAX_PAYMENT_HEADER_LENGTH) {
    throw new Error('payment_header_too_large')
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'))
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as JsonRecord).x402Version !== 2
  ) {
    throw new Error('invalid_payment_payload')
  }
  return parsed as JsonRecord
}

function requirements() {
  return {
    scheme: 'exact',
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: 'USD Coin', version: '2' },
  }
}

export function paymentDocument() {
  return {
    x402Version: 2,
    resource: {
      url: PUBLIC_ENDPOINT,
      description:
        'Official U.S. Census address geocoding with standardized address, coordinates, and Census geography identifiers.',
      mimeType: 'application/json',
      serviceName: 'US Census Address Geocoder x402',
      tags: ['geocoding', 'address', 'census', 'reference-data'],
    },
    accepts: [requirements()],
    extensions: {
      bazaar: {
        schema: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              properties: {
                type: { const: 'http' },
                method: { const: 'GET' },
                queryParams: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', minLength: 6, maxLength: 240 },
                  },
                  required: ['address'],
                  additionalProperties: false,
                },
              },
              required: ['type', 'method', 'queryParams'],
              additionalProperties: false,
            },
            output: {
              type: 'object',
              properties: {
                type: { const: 'json' },
                example: { type: 'object' },
              },
              required: ['type', 'example'],
              additionalProperties: false,
            },
          },
          required: ['input', 'output'],
          additionalProperties: false,
        },
        info: {
          input: {
            type: 'http',
            method: 'GET',
            queryParams: {
              address: '4600 Silver Hill Rd, Washington, DC 20233',
            },
          },
          output: {
            type: 'json',
            example: {
              input: '4600 Silver Hill Rd, Washington, DC 20233',
              matched: true,
              matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233',
              coordinates: {
                longitude: -76.92836638093,
                latitude: 38.84505589808,
              },
              source: 'U.S. Census Bureau Geocoding Services',
              paid: true,
            },
          },
        },
      },
    },
  }
}

function paymentRequired(reason = 'payment_required', detail?: string) {
  const doc = paymentDocument()
  return flootJson(
    {
      error: reason,
      ...(detail ? { detail } : {}),
      ...doc,
      price: PRICE,
      currency: 'USDC',
      network: NETWORK,
      payTo: PAY_TO,
    },
    402,
    {
      'PAYMENT-REQUIRED': encodeHeader(doc),
      'x402-price': PRICE,
      'x402-asset': 'USDC',
      'x402-network': NETWORK,
      'x402-pay-to': PAY_TO,
    }
  )
}

function temporaryFailure(reason: string, detail: string) {
  return flootJson(
    {
      error: reason,
      detail,
      paymentState: 'unresolved',
      retrySamePayment: true,
    },
    503,
    { 'Retry-After': '2' }
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = SOURCE_TIMEOUT_MS
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function facilitatorPost(
  path: 'verify' | 'settle',
  paymentPayload: JsonRecord
): Promise<{ status: number; body: JsonRecord | null }> {
  const response = await fetchWithTimeout(
    FACILITATOR + '/' + path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements: requirements(),
      }),
    },
    FACILITATOR_TIMEOUT_MS
  )
  let body: JsonRecord | null = null
  try {
    const parsed = await response.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as JsonRecord
    }
  } catch {
    body = null
  }
  return { status: response.status, body }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function settleSamePayment(paymentPayload: JsonRecord): Promise<
  | { kind: 'settled'; receipt: JsonRecord }
  | { kind: 'terminal_failure'; reason: string; detail?: string }
  | { kind: 'unresolved'; reason: string; detail?: string }
> {
  const waits = [0, 250, 750]
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt] > 0) await sleep(waits[attempt])
    let response
    try {
      response = await facilitatorPost('settle', paymentPayload)
    } catch {
      if (attempt === waits.length - 1) {
        return { kind: 'unresolved', reason: 'settlement_transport_unknown' }
      }
      continue
    }
    if (response.body?.success === true) {
      return { kind: 'settled', receipt: response.body }
    }
    const reason =
      typeof response.body?.errorReason === 'string'
        ? response.body.errorReason
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'facilitator_unavailable'
            : 'payment_settlement_failed'
    const detail =
      typeof response.body?.errorMessage === 'string'
        ? response.body.errorMessage
        : undefined
    if (
      reason === 'settlement_pending' ||
      reason === 'duplicate_settlement' ||
      reason === 'rate_limited' ||
      reason === 'facilitator_unavailable'
    ) {
      if (attempt === waits.length - 1) {
        return { kind: 'unresolved', reason, detail }
      }
      continue
    }
    return { kind: 'terminal_failure', reason, detail }
  }
  return { kind: 'unresolved', reason: 'settlement_unknown' }
}

function firstGeoByKey(
  geographies: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = geographies[key]
  return Array.isArray(value) && value.length
    ? (value[0] as Record<string, unknown>)
    : null
}

function firstGeoByPattern(
  geographies: Record<string, unknown>,
  pattern: RegExp
): Record<string, unknown> | null {
  for (const [key, value] of Object.entries(geographies)) {
    if (pattern.test(key) && Array.isArray(value) && value.length) {
      return value[0] as Record<string, unknown>
    }
  }
  return null
}

export async function geocodeAddress(address: string) {
  const cleaned = address.trim().replace(/\s+/g, ' ')
  if (cleaned.length < 6 || cleaned.length > 240) {
    throw new Error('invalid_address')
  }

  const url = new URL(CENSUS_URL)
  url.searchParams.set('address', cleaned)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('vintage', 'Current_Current')
  url.searchParams.set('format', 'json')

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('census_http_' + response.status)

  const data = (await response.json()) as Record<string, any>
  const match = data.result?.addressMatches?.[0] as
    | Record<string, any>
    | undefined

  if (!match) {
    return {
      input: cleaned,
      matched: false,
      matchedAddress: null,
      coordinates: null,
      addressComponents: null,
      geographies: null,
      source: 'U.S. Census Bureau Geocoding Services',
    }
  }

  const geos = (match.geographies ?? {}) as Record<string, unknown>
  const state = firstGeoByKey(geos, 'States')
  const county = firstGeoByKey(geos, 'Counties')
  const tract = firstGeoByKey(geos, 'Census Tracts')
  const block =
    firstGeoByKey(geos, 'Census Blocks') ??
    firstGeoByPattern(geos, /^\d{4} Census Blocks$/i)
  const district = firstGeoByPattern(
    geos,
    /^(?:\d+(?:st|nd|rd|th) )?Congressional Districts$/i
  )

  return {
    input: cleaned,
    matched: true,
    matchedAddress: match.matchedAddress ?? null,
    coordinates: {
      longitude: match.coordinates?.x ?? null,
      latitude: match.coordinates?.y ?? null,
    },
    addressComponents: match.addressComponents ?? null,
    geographies: {
      stateFips: state?.STATE ?? null,
      countyFips: county?.COUNTY ?? null,
      countyGeoid: county?.GEOID ?? null,
      tract: tract?.TRACT ?? null,
      tractGeoid: tract?.GEOID ?? null,
      block: block?.BLOCK ?? null,
      blockGeoid: block?.GEOID ?? null,
      congressionalDistrict: district?.CD ?? district?.BASENAME ?? null,
    },
    source: 'U.S. Census Bureau Geocoding Services',
  }
}

export async function handle(request: Request) {
  const signature =
    request.headers.get('payment-signature') ??
    request.headers.get('x-payment')

  if (!signature) return paymentRequired()

  let paymentPayload: JsonRecord
  try {
    paymentPayload = decodePayment(signature)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return paymentRequired(
      message === 'payment_header_too_large'
        ? 'payment_header_too_large'
        : message === 'invalid_payment_payload'
          ? 'invalid_payment_payload'
          : 'invalid_payment_header'
    )
  }

  const address =
    new URL(request.url).searchParams.get('address')?.trim().replace(/\s+/g, ' ') ??
    ''
  if (address.length < 6 || address.length > 240) {
    return flootJson({ error: 'invalid_address' }, 400)
  }

  let verification
  try {
    verification = await facilitatorPost('verify', paymentPayload)
  } catch {
    return temporaryFailure(
      'payment_verifier_unavailable',
      'The payment verifier could not be reached. Retry the same payment authorization.'
    )
  }

  if (verification.body?.isValid !== true) {
    if (verification.body?.isValid === false) {
      return paymentRequired(
        typeof verification.body.invalidReason === 'string'
          ? verification.body.invalidReason
          : 'payment_verification_failed',
        typeof verification.body.invalidMessage === 'string'
          ? verification.body.invalidMessage
          : undefined
      )
    }
    return temporaryFailure(
      'payment_verifier_unavailable',
      'The payment verifier returned an unrecognized response. Retry the same payment authorization.'
    )
  }

  let result
  try {
    result = await geocodeAddress(address)
  } catch {
    return flootJson(
      {
        error: 'census_source_unavailable',
        detail:
          'U.S. Census geocoding is temporarily unavailable; payment was not settled.',
      },
      502
    )
  }

  const settlement = await settleSamePayment(paymentPayload)
  if (settlement.kind === 'unresolved') {
    return temporaryFailure(
      settlement.reason,
      settlement.detail ??
        'Settlement is unresolved. Retry with the same payment authorization.'
    )
  }
  if (settlement.kind === 'terminal_failure') {
    return paymentRequired(
      settlement.reason,
      settlement.detail ?? 'Payment could not be settled.'
    )
  }

  return flootJson(
    { ...result, paid: true, price: PRICE },
    200,
    {
      'PAYMENT-RESPONSE': encodeHeader(settlement.receipt),
      'x402-settled': 'true',
      'cache-control': 'no-store',
    }
  )
}
