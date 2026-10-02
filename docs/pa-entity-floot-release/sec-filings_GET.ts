const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/sec-filings'
const SEC_UA = 'x402-sec-filings/1.0 https://pa-entity-x402.floot.app'

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
        'Authoritative recent SEC EDGAR filing metadata by ticker or CIK, with optional exact form filter and direct filing URLs.',
      mimeType: 'application/json',
      serviceName: 'SEC Recent Filings x402',
      tags: ['sec', 'edgar', 'filings', 'company-data'],
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
                    ticker: { type: 'string', maxLength: 12 },
                    cik: { type: 'string', maxLength: 10 },
                    form: { type: 'string', maxLength: 20 },
                    limit: { type: 'integer', minimum: 1, maximum: 25 },
                  },
                  anyOf: [{ required: ['ticker'] }, { required: ['cik'] }],
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
            queryParams: { ticker: 'AAPL', form: '10-K', limit: 1 },
          },
          output: {
            type: 'json',
            example: {
              company: {
                name: 'Apple Inc.',
                cik: '0000320193',
                tickers: ['AAPL'],
              },
              count: 1,
              filings: [
                {
                  form: '10-K',
                  accessionNumber: '0000320193-25-000079',
                },
              ],
              source: 'U.S. Securities and Exchange Commission EDGAR',
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

async function secJson(url: string): Promise<Record<string, any>> {
  const response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('sec_http_' + response.status)
  return (await response.json()) as Record<string, any>
}

function normalizeCik(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (!digits || digits.length > 10) return null
  return digits.padStart(10, '0')
}

async function resolveTicker(ticker: string): Promise<string | null> {
  const map = await secJson('https://www.sec.gov/files/company_tickers.json')
  const wanted = ticker.trim().toUpperCase()
  for (const value of Object.values(map)) {
    const row = value as Record<string, unknown>
    if (String(row.ticker ?? '').toUpperCase() === wanted) {
      return normalizeCik(String(row.cik_str ?? ''))
    }
  }
  return null
}

export async function lookupFilings(input: {
  ticker?: string
  cik?: string
  form?: string
  limit: number
}) {
  let cik = input.cik ? normalizeCik(input.cik) : null
  if (!cik && input.ticker) cik = await resolveTicker(input.ticker)
  if (!cik) throw new Error('company_not_found')

  const data = await secJson(
    'https://data.sec.gov/submissions/CIK' + cik + '.json'
  )
  const recent = (data.filings?.recent ?? {}) as Record<string, unknown[]>
  const forms = (recent.form ?? []) as unknown[]
  const formFilter = (input.form ?? '').trim().toUpperCase()
  const cikNoZero = String(Number.parseInt(cik, 10))
  const filings: Array<Record<string, unknown>> = []

  for (let i = 0; i < forms.length && filings.length < input.limit; i += 1) {
    const form = String(forms[i] ?? '')
    if (formFilter && form.toUpperCase() !== formFilter) continue
    const accessionNumber = String((recent.accessionNumber ?? [])[i] ?? '')
    const primaryDocument = String((recent.primaryDocument ?? [])[i] ?? '')
    const accessionCompact = accessionNumber.replace(/-/g, '')
    filings.push({
      form,
      filingDate: (recent.filingDate ?? [])[i] ?? null,
      reportDate: (recent.reportDate ?? [])[i] ?? null,
      acceptanceDateTime: (recent.acceptanceDateTime ?? [])[i] ?? null,
      accessionNumber,
      primaryDocument,
      primaryDocDescription: (recent.primaryDocDescription ?? [])[i] ?? null,
      filingUrl:
        accessionCompact && primaryDocument
          ? 'https://www.sec.gov/Archives/edgar/data/' +
            cikNoZero +
            '/' +
            accessionCompact +
            '/' +
            primaryDocument
          : null,
    })
  }

  return {
    company: {
      name: data.name ?? null,
      cik,
      tickers: data.tickers ?? [],
      exchanges: data.exchanges ?? [],
      sic: data.sic ?? null,
      sicDescription: data.sicDescription ?? null,
    },
    count: filings.length,
    filings,
    source: 'U.S. Securities and Exchange Commission EDGAR',
  }
}

function parseInput(url: URL) {
  const ticker = (url.searchParams.get('ticker') ?? '').trim()
  const cik = (url.searchParams.get('cik') ?? '').trim()
  const form = (url.searchParams.get('form') ?? '').trim()
  const rawLimit = url.searchParams.get('limit')
  let limit = 10
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d+$/.test(rawLimit)) throw new Error('invalid_limit')
    limit = Number(rawLimit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
      throw new Error('invalid_limit')
    }
  }
  if (!ticker && !cik) throw new Error('ticker_or_cik_required')
  if (ticker.length > 12) throw new Error('invalid_ticker')
  if (cik && !normalizeCik(cik)) throw new Error('invalid_cik')
  if (form.length > 20) throw new Error('invalid_form')
  return { ticker, cik, form, limit }
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

  let input
  try {
    input = parseInput(new URL(request.url))
  } catch (error) {
    return flootJson(
      { error: error instanceof Error ? error.message : 'invalid_input' },
      400
    )
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
    result = await lookupFilings(input)
  } catch (error) {
    const reason =
      error instanceof Error && error.message === 'company_not_found'
        ? 'company_not_found'
        : 'sec_source_unavailable'
    return flootJson(
      {
        error: reason,
        detail:
          reason === 'company_not_found'
            ? 'No SEC company could be resolved for the supplied ticker or CIK; payment was not settled.'
            : 'SEC EDGAR is temporarily unavailable; payment was not settled.',
      },
      reason === 'company_not_found' ? 404 : 502
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
