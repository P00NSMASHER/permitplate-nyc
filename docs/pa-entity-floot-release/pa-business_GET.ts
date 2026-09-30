const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const SOURCE = 'https://data.pa.gov/resource/xvd7-5r2c.json'
const SOURCE_LABEL = 'Pennsylvania Department of State via data.pa.gov'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/pa-business'

const MAX_QUERY_LENGTH = 120
const MAX_PAYMENT_HEADER_LENGTH = 16_384
const SOURCE_TIMEOUT_MS = 10_000
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

type Principal = {
  role: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
}

type EntityResult = {
  businessName: string | null
  filingNumber: string | null
  registrationType: string | null
  creationDate: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  countyCode: string | null
  principals: Principal[]
}

function corsHeaders(extra: Record<string, string> = {}) {
  return { ...CORS_HEADERS, ...extra }
}

function flootJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = corsHeaders({
    'content-type': 'application/json',
    'cache-control': status === 402 || status === 503 ? 'no-store' : 'no-cache',
    ...extraHeaders,
  })
  if (status !== 200) headers['x-floot-status'] = String(status)

  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  })
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

export function decodePayment(value: string): JsonRecord {
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

function representativeExample() {
  return {
    query: 'OpenAI',
    count: 1,
    results: [
      {
        businessName: 'Openai, L.l.c.',
        filingNumber: '0014371957',
        registrationType: 'Foreign Limited Liability Company',
        creationDate: '2025-04-23',
        address1: '600 North Second Street, Suite 401',
        address2: null,
        city: 'Harrisburg',
        state: 'PA',
        zip: '17101',
        county: 'Dauphin',
        countyCode: '22',
        principals: [
          {
            role: 'Governor',
            firstName: null,
            middleName: null,
            lastName: null,
          },
        ],
      },
    ],
    enrichment: { principals: 'complete' },
    source: SOURCE_LABEL,
    paid: true,
  }
}

function bazaarExtension() {
  const info = {
    input: {
      type: 'http',
      method: 'GET',
      queryParams: { q: 'OpenAI', limit: 1 },
    },
    output: {
      type: 'json',
      example: representativeExample(),
    },
  }

  const schema = {
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
              q: {
                type: 'string',
                minLength: 2,
                maxLength: MAX_QUERY_LENGTH,
              },
              limit: {
                type: 'integer',
                minimum: 1,
                maximum: 25,
              },
            },
            required: ['q'],
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
  }

  return { bazaar: { info, schema } }
}

export function paymentDocument() {
  return {
    x402Version: 2,
    resource: {
      url: PUBLIC_ENDPOINT,
      description:
        'Pennsylvania business registry and company identity lookup by business name. Returns filing number, registration type, creation date, registered address, county, and source-published principal/officer roles.',
      mimeType: 'application/json',
      serviceName: 'Pennsylvania Business Registry — Company Identity Lookup',
      tags: [
        'pennsylvania-business-registry',
        'company-identity',
        'legal-entity',
        'vendor-verification',
        'due-diligence',
        'lead-enrichment',
      ],
    },
    accepts: [requirements()],
    extensions: bazaarExtension(),
  }
}

function paymentRequired(
  reason = 'payment_required',
  detail?: string
) {
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

function temporaryFailure(
  reason: string,
  detail: string,
  retryAfter = 2
) {
  return flootJson(
    {
      error: reason,
      detail,
      paymentState: 'unresolved',
      retrySamePayment: true,
    },
    503,
    { 'Retry-After': String(retryAfter) }
  )
}

function normalizeSearchTerm(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > MAX_QUERY_LENGTH) throw new Error('query_too_long')

  const cleaned = trimmed
    .replace(/[%_]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const significant = [...cleaned].filter(ch => /[\p{L}\p{N}]/u.test(ch))
  if (significant.length < 2) throw new Error('query_too_short')

  return cleaned
}

export function parseLimit(raw: string | null): number {
  if (raw == null || raw === '') return 10
  if (!/^\d+$/.test(raw)) throw new Error('invalid_limit')
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 25) {
    throw new Error('invalid_limit')
  }
  return value
}

function canonicalBusinessName(value: string): string {
  let text = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const legalSuffix =
    /\s+(?:L\s+L\s+C|LLC|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|L\s+P|LP|L\s+L\s+P|LLP|P\s+C|PC)$/

  let previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(legalSuffix, '').trim()
  }

  return text
}

function matchScore(name: string, query: string): number {
  const candidate = canonicalBusinessName(name)
  const wanted = canonicalBusinessName(query)

  if (candidate === wanted) return 0
  if (candidate.startsWith(`${wanted} `)) return 1
  if (` ${candidate} `.includes(` ${wanted} `)) return 2
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) {
    return 3
  }

  return 4
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

