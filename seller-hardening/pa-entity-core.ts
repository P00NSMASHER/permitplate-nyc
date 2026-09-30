export const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
export const NETWORK = 'eip155:8453'
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export const AMOUNT = '5000'
export const PRICE_USD = '0.005000'
export const FACILITATOR = 'https://facilitator.payai.network'
export const RESOURCE_URL = 'https://pa-entity-x402.floot.app/_api/pa-business'
export const PA_CURRENT = 'https://data.pa.gov/resource/xvd7-5r2c.json'

export const MAX_QUERY_LENGTH = 120
export const MAX_RESULTS = 25
export const DEFAULT_RESULTS = 10
export const UPSTREAM_TIMEOUT_MS = 8_000
export const FACILITATOR_TIMEOUT_MS = 8_000
export const MAX_PAYMENT_HEADER_CHARS = 32_768

export type Principal = {
  role: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
}

export type EntityResult = {
  businessName: string | null
  filingNumber: string | null
  registrationType: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  countyCode: string | null
  creationDate: string | null
  principals: Principal[]
}

export type VerifyDecision =
  | { kind: 'valid'; body: Record<string, unknown> }
  | { kind: 'invalid'; reason: string; body: Record<string, unknown> }
  | { kind: 'unavailable'; reason: string; body?: Record<string, unknown> }

export type SettleDecision =
  | { kind: 'settled'; body: Record<string, unknown> }
  | { kind: 'retry_same_payment'; reason: string; body: Record<string, unknown> }
  | { kind: 'payment_failed'; reason: string; body: Record<string, unknown> }
  | { kind: 'unavailable'; reason: string; body?: Record<string, unknown> }

export function requirements(amount = AMOUNT) {
  return {
    scheme: 'exact',
    network: NETWORK,
    amount,
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
      url: RESOURCE_URL,
      description:
        'Pennsylvania business registry and company identity lookup by business name. Returns Department of State filing number, registration type, registered address, city, ZIP, county, creation date, and source-published principal/officer records for entity resolution, vendor verification, due diligence, and lead enrichment.',
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
    extensions: {
      bazaar: {
        info: {
          input: {
            type: 'http',
            method: 'GET',
            queryParams: { q: 'OpenAI', limit: 1 },
          },
          output: {
            type: 'json',
            example: {
              query: 'OpenAI',
              count: 1,
              results: [
                {
                  businessName: 'Openai, L.l.c.',
                  filingNumber: '0014371957',
                  registrationType: 'Foreign Limited Liability Company',
                  address1: '600 North Second Street, Suite 401',
                  address2: null,
                  city: 'Harrisburg',
                  state: 'PA',
                  zip: '17101',
                  county: 'Dauphin',
                  countyCode: '22',
                  creationDate: '2025-04-23',
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
              source: 'Pennsylvania Department of State via data.pa.gov',
              paid: true,
            },
          },
        },
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
                    q: { type: 'string', minLength: 2, maxLength: MAX_QUERY_LENGTH },
                    limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS },
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
        },
      },
    },
  }
}

export function normalizeQuery(raw: string): string {
  const q = raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (q.length < 2) throw new Error('query_too_short')
  if (q.length > MAX_QUERY_LENGTH) throw new Error('query_too_long')
  return q
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_RESULTS
  if (!/^\d+$/.test(raw)) throw new Error('invalid_limit')
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_RESULTS) {
    throw new Error('invalid_limit')
  }
  return n
}

export function escapeSocrataLiteral(value: string): string {
  return value.replaceAll("'", "''")
}

export function buildEntitySearchUrl(query: string, mode: 'starts' | 'contains', limit: number): string {
  const q = normalizeQuery(query).toUpperCase()
  const escaped = escapeSocrataLiteral(q)
  const url = new URL(PA_CURRENT)
  url.searchParams.set(
    '$select',
    'distinct business_name,filing_number,address_line1,address_line2,city,state,zip,typeofbusinessregistration,creationdate,shortcountyname,county_code'
  )
  url.searchParams.set(
    '$where',
    mode === 'starts'
      ? `upper(business_name) like '${escaped}%'`
      : `upper(business_name) like '%${escaped}%'`
  )
  url.searchParams.set('$order', 'business_name ASC')
  url.searchParams.set('$limit', String(Math.min(100, Math.max(25, limit * 8))))
  return url.toString()
}

