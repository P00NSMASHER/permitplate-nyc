const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '5000'
const PRICE = '$0.005'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/ofac-sdn-screen'
const OFAC_BASE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports'

const MAX_PAYMENT_HEADER_LENGTH = 16_384
const SOURCE_TIMEOUT_MS = 30_000
const FACILITATOR_TIMEOUT_MS = 6_000
const CACHE_MS = 10 * 60 * 1000

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers':
    'PAYMENT-SIGNATURE, X-PAYMENT, Content-Type, Accept',
  'access-control-expose-headers':
    'PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, Retry-After',
}

type JsonRecord = Record<string, unknown>
type SdnEntry = {
  uid: string
  name: string
  type: string | null
  program: string | null
  title: string | null
  remarks: string | null
  aliases: Array<{ type: string | null; name: string; remarks: string | null }>
}

let cache: { loadedAt: number; entries: SdnEntry[] } | null = null

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
        'Current OFAC SDN candidate-name screening against primary names and aliases. Returns review candidates only; no-match is not sanctions clearance.',
      mimeType: 'application/json',
      serviceName: 'OFAC SDN Name Screen x402',
      tags: ['ofac', 'sanctions', 'sdn', 'name-screening'],
    },
    accepts: [requirements()],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: 'http',
            method: 'GET',
            queryParams: {
              name: 'VLADIMIR PUTIN',
              limit: 3,
              minScore: 90,
            },
          },
          output: {
            type: 'json',
            example: {
              query: 'VLADIMIR PUTIN',
              minScore: 90,
              count: 1,
              totalCandidatesAboveThreshold: 1,
              candidates: [
                {
                  primaryName: 'PUTIN, Vladimir Vladimirovich',
                  score: 99,
                },
              ],
              source:
                'U.S. Treasury OFAC Specially Designated Nationals (SDN) List',
              reviewRequired: true,
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some(value => value.length)) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''))
    if (row.some(value => value.length)) rows.push(row)
  }
  return rows
}

function clean(value: string | undefined): string | null {
  if (!value || value === '-0-') return null
  return value.trim() || null
}

async function fetchOfacFile(name: string): Promise<string> {
  const response = await fetchWithTimeout(
    OFAC_BASE + '/' + name,
    {
      headers: {
        'User-Agent':
          'x402-ofac-screen/1.0 (https://pa-entity-x402.floot.app)',
        Accept: 'text/csv,*/*',
      },
      redirect: 'follow',
    },
    SOURCE_TIMEOUT_MS
  )
  if (!response.ok) {
    throw new Error('ofac_http_' + response.status + '_' + name)
  }
  return await response.text()
}

async function loadEntries(): Promise<SdnEntry[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.entries

  const [sdnText, altText] = await Promise.all([
    fetchOfacFile('SDN.CSV'),
    fetchOfacFile('ALT.CSV'),
  ])
  const primaryRows = parseCsv(sdnText)
  const aliasRows = parseCsv(altText)
  const map = new Map<string, SdnEntry>()

  for (const cols of primaryRows) {
    const uid = (cols[0] ?? '').trim()
    const name = (cols[1] ?? '').trim()
    if (!uid || !name) continue
    map.set(uid, {
      uid,
      name,
      type: clean(cols[2]),
      program: clean(cols[3]),
      title: clean(cols[4]),
      remarks: clean(cols[11]),
      aliases: [],
    })
  }

  for (const cols of aliasRows) {
    const uid = (cols[0] ?? '').trim()
    const altName = (cols[3] ?? '').trim()
    const entry = map.get(uid)
    if (!entry || !altName) continue
    entry.aliases.push({
      type: clean(cols[2]),
      name: altName,
      remarks: clean(cols[4]),
    })
  }

  const entries = Array.from(map.values())
  cache = { loadedAt: Date.now(), entries }
  return entries
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sortedTokens(value: string): string {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j < next.length; j += 1) prev[j] = next[j]
  }
  return prev[b.length]
}