function entityProjection() {
  return [
    'business_name',
    'filing_number',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'zip',
    'typeofbusinessregistration',
    'creationdate',
    'shortcountyname',
    'county_code',
  ].join(',')
}

function mapEntity(row: JsonRecord): EntityResult {
  const rawDate = row.creationdate == null ? null : String(row.creationdate)
  return {
    businessName: row.business_name == null ? null : String(row.business_name),
    filingNumber: row.filing_number == null ? null : String(row.filing_number),
    registrationType:
      row.typeofbusinessregistration == null
        ? null
        : String(row.typeofbusinessregistration),
    creationDate: rawDate ? rawDate.slice(0, 10) : null,
    address1: row.address_line1 == null ? null : String(row.address_line1),
    address2: row.address_line2 == null ? null : String(row.address_line2),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    zip: row.zip == null ? null : String(row.zip),
    county: row.shortcountyname == null ? null : String(row.shortcountyname),
    countyCode: row.county_code == null ? null : String(row.county_code),
    principals: [],
  }
}

async function fetchEntityCandidates(
  query: string,
  mode: 'starts' | 'contains',
  limit = 100
): Promise<EntityResult[]> {
  const escaped = query.toUpperCase().replaceAll("'", "''")
  const pattern = mode === 'starts' ? `${escaped}%` : `%${escaped}%`

  const url = new URL(SOURCE)
  url.searchParams.set('$select', `distinct ${entityProjection()}`)
  url.searchParams.set('$where', `upper(business_name) like '${pattern}'`)
  url.searchParams.set('$limit', String(limit))

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: { 'user-agent': 'PA-Entity-x402/2.0' },
    },
    SOURCE_TIMEOUT_MS
  )

  if (!response.ok) {
    throw new Error(`PA Open Data returned ${response.status}`)
  }

  const rows = (await response.json()) as JsonRecord[]
  return rows.map(mapEntity)
}

function dedupeAndRank(
  rows: EntityResult[],
  query: string,
  limit: number
): EntityResult[] {
  const unique = new Map<string, EntityResult>()
  for (const row of rows) {
    const key =
      row.filingNumber ??
      `${row.businessName ?? ''}|${row.address1 ?? ''}|${row.city ?? ''}`
    if (!unique.has(key)) unique.set(key, row)
  }

  return [...unique.values()]
    .sort((a, b) => {
      const aName = a.businessName ?? ''
      const bName = b.businessName ?? ''
      const score = matchScore(aName, query) - matchScore(bName, query)
      if (score !== 0) return score
      if (aName.length !== bName.length) return aName.length - bName.length
      return aName.localeCompare(bName)
    })
    .slice(0, limit)
}

async function searchPennsylvania(
  query: string,
  limit: number
): Promise<EntityResult[]> {
  const starts = await fetchEntityCandidates(query, 'starts')
  if (starts.length >= limit) return dedupeAndRank(starts, query, limit)

  const contains = await fetchEntityCandidates(query, 'contains')
  return dedupeAndRank([...starts, ...contains], query, limit)
}

function principalKey(p: Principal): string {
  return [p.role, p.firstName, p.middleName, p.lastName]
    .map(v => v ?? '')
    .join('|')
    .toUpperCase()
}

async function enrichPrincipals(
  results: EntityResult[]
): Promise<'complete' | 'unavailable'> {
  const filingNumbers = results
    .map(item => item.filingNumber)
    .filter((value): value is string => Boolean(value))

  if (filingNumbers.length === 0) return 'complete'

  const where = filingNumbers
    .map(value => `'${value.replaceAll("'", "''")}'`)
    .join(',')

  const url = new URL(SOURCE)
  url.searchParams.set(
    '$select',
    'filing_number,party_type,first_name,middle_name,last_name'
  )
  url.searchParams.set('$where', `filing_number in(${where})`)
  url.searchParams.set('$limit', '1000')

  try {
    const response = await fetchWithTimeout(
      url.toString(),
      {
        headers: { 'user-agent': 'PA-Entity-x402/2.0' },
      },
      SOURCE_TIMEOUT_MS
    )
    if (!response.ok) return 'unavailable'

    const rows = (await response.json()) as JsonRecord[]
    const byFiling = new Map<string, Principal[]>()

    for (const row of rows) {
      if (row.filing_number == null) continue
      const filing = String(row.filing_number)
      const principal: Principal = {
        role: row.party_type == null ? null : String(row.party_type),
        firstName: row.first_name == null ? null : String(row.first_name),
        middleName: row.middle_name == null ? null : String(row.middle_name),
        lastName: row.last_name == null ? null : String(row.last_name),
      }

      const list = byFiling.get(filing) ?? []
      const key = principalKey(principal)
      if (!list.some(item => principalKey(item) === key)) list.push(principal)
      byFiling.set(filing, list)
    }

    for (const result of results) {
      result.principals =
        result.filingNumber == null
          ? []
          : byFiling.get(result.filingNumber) ?? []
    }

    return 'complete'
  } catch {
    return 'unavailable'
  }
}