export function buildPrincipalSearchUrl(filingNumbers: string[]): string | null {
  const unique = [...new Set(filingNumbers.filter(x => /^\d{10}$/.test(x)))].slice(0, MAX_RESULTS)
  if (unique.length === 0) return null
  const quoted = unique.map(x => `'${x}'`).join(',')
  const url = new URL(PA_CURRENT)
  url.searchParams.set(
    '$select',
    'filing_number,party_type,first_name,middle_name,last_name'
  )
  url.searchParams.set('$where', `filing_number in(${quoted})`)
  url.searchParams.set('$order', 'filing_number ASC')
  url.searchParams.set('$limit', String(Math.min(2500, unique.length * 100)))
  return url.toString()
}

export function isoDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null
  const candidate = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null
}

export function canonicalBusinessName(value: string): string {
  let text = value
    .normalize('NFKC')
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

export function matchScore(name: string, query: string): number {
  const candidate = canonicalBusinessName(name)
  const wanted = canonicalBusinessName(query)
  if (candidate === wanted) return 0
  if (candidate.startsWith(`${wanted} `)) return 1
  if (` ${candidate} `.includes(` ${wanted} `)) return 2
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) return 3
  return 4
}

export function classifyVerifyResponse(
  httpStatus: number,
  body: unknown,
): VerifyDecision {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.isValid === true) return { kind: 'valid', body: b }
    if (b.isValid === false || typeof b.invalidReason === 'string') {
      return {
        kind: 'invalid',
        reason: String(b.invalidReason ?? 'payment_verification_failed'),
        body: b,
      }
    }
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    return { kind: 'invalid', reason: 'invalid_payment_payload', body: {} }
  }
  return { kind: 'unavailable', reason: 'payment_verifier_unavailable' }
}

export function classifySettleResponse(
  httpStatus: number,
  body: unknown,
): SettleDecision {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (b.success === true) return { kind: 'settled', body: b }

    const reason =
      typeof b.errorReason === 'string' ? b.errorReason : 'payment_settlement_failed'

    if (reason === 'settlement_pending' || reason === 'duplicate_settlement') {
      return { kind: 'retry_same_payment', reason, body: b }
    }

    if (b.success === false || typeof b.errorReason === 'string') {
      if (httpStatus === 429 || httpStatus >= 500) {
        return { kind: 'unavailable', reason, body: b }
      }
      return { kind: 'payment_failed', reason, body: b }
    }
  }

  if (httpStatus === 429 || httpStatus >= 500) {
    return { kind: 'unavailable', reason: 'payment_settlement_unavailable' }
  }
  return { kind: 'payment_failed', reason: 'payment_settlement_failed', body: {} }
}

export function dedupePrincipals(rows: Array<Record<string, unknown>>): Map<string, Principal[]> {
  const byFiling = new Map<string, Principal[]>()
  const seen = new Map<string, Set<string>>()

  for (const row of rows) {
    const filing = typeof row.filing_number === 'string' ? row.filing_number : ''
    if (!/^\d{10}$/.test(filing)) continue

    const principal: Principal = {
      role: typeof row.party_type === 'string' ? row.party_type : null,
      firstName: typeof row.first_name === 'string' ? row.first_name : null,
      middleName: typeof row.middle_name === 'string' ? row.middle_name : null,
      lastName: typeof row.last_name === 'string' ? row.last_name : null,
    }
    if (!principal.role && !principal.firstName && !principal.middleName && !principal.lastName) {
      continue
    }

    const key = JSON.stringify(principal)
    if (!seen.has(filing)) seen.set(filing, new Set())
    if (seen.get(filing)!.has(key)) continue
    seen.get(filing)!.add(key)

    if (!byFiling.has(filing)) byFiling.set(filing, [])
    byFiling.get(filing)!.push(principal)
  }
  return byFiling
}

export function decodePaymentHeader(value: string): unknown {
  if (value.length > MAX_PAYMENT_HEADER_CHARS) throw new Error('payment_header_too_large')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const decoded = Buffer.from(padded, 'base64').toString('utf8')
  return JSON.parse(decoded)
}