function jaccardTokens(a: string, b: string): number {
  const aa = new Set(normalizeName(a).split(' ').filter(Boolean))
  const bb = new Set(normalizeName(b).split(' ').filter(Boolean))
  if (!aa.size || !bb.size) return 0
  let shared = 0
  for (const token of aa) if (bb.has(token)) shared += 1
  const union = new Set([...aa, ...bb]).size
  return shared / union
}

function scoreName(query: string, candidate: string): number {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (!q || !c) return 0
  if (q === c) return 100
  if (sortedTokens(q) === sortedTokens(c)) return 99
  const contains =
    q.length >= 5 && c.length >= 5 && (q.includes(c) || c.includes(q)) ? 94 : 0
  const maxLen = Math.max(q.length, c.length)
  const edit = maxLen ? (1 - levenshtein(q, c) / maxLen) * 100 : 0
  const sortedQ = sortedTokens(q)
  const sortedC = sortedTokens(c)
  const editSorted = maxLen
    ? (1 -
        levenshtein(sortedQ, sortedC) /
          Math.max(sortedQ.length, sortedC.length, 1)) *
      100
    : 0
  const tokens = jaccardTokens(q, c) * 100
  return Math.max(contains, edit, editSorted, tokens)
}

export async function screenName(
  name: string,
  limit: number,
  minScore: number
) {
  const entries = await loadEntries()
  const candidates: Array<Record<string, unknown>> = []

  for (const entry of entries) {
    let bestScore = scoreName(name, entry.name)
    let matchedOn = 'primary'
    let matchedName = entry.name
    for (const alias of entry.aliases) {
      const aliasScore = scoreName(name, alias.name)
      if (aliasScore > bestScore) {
        bestScore = aliasScore
        matchedOn = 'alias'
        matchedName = alias.name
      }
    }
    if (bestScore >= minScore) {
      candidates.push({
        uid: entry.uid,
        primaryName: entry.name,
        type: entry.type,
        program: entry.program,
        title: entry.title,
        remarks: entry.remarks,
        matchedOn,
        matchedName,
        score: Math.round(bestScore),
      })
    }
  }

  candidates.sort(
    (a, b) =>
      Number(b.score) - Number(a.score) ||
      String(a.primaryName).localeCompare(String(b.primaryName))
  )

  return {
    query: name,
    minScore,
    count: Math.min(candidates.length, limit),
    totalCandidatesAboveThreshold: candidates.length,
    candidates: candidates.slice(0, limit),
    source: 'U.S. Treasury OFAC Specially Designated Nationals (SDN) List',
    sourceFiles: ['SDN.CSV', 'ALT.CSV'],
    reviewRequired: true,
    limitations: [
      'Candidate-name screening only; a match is not a legal determination.',
      'A no-match is not a sanctions clearance.',
      'This service does not implement OFAC 50 Percent Rule ownership analysis.',
      'Review identifiers, addresses, dates of birth, program tags, and other OFAC data before acting.',
    ],
  }
}

function parseInput(url: URL) {
  const name = (url.searchParams.get('name') ?? '').trim()
  if (name.length < 2 || name.length > 160) throw new Error('invalid_name')

  const rawLimit = url.searchParams.get('limit')
  let limit = 5
  if (rawLimit !== null && rawLimit !== '') {
    if (!/^\d+$/.test(rawLimit)) throw new Error('invalid_limit')
    limit = Number(rawLimit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
      throw new Error('invalid_limit')
    }
  }

  const rawScore = url.searchParams.get('minScore')
  let minScore = 85
  if (rawScore !== null && rawScore !== '') {
    if (!/^\d+$/.test(rawScore)) throw new Error('invalid_min_score')
    minScore = Number(rawScore)
    if (!Number.isSafeInteger(minScore) || minScore < 70 || minScore > 100) {
      throw new Error('invalid_min_score')
    }
  }

  return { name, limit, minScore }
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
    result = await screenName(input.name, input.limit, input.minScore)
  } catch {
    return flootJson(
      {
        error: 'ofac_source_unavailable',
        detail:
          'OFAC Sanctions List Service is temporarily unavailable; payment was not settled.',
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