async function facilitatorPost(
  path: 'verify' | 'settle',
  paymentPayload: JsonRecord
): Promise<{ status: number; body: JsonRecord | null }> {
  const requestBody = {
    x402Version: 2,
    paymentPayload,
    paymentRequirements: requirements(),
  }

  const response = await fetchWithTimeout(
    `${FACILITATOR}/${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
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

async function settleSamePayment(
  paymentPayload: JsonRecord
): Promise<
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
        return {
          kind: 'unresolved',
          reason: 'settlement_transport_unknown',
          detail:
            'Settlement response could not be confirmed. Retry the same payment authorization.',
        }
      }
      continue
    }

    const body = response.body
    if (body?.success === true) {
      return { kind: 'settled', receipt: body }
    }

    const reason =
      typeof body?.errorReason === 'string'
        ? body.errorReason
        : response.status === 429
          ? 'rate_limited'
          : response.status >= 500
            ? 'facilitator_unavailable'
            : 'payment_settlement_failed'

    const detail =
      typeof body?.errorMessage === 'string' ? body.errorMessage : undefined

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

  return {
    kind: 'unresolved',
    reason: 'settlement_unknown',
    detail: 'Settlement outcome is unresolved.',
  }
}

function header(request: Request, name: string): string | null {
  return request.headers.get(name)
}

export async function handle({ request }: { request: Request }) {
  const signature =
    header(request, 'payment-signature') ?? header(request, 'x-payment')

  if (!signature) return paymentRequired()

  let paymentPayload: JsonRecord
  try {
    paymentPayload = decodePayment(signature)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const reason =
      message === 'payment_header_too_large'
        ? 'payment_header_too_large'
        : message === 'invalid_payment_payload'
          ? 'invalid_payment_payload'
          : 'invalid_payment_header'
    return paymentRequired(reason)
  }

  const url = new URL(request.url)
  let query: string
  let limit: number

  try {
    query = normalizeSearchTerm(url.searchParams.get('q') ?? '')
    limit = parseLimit(url.searchParams.get('limit'))
  } catch (error) {
    return flootJson(
      {
        error: error instanceof Error ? error.message : 'invalid_query',
      },
      400
    )
  }

  let verification
  try {
    verification = await facilitatorPost('verify', paymentPayload)
  } catch {
    return flootJson(
      {
        error: 'payment_verifier_unavailable',
        detail:
          'The payment verifier could not be reached. Retry the same payment authorization.',
        retrySamePayment: true,
      },
      503,
      { 'Retry-After': '2' }
    )
  }

  if (verification.body?.isValid !== true) {
    if (verification.body?.isValid === false) {
      const reason =
        typeof verification.body.invalidReason === 'string'
          ? verification.body.invalidReason
          : 'payment_verification_failed'
      const detail =
        typeof verification.body.invalidMessage === 'string'
          ? verification.body.invalidMessage
          : undefined
      return paymentRequired(reason, detail)
    }

    return flootJson(
      {
        error: 'payment_verifier_unavailable',
        detail:
          'The payment verifier returned an unrecognized response. Retry the same payment authorization.',
        retrySamePayment: true,
      },
      503,
      { 'Retry-After': '2' }
    )
  }

  let results: EntityResult[]
  try {
    results = await searchPennsylvania(query, limit)
  } catch {
    return flootJson(
      {
        error: 'pa_registry_unavailable',
        detail:
          'Pennsylvania public-data source is temporarily unavailable; payment was not settled.',
      },
      502
    )
  }

  const principalStatus = await enrichPrincipals(results)
  const settlement = await settleSamePayment(paymentPayload)

  if (settlement.kind === 'unresolved') {
    return temporaryFailure(
      settlement.reason,
      settlement.detail ??
        'Settlement is unresolved. Retry this request with the same payment authorization.'
    )
  }

  if (settlement.kind === 'terminal_failure') {
    return paymentRequired(
      settlement.reason,
      settlement.detail ?? 'Payment could not be settled.'
    )
  }

  return flootJson(
    {
      query,
      count: results.length,
      results,
      enrichment: { principals: principalStatus },
      source: SOURCE_LABEL,
      paid: true,
    },
    200,
    {
      'PAYMENT-RESPONSE': encodeHeader(settlement.receipt),
      'x402-settled': 'true',
      'cache-control': 'no-store',
    }
  )
}
