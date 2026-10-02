const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/domain-rdap'
const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json'

const MAX_PAYMENT_HEADER_LENGTH = 16_384
const SOURCE_TIMEOUT_MS = 12_000
const FACILITATOR_TIMEOUT_MS = 6_000
const RDAP_CACHE_MS = 60 * 60 * 1000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers':
    'PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept',
  'access-control-expose-headers':
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, Retry-After',
}

type JsonRecord = Record<string, unknown>
type Bootstrap = { services?: Array<[string[], string[]]> }

let rdapCache: { loadedAt: number; data: Bootstrap } | null = null

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
        'Live authoritative domain-registration metadata through IANA RDAP bootstrap and the correct registry RDAP service.',
      mimeType: 'application/json',
      serviceName: 'Domain RDAP Lookup x402',
      tags: ['domain', 'rdap', 'registration', 'registrar', 'dns'],
    },
    accepts: [requirements()],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: 'http',
            method: 'GET',
            queryParams: { domain: 'example.com' },
          },
          output: {
            type: 'json',
            example: {
              domain: 'example.com',
              registered: true,
              authoritativeRdap: 'https://rdap.verisign.com/com/v1/',
              source:
                'Authoritative RDAP server discovered via IANA bootstrap',
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

function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase()
  if (value.endsWith('.')) value = value.slice(0, -1)
  if (
    value.length < 3 ||
    value.length > 253 ||
    !/^[a-z0-9.-]+$/.test(value) ||
    !value.includes('.')
  ) {
    throw new Error('invalid_domain')
  }
  const labels = value.split('.')
  if (
    labels.some(
      label =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-')
    )
  ) {
    throw new Error('invalid_domain')
  }
  return value
}

async function rdapBootstrap(): Promise<Bootstrap> {
  if (rdapCache && Date.now() - rdapCache.loadedAt < RDAP_CACHE_MS) {
    return rdapCache.data
  }
  const response = await fetchWithTimeout(IANA_RDAP_BOOTSTRAP, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'x402-domain-rdap/1.0 (https://pa-entity-x402.floot.app)',
    },
  })
  if (!response.ok) throw new Error('iana_rdap_http_' + response.status)
  const data = (await response.json()) as Bootstrap
  rdapCache = { loadedAt: Date.now(), data }
  return data
}

function findRdapBase(data: Bootstrap, tld: string): string | null {
  for (const service of data.services ?? []) {
    const tlds = service[0] ?? []
    const urls = service[1] ?? []
    if (
      tlds.some(value => value.toLowerCase() === tld.toLowerCase()) &&
      urls.length
    ) {
      return urls[0]
    }
  }
  return null
}

function vcardName(entity: Record<string, any>): string | null {
  const card = entity.vcardArray
  if (!Array.isArray(card) || !Array.isArray(card[1])) return null
  for (const item of card[1]) {
    if (Array.isArray(item) && item[0] === 'fn') {
      return String(item[3] ?? '') || null
    }
  }
  return null
}

function eventMap(events: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(events)) return out
  for (const item of events) {
    const event =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as JsonRecord)
        : null
    if (!event) continue
    const action = String(event.eventAction ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)/g, (_m, char: string) => char.toUpperCase())
    const date = String(event.eventDate ?? '')
    if (action && date && !out[action]) out[action] = date
  }
  return out
}

export async function lookupDomain(rawDomain: string) {
  const domain = normalizeDomain(rawDomain)
  const tld = domain.split('.').pop() ?? ''
  const bootstrap = await rdapBootstrap()
  const base = findRdapBase(bootstrap, tld)

  if (!base) {
    return {
      domain,
      registered: null,
      error: 'no_rdap_bootstrap_service',
      source: 'IANA RDAP Bootstrap Service Registry',
    }
  }

  const url =
    base.replace(/\/+$/, '') + '/domain/' + encodeURIComponent(domain)
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': 'x402-domain-rdap/1.0 (https://pa-entity-x402.floot.app)',
      },
      redirect: 'follow',
    },
    SOURCE_TIMEOUT_MS
  )

  if (response.status === 404) {
    return {
      domain,
      registered: false,
      authoritativeRdap: base,
      source: 'Authoritative RDAP server discovered via IANA bootstrap',
    }
  }
  if (!response.ok) throw new Error('rdap_http_' + response.status)

  const data = (await response.json()) as Record<string, any>
  const registrarEntity = Array.isArray(data.entities)
    ? data.entities.find(
        (entity: Record<string, any>) =>
          Array.isArray(entity.roles) &&
          entity.roles
            .map((role: unknown) => String(role).toLowerCase())
            .includes('registrar')
      )
    : undefined

  const nameservers = Array.isArray(data.nameservers)
    ? data.nameservers
        .map((ns: Record<string, unknown>) =>
          String(ns.ldhName ?? ns.unicodeName ?? '')
        )
        .filter(Boolean)
    : []

  return {
    domain,
    registered: true,
    handle: data.handle ?? null,
    unicodeName: data.unicodeName ?? null,
    status: Array.isArray(data.status) ? data.status : [],
    registrar: registrarEntity
      ? {
          name: vcardName(registrarEntity),
          handle: registrarEntity.handle ?? null,
        }
      : null,
    events: eventMap(data.events),
    nameservers,
    secureDns: data.secureDNS
      ? { delegationSigned: data.secureDNS.delegationSigned ?? null }
      : null,
    authoritativeRdap: base,
    source: 'Authoritative RDAP server discovered via IANA bootstrap',
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

  let domain: string
  try {
    domain = normalizeDomain(new URL(request.url).searchParams.get('domain') ?? '')
  } catch {
    return flootJson({ error: 'invalid_domain' }, 400)
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
    result = await lookupDomain(domain)
  } catch {
    return flootJson(
      {
        error: 'rdap_source_unavailable',
        detail:
          'IANA or the authoritative RDAP source is temporarily unavailable; payment was not settled.',
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
