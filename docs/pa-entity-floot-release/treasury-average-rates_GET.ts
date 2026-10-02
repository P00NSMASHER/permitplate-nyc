const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/treasury-average-rates'
const TREASURY_API =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates'

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
        'Latest monthly average interest rates on outstanding U.S. Treasury securities from official Treasury Fiscal Data, optionally filtered by security description.',
      mimeType: 'application/json',
      serviceName: 'Treasury Average Interest Rates x402',
      tags: ['treasury', 'interest-rates', 'macro', 'fiscal-data'],
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
                    security: { type: 'string', maxLength: 100 },
                  },
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
            queryParams: { security: 'Total Marketable' },
          },
          output: {
            type: 'json',
            example: {
              recordDate: '2026-08-31',
              count: 1,
              rates: [
                {
                  securityDescription: 'Total Marketable',
                  securityType: 'Marketable',
                  averageInterestRatePercent: 3.475,
                },
              ],
              source:
                'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
              frequency: 'monthly',
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

export async function latestRates(security: string) {
  if (security.length > 100) throw new Error('invalid_security_filter')

  const url = new URL(TREASURY_API)
  url.searchParams.set(
    'fields',
    'record_date,security_type_desc,security_desc,avg_interest_rate_amt'
  )
  url.searchParams.set('sort', '-record_date')
  url.searchParams.set('page[size]', '100')

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'x402-treasury-average-rates/1.0 (https://pa-entity-x402.floot.app)',
    },
  })
  if (!response.ok) throw new Error('treasury_http_' + response.status)

  const payload = (await response.json()) as {
    data?: Array<Record<string, string>>
  }
  const rows = payload.data ?? []
  if (!rows.length) throw new Error('treasury_empty')

  const recordDate = String(rows[0].record_date ?? '')
  const needle = security.trim().toLowerCase()
  const latest = rows.filter(row => String(row.record_date ?? '') === recordDate)
  const filtered = needle
    ? latest.filter(row =>
        String(row.security_desc ?? '').toLowerCase().includes(needle)
      )
    : latest

  return {
    recordDate,
    count: filtered.length,
    rates: filtered.map(row => ({
      securityDescription: row.security_desc ?? null,
      securityType: row.security_type_desc ?? null,
      averageInterestRatePercent:
        row.avg_interest_rate_amt === '' || row.avg_interest_rate_amt == null
          ? null
          : Number(row.avg_interest_rate_amt),
    })),
    source:
      'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
    frequency: 'monthly',
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

  const security = new URL(request.url).searchParams.get('security')?.trim() ?? ''
  if (security.length > 100) {
    return flootJson({ error: 'invalid_security_filter' }, 400)
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
    result = await latestRates(security)
  } catch {
    return flootJson(
      {
        error: 'treasury_source_unavailable',
        detail:
          'Treasury Fiscal Data is temporarily unavailable; payment was not settled.',
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
