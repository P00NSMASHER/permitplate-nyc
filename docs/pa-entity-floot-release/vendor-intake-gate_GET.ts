const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
const NETWORK = 'eip155:8453'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const AMOUNT = '20000'
const PRICE = '$0.020'
const FACILITATOR = 'https://facilitator.payai.network'
const PUBLIC_ENDPOINT = 'https://pa-entity-x402.floot.app/_api/vendor-intake-gate'
const PA_SOURCE = 'https://data.pa.gov/resource/xvd7-5r2c.json'
const PA_SOURCE_LABEL = 'Pennsylvania Department of State via data.pa.gov'
const CENSUS_SOURCE_LABEL = 'U.S. Census Bureau Geocoding Services'
const CENSUS_URL =
  'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
const OFAC_BASE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports'
const OFAC_SOURCE_LABEL =
  'U.S. Treasury OFAC Specially Designated Nationals (SDN) List'
const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json'
const RDAP_SOURCE_LABEL =
  'Authoritative RDAP server discovered via IANA bootstrap'

const MAX_QUERY_LENGTH = 120
const MAX_PAYMENT_HEADER_LENGTH = 16_384
const SOURCE_TIMEOUT_MS = 12_000
const FACILITATOR_TIMEOUT_MS = 6_000
const OFAC_REVIEW_THRESHOLD = 90
const ADDRESS_MAX_MILES = 0.25
const OFAC_CACHE_MS = 10 * 60 * 1000
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
}

type VendorGateInput = {
  name: string
  address: string
  domain: string
}

type SdnEntry = {
  uid: string
  name: string
  type: string | null
  program: string | null
  title: string | null
  remarks: string | null
  aliases: Array<{ type: string | null; name: string; remarks: string | null }>
}

type Bootstrap = { services?: Array<[string[], string[]]> }

let ofacCache: { loadedAt: number; entries: SdnEntry[] } | null = null
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

  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  })
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

function bazaarExtension() {
  return {
    bazaar: {
      info: {
        input: {
          type: 'http',
          method: 'GET',
          queryParams: {
            name: 'OpenAI OpCo',
            address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
            domain: 'openai.com',
          },
        },
        output: {
          type: 'json',
          example: {
            decision: 'proceed',
            agentAction: 'continue_vendor_intake',
            reviewTriggers: [],
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
                  name: { type: 'string', minLength: 2, maxLength: MAX_QUERY_LENGTH },
                  address: { type: 'string', minLength: 6, maxLength: 240 },
                  domain: { type: 'string', minLength: 3, maxLength: 253 },
                },
                required: ['name', 'address', 'domain'],
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
  }
}

export function paymentDocument() {
  return {
    x402Version: 2,
    resource: {
      url: PUBLIC_ENDPOINT,
      description:
        'Fail-closed Pennsylvania vendor-intake decision for autonomous agents using Pennsylvania registry identity, Census address consistency, OFAC SDN candidate-name screening, and authoritative RDAP domain evidence. Returns proceed or human_review with explicit evidence and limitations.',
      mimeType: 'application/json',
      serviceName: 'Pennsylvania Vendor Intake Decision Gate',
      tags: [
        'vendor-intake',
        'agent-decision',
        'human-review',
        'pennsylvania-business-registry',
        'census-address',
        'ofac-screening',
        'rdap',
      ],
    },
    accepts: [requirements()],
    extensions: bazaarExtension(),
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

function temporaryFailure(reason: string, detail: string, retryAfter = 2) {
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

function normalizeSearchTerm(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > MAX_QUERY_LENGTH) throw new Error('invalid_name')
  const cleaned = trimmed
    .replace(/[%_]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const significant = [...cleaned].filter(ch => /[\p{L}\p{N}]/u.test(ch))
  if (significant.length < 2) throw new Error('invalid_name')
  return cleaned
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

function validateVendorGateInput(url: URL): VendorGateInput {
  const name = normalizeSearchTerm(url.searchParams.get('name') ?? '')
  const address = (url.searchParams.get('address') ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (address.length < 6 || address.length > 240) {
    throw new Error('invalid_address')
  }
  const domain = normalizeDomain(url.searchParams.get('domain') ?? '')
  return { name, address, domain }
}

function canonicalBusinessName(value: string): string {
  let text = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const suffix =
    /\s+(?:L\s+L\s+C|LLC|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|L\s+P|LP|L\s+L\s+P|LLP|P\s+C|PC)$/
  let previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(suffix, '').trim()
  }
  return text
}

function matchScore(name: string, query: string): number {
  const candidate = canonicalBusinessName(name)
  const wanted = canonicalBusinessName(query)
  if (candidate === wanted) return 0
  if (candidate.startsWith(wanted + ' ')) return 1
  if ((' ' + candidate + ' ').includes(' ' + wanted + ' ')) return 2
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) return 3
  return 4
}

function normalizeCreationDate(value: unknown): string | null {
  if (value == null) return null
  const raw = String(value)
  if (raw.startsWith('1753-01-01')) return null
  return raw.slice(0, 10)
}

function mapEntity(row: JsonRecord): EntityResult {
  return {
    businessName: row.business_name == null ? null : String(row.business_name),
    filingNumber: row.filing_number == null ? null : String(row.filing_number),
    registrationType:
      row.typeofbusinessregistration == null
        ? null
        : String(row.typeofbusinessregistration),
    creationDate: normalizeCreationDate(row.creationdate),
    address1: row.address_line1 == null ? null : String(row.address_line1),
    address2: row.address_line2 == null ? null : String(row.address_line2),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    zip: row.zip == null ? null : String(row.zip),
    county: row.shortcountyname == null ? null : String(row.shortcountyname),
    countyCode: row.county_code == null ? null : String(row.county_code),
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

async function fetchEntityCandidates(
  query: string,
  mode: 'starts' | 'contains',
  limit = 100
): Promise<EntityResult[]> {
  const escaped = query.toUpperCase().replaceAll("'", "''")
  const pattern = mode === 'starts' ? escaped + '%' : '%' + escaped + '%'
  const url = new URL(PA_SOURCE)
  url.searchParams.set('$select', 'distinct ' + entityProjection())
  url.searchParams.set('$where', "upper(business_name) like '" + pattern + "'")
  url.searchParams.set('$limit', String(limit))
  const response = await fetchWithTimeout(
    url.toString(),
    { headers: { 'user-agent': 'PA-Vendor-Gate-x402/1.0' } },
    SOURCE_TIMEOUT_MS
  )
  if (!response.ok) throw new Error('pa_registry_http_' + response.status)
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
      (row.businessName ?? '') + '|' + (row.address1 ?? '') + '|' + (row.city ?? '')
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

async function searchPennsylvania(query: string, limit = 3) {
  const starts = await fetchEntityCandidates(query, 'starts')
  if (starts.length >= limit) return dedupeAndRank(starts, query, limit)
  const contains = await fetchEntityCandidates(query, 'contains')
  return dedupeAndRank([...starts, ...contains], query, limit)
}

function registryAddress(entity: EntityResult): string | null {
  const parts = [
    entity.address1,
    entity.address2,
    entity.city,
    entity.state,
    entity.zip,
  ].filter((value): value is string => Boolean(value && value.trim()))
  return parts.length ? parts.join(', ') : null
}

async function geocode(address: string) {
  const url = new URL(CENSUS_URL)
  url.searchParams.set('address', address)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('vintage', 'Current_Current')
  url.searchParams.set('format', 'json')
  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { accept: 'application/json' } },
    SOURCE_TIMEOUT_MS
  )
  if (!res.ok) throw new Error('census_http_' + res.status)
  const data = (await res.json()) as Record<string, any>
  const match = data.result?.addressMatches?.[0] as
    | Record<string, any>
    | undefined
  if (!match) {
    return {
      input: address,
      matched: false,
      matchedAddress: null,
      coordinates: null,
      source: CENSUS_SOURCE_LABEL,
    }
  }
  return {
    input: address,
    matched: true,
    matchedAddress: match.matchedAddress ?? null,
    coordinates: {
      longitude: match.coordinates?.x ?? null,
      latitude: match.coordinates?.y ?? null,
    },
    source: CENSUS_SOURCE_LABEL,
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function censusCoordinates(payload: JsonRecord | null) {
  const coordinates =
    payload?.coordinates &&
    typeof payload.coordinates === 'object' &&
    !Array.isArray(payload.coordinates)
      ? (payload.coordinates as JsonRecord)
      : null
  if (!coordinates) return null
  const latitude = numeric(coordinates.latitude)
  const longitude = numeric(coordinates.longitude)
  return latitude == null || longitude == null
    ? null
    : { latitude, longitude }
}

function censusAddressIdentity(value: unknown) {
  if (typeof value !== 'string') return { streetNumber: null, zip: null }
  const text = value.toUpperCase().trim()
  const streetNumber = text.match(/^\s*(\d+[A-Z-]?)/)?.[1] ?? null
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null
  return { streetNumber, zip }
}

function distanceMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMiles = 3958.7613
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const lat1 = radians(a.latitude)
  const lat2 = radians(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)))
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some(value => value.length)) rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
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

async function fetchOfacFile(name: string) {
  const res = await fetchWithTimeout(
    OFAC_BASE + '/' + name,
    {
      headers: {
        'User-Agent': 'x402-vendor-gate/1.0 (https://pa-entity-x402.floot.app)',
        Accept: 'text/csv,*/*',
      },
      redirect: 'follow',
    },
    SOURCE_TIMEOUT_MS
  )
  if (!res.ok) throw new Error('ofac_http_' + res.status)
  return await res.text()
}

async function loadOfacEntries(): Promise<SdnEntry[]> {
  if (
    ofacCache &&
    Date.now() - ofacCache.loadedAt < OFAC_CACHE_MS
  ) {
    return ofacCache.entries
  }
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
  ofacCache = { loadedAt: Date.now(), entries }
  return entries
}

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sortedTokens(value: string) {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ')
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
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

function jaccardTokens(a: string, b: string) {
  const aa = new Set(normalizeName(a).split(' ').filter(Boolean))
  const bb = new Set(normalizeName(b).split(' ').filter(Boolean))
  if (!aa.size || !bb.size) return 0
  let shared = 0
  for (const token of aa) if (bb.has(token)) shared += 1
  return shared / new Set([...aa, ...bb]).size
}

function scoreName(query: string, candidate: string) {
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
  const editSorted =
    1 -
    levenshtein(sortedQ, sortedC) /
      Math.max(sortedQ.length, sortedC.length, 1)
  const tokens = jaccardTokens(q, c) * 100
  return Math.max(contains, edit, editSorted * 100, tokens)
}

async function screenOfacName(name: string) {
  const entries = await loadOfacEntries()
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
    if (bestScore >= OFAC_REVIEW_THRESHOLD) {
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
    minScore: OFAC_REVIEW_THRESHOLD,
    count: Math.min(candidates.length, 3),
    totalCandidatesAboveThreshold: candidates.length,
    candidates: candidates.slice(0, 3),
    source: OFAC_SOURCE_LABEL,
    sourceFiles: ['SDN.CSV', 'ALT.CSV'],
    reviewRequired: true,
  }
}

async function rdapBootstrap(): Promise<Bootstrap> {
  if (rdapCache && Date.now() - rdapCache.loadedAt < RDAP_CACHE_MS) {
    return rdapCache.data
  }
  const res = await fetchWithTimeout(
    IANA_RDAP_BOOTSTRAP,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'x402-vendor-gate/1.0 (https://pa-entity-x402.floot.app)',
      },
    },
    SOURCE_TIMEOUT_MS
  )
  if (!res.ok) throw new Error('iana_rdap_http_' + res.status)
  const data = (await res.json()) as Bootstrap
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

function rdapEventMap(events: unknown): Record<string, string> {
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

async function lookupDomain(domain: string) {
  const tld = domain.split('.').pop() ?? ''
  const registry = await rdapBootstrap()
  const base = findRdapBase(registry, tld)
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
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/rdap+json, application/json',
        'User-Agent': 'x402-vendor-gate/1.0 (https://pa-entity-x402.floot.app)',
      },
      redirect: 'follow',
    },
    SOURCE_TIMEOUT_MS
  )

  if (res.status === 404) {
    return {
      domain,
      registered: false,
      authoritativeRdap: base,
      source: RDAP_SOURCE_LABEL,
    }
  }
  if (!res.ok) throw new Error('rdap_http_' + res.status)

  const data = (await res.json()) as Record<string, any>
  const registrarEntity = Array.isArray(data.entities)
    ? data.entities.find(
        (entity: Record<string, any>) =>
          Array.isArray(entity.roles) &&
          entity.roles
            .map((role: unknown) => String(role).toLowerCase())
            .includes('registrar')
      )
    : undefined

  return {
    domain,
    registered: true,
    registrar: registrarEntity
      ? {
          name: vcardName(registrarEntity),
          handle: registrarEntity.handle ?? null,
        }
      : null,
    events: rdapEventMap(data.events),
    authoritativeRdap: base,
    source: RDAP_SOURCE_LABEL,
  }
}

function domainNameAligned(domain: string, vendorName: string): boolean {
  const vendorCanonical = canonicalBusinessName(vendorName)
  const vendorCompact = vendorCanonical.replace(/[^A-Z0-9]/g, '').toLowerCase()
  const vendorTokens = vendorCanonical
    .toLowerCase()
    .split(' ')
    .map(token => token.replace(/[^a-z0-9]/g, ''))
    .filter(token => token.length >= 3)
  const ignored = new Set([
    'www',
    'api',
    'app',
    'portal',
    'secure',
    'vendor',
    'vendors',
  ])
  const hostTokens = domain
    .toLowerCase()
    .split('.')
    .slice(0, -1)
    .map(label => label.replace(/[^a-z0-9]/g, ''))
    .filter(label => label.length >= 3 && !ignored.has(label))

  return hostTokens.some(host => {
    if (host === vendorCompact) return true
    if (
      host.length >= 4 &&
      vendorCompact.length >= 4 &&
      (host.includes(vendorCompact) || vendorCompact.includes(host))
    ) {
      return true
    }
    return vendorTokens.some(
      token =>
        host === token ||
        (host.length >= 4 &&
          token.length >= 4 &&
          (host.includes(token) || token.includes(host)))
    )
  })
}

export async function runVendorGate(input: VendorGateInput) {
  const registryMatches = await searchPennsylvania(input.name, 3)
  const registryMatch = registryMatches[0] ?? null
  const registryNameScore =
    registryMatch?.businessName != null
      ? matchScore(registryMatch.businessName, input.name)
      : null
  const strongCandidates = registryMatches.filter(candidate =>
    candidate.businessName != null
      ? matchScore(candidate.businessName, input.name) <= 1
      : false
  )
  const registryStrongCandidateCount = strongCandidates.length
  const registryAmbiguous = registryStrongCandidateCount > 1
  const registryStrong =
    registryNameScore != null &&
    registryNameScore <= 1 &&
    !registryAmbiguous
  const registeredAddress = registryMatch
    ? registryAddress(registryMatch)
    : null
  const registryEvidenceComplete =
    registryMatch != null &&
    typeof registryMatch.businessName === 'string' &&
    registryMatch.businessName.trim().length > 0 &&
    typeof registryMatch.filingNumber === 'string' &&
    registryMatch.filingNumber.trim().length > 0 &&
    typeof registryMatch.registrationType === 'string' &&
    registryMatch.registrationType.trim().length > 0 &&
    registeredAddress != null

  const submittedPromise = geocode(input.address)
  const registryPromise = registeredAddress
    ? geocode(registeredAddress)
    : Promise.resolve(null)
  const ofacPromise = screenOfacName(input.name)
  const rdapPromise = lookupDomain(input.domain)

  const [submittedCensus, registryCensus, ofac, rdap] = await Promise.all([
    submittedPromise,
    registryPromise,
    ofacPromise,
    rdapPromise,
  ])

  const submittedRecord = submittedCensus as JsonRecord
  const registryRecord = registryCensus as JsonRecord | null
  const submittedCoordinates = censusCoordinates(submittedRecord)
  const registryCoordinates = censusCoordinates(registryRecord)
  const normalizeAddressInput = (value: string) =>
    value.trim().replace(/\s+/g, ' ').toUpperCase()
  const submittedInputAligned =
    typeof submittedRecord.input === 'string' &&
    normalizeAddressInput(submittedRecord.input) ===
      normalizeAddressInput(input.address)
  const registryInputAligned =
    !registeredAddress ||
    (typeof registryRecord?.input === 'string' &&
      normalizeAddressInput(registryRecord.input) ===
        normalizeAddressInput(registeredAddress))
  const submittedSourceComplete =
    submittedRecord.source === CENSUS_SOURCE_LABEL
  const registrySourceComplete =
    !registeredAddress || registryRecord?.source === CENSUS_SOURCE_LABEL
  const submittedMatchKnown = typeof submittedRecord.matched === 'boolean'
  const registryMatchKnown =
    !registeredAddress || typeof registryRecord?.matched === 'boolean'
  const submittedMatchedAddressComplete =
    submittedRecord.matched !== true ||
    (typeof submittedRecord.matchedAddress === 'string' &&
      submittedRecord.matchedAddress.trim().length > 0 &&
      submittedCoordinates != null)
  const registryMatchedAddressComplete =
    !registeredAddress ||
    registryRecord?.matched !== true ||
    (typeof registryRecord?.matchedAddress === 'string' &&
      registryRecord.matchedAddress.trim().length > 0 &&
      registryCoordinates != null)
  const submittedCensusComplete =
    submittedInputAligned &&
    submittedSourceComplete &&
    submittedMatchKnown &&
    submittedMatchedAddressComplete
  const registryCensusComplete =
    registryInputAligned &&
    registrySourceComplete &&
    registryMatchKnown &&
    registryMatchedAddressComplete

  const submittedMatched = submittedRecord.matched === true
  const registryAddressMatched = registryRecord?.matched === true
  const submittedIdentity = censusAddressIdentity(
    submittedRecord.matchedAddress
  )
  const registryIdentity = censusAddressIdentity(registryRecord?.matchedAddress)
  const sameStreetNumber =
    submittedIdentity.streetNumber != null &&
    submittedIdentity.streetNumber === registryIdentity.streetNumber
  const sameZip =
    submittedIdentity.zip != null &&
    submittedIdentity.zip === registryIdentity.zip
  const addressDistanceMiles =
    submittedCoordinates && registryCoordinates
      ? Number(distanceMiles(submittedCoordinates, registryCoordinates).toFixed(3))
      : null
  const addressConsistent =
    submittedMatched &&
    registryAddressMatched &&
    sameStreetNumber &&
    sameZip &&
    addressDistanceMiles != null &&
    addressDistanceMiles <= ADDRESS_MAX_MILES

  const ofacRecord = ofac as JsonRecord
  const ofacCandidates = Array.isArray(ofacRecord.candidates)
    ? ofacRecord.candidates.slice(0, 3)
    : null
  const ofacReturnedCount = numeric(ofacRecord.count)
  const ofacTotalCount = numeric(ofacRecord.totalCandidatesAboveThreshold)
  const ofacThreshold = numeric(ofacRecord.minScore)
  const ofacQueryAligned =
    typeof ofacRecord.query === 'string' &&
    canonicalBusinessName(ofacRecord.query) ===
      canonicalBusinessName(input.name)
  const ofacEvidenceComplete =
    ofacQueryAligned &&
    ofacThreshold === OFAC_REVIEW_THRESHOLD &&
    ofacReturnedCount != null &&
    ofacReturnedCount >= 0 &&
    ofacTotalCount != null &&
    ofacTotalCount >= ofacReturnedCount &&
    ofacCandidates != null &&
    ofacCandidates.length === ofacReturnedCount &&
    ofacRecord.source === OFAC_SOURCE_LABEL &&
    ofacRecord.reviewRequired === true
  const ofacCandidateCount = ofacEvidenceComplete ? ofacTotalCount : null

  const rdapRecord = rdap as JsonRecord
  const returnedDomain =
    typeof rdapRecord.domain === 'string'
      ? rdapRecord.domain.trim().toLowerCase().replace(/\.$/, '')
      : null
  const rdapDomainAligned = returnedDomain === input.domain
  const rdapRegistrationKnown = typeof rdapRecord.registered === 'boolean'
  const authoritativeRdap =
    typeof rdapRecord.authoritativeRdap === 'string' &&
    /^https?:\/\//i.test(rdapRecord.authoritativeRdap)
      ? rdapRecord.authoritativeRdap
      : null
  const rdapSourceComplete =
    typeof rdapRecord.source === 'string' &&
    rdapRecord.source.trim().length > 0
  const rdapEvidenceComplete =
    rdapDomainAligned &&
    rdapRegistrationKnown &&
    authoritativeRdap != null &&
    rdapSourceComplete
  const domainRegistered =
    rdapEvidenceComplete && rdapRecord.registered === true
  const domainNameMatchesVendor =
    domainRegistered && domainNameAligned(input.domain, input.name)

  const reviewTriggers: Array<{ code: string; detail: string }> = []

  if (!registryMatch) {
    reviewTriggers.push({
      code: 'pa_registry_match_not_found',
      detail:
        'No Pennsylvania registry candidate was found for the supplied vendor name.',
    })
  } else if (registryAmbiguous) {
    reviewTriggers.push({
      code: 'pa_registry_name_ambiguous',
      detail:
        'Multiple Pennsylvania registry records are strong matches for the supplied vendor name.',
    })
  } else if (!registryStrong) {
    reviewTriggers.push({
      code: 'pa_registry_name_needs_review',
      detail:
        'The best Pennsylvania registry name match was not strong enough for automatic continuation.',
    })
  } else if (!registryEvidenceComplete) {
    reviewTriggers.push({
      code: 'pa_registry_evidence_incomplete',
      detail:
        'The selected Pennsylvania registry record is missing core identity evidence required for automatic continuation.',
    })
  }

  if (!submittedCensusComplete) {
    reviewTriggers.push({
      code: 'census_provided_evidence_incomplete',
      detail:
        'The Census response for the supplied address did not satisfy the expected evidence contract.',
    })
  } else if (!submittedMatched) {
    reviewTriggers.push({
      code: 'provided_address_not_geocoded',
      detail: 'The supplied vendor address did not produce a Census match.',
    })
  } else if (registryMatch && !registeredAddress) {
    reviewTriggers.push({
      code: 'registry_address_missing',
      detail:
        'The matched Pennsylvania registry record did not provide a usable registered address.',
    })
  } else if (registeredAddress && !registryCensusComplete) {
    reviewTriggers.push({
      code: 'census_registry_evidence_incomplete',
      detail:
        'The Census response for the Pennsylvania registry address did not satisfy the expected evidence contract.',
    })
  } else if (registeredAddress && !registryAddressMatched) {
    reviewTriggers.push({
      code: 'registry_address_not_geocoded',
      detail:
        'The Pennsylvania registry address did not produce a Census match.',
    })
  } else if (
    registeredAddress &&
    submittedMatched &&
    registryAddressMatched &&
    !addressConsistent
  ) {
    reviewTriggers.push({
      code: 'registered_address_differs',
      detail:
        'The supplied vendor address does not closely align with the Pennsylvania registry address under the configured street-number, ZIP, and distance rules.',
    })
  }

  if (!ofacEvidenceComplete) {
    reviewTriggers.push({
      code: 'ofac_evidence_incomplete',
      detail:
        'The OFAC name-screen response did not satisfy the expected evidence contract.',
    })
  } else if (ofacCandidateCount != null && ofacCandidateCount > 0) {
    reviewTriggers.push({
      code: 'ofac_name_candidate_present',
      detail:
        'The OFAC SDN name screen returned at least one candidate at or above the configured review threshold.',
    })
  }

  if (!rdapEvidenceComplete) {
    reviewTriggers.push({
      code: 'rdap_evidence_incomplete',
      detail:
        'The RDAP response did not satisfy the expected evidence contract for the requested domain.',
    })
  } else if (!domainRegistered) {
    reviewTriggers.push({
      code: 'domain_registration_not_confirmed',
      detail:
        'Authoritative RDAP confirmed that the supplied domain is not currently registered.',
    })
  } else if (!domainNameMatchesVendor) {
    reviewTriggers.push({
      code: 'domain_name_not_aligned',
      detail:
        'The supplied domain is registered, but its hostname does not plausibly align with the submitted vendor name.',
    })
  }

  const decision =
    reviewTriggers.length === 0 ? 'proceed' : 'human_review'

  return {
    decision,
    agentAction:
      decision === 'proceed'
        ? 'continue_vendor_intake'
        : 'pause_and_request_human_review',
    reviewTriggers,
    checkedAt: new Date().toISOString(),
    input,
    policy: {
      registryNameMatch:
        'exactly one canonical exact or strong-prefix legal-entity candidate is required',
      registryEvidenceContract:
        'business name, filing number, registration type, and usable registered address are required',
      censusEvidenceContract:
        'input echo, boolean matched result, Census source, and matched=true requires normalized address plus numeric coordinates',
      addressMatch:
        'Census-normalized primary street number and ZIP must match, plus coordinate distance threshold',
      addressMaxDistanceMiles: ADDRESS_MAX_MILES,
      ofacReviewThreshold: OFAC_REVIEW_THRESHOLD,
      domainMustBeRegistered: true,
      domainEvidenceContract:
        'requested domain, boolean registration result, authoritative RDAP endpoint, and source are required',
      domainNameAlignment:
        'registered domain hostname labels must plausibly align with the submitted vendor name',
    },
    evidence: {
      registry: {
        service: 'Pennsylvania Department of State registry',
        found: Boolean(registryMatch),
        complete: registryEvidenceComplete,
        candidateCount: registryMatches.length,
        strongCandidateCount: registryStrongCandidateCount,
        ambiguous: registryAmbiguous,
        strongNameMatch: registryStrong,
        matchScore: registryNameScore,
        match: registryMatch,
        source: PA_SOURCE_LABEL,
      },
      address: {
        service: 'U.S. Census Address Geocoder',
        providedEvidenceComplete: submittedCensusComplete,
        providedInputAligned: submittedInputAligned,
        providedMatched: submittedMatched,
        providedMatchedAddress: submittedRecord.matchedAddress ?? null,
        registryAddress: registeredAddress,
        registryEvidenceComplete: registryCensusComplete,
        registryInputAligned,
        registryMatched: registryAddressMatched,
        registryMatchedAddress: registryRecord?.matchedAddress ?? null,
        submittedStreetNumber: submittedIdentity.streetNumber,
        registryStreetNumber: registryIdentity.streetNumber,
        sameStreetNumber,
        submittedZip: submittedIdentity.zip,
        registryZip: registryIdentity.zip,
        sameZip,
        distanceMiles: addressDistanceMiles,
        consistent: addressConsistent,
        source: CENSUS_SOURCE_LABEL,
      },
      ofac: {
        service: 'OFAC SDN Name Screen',
        complete: ofacEvidenceComplete,
        queryAligned: ofacQueryAligned,
        reviewThreshold: OFAC_REVIEW_THRESHOLD,
        reportedThreshold: ofacThreshold,
        returnedCount: ofacReturnedCount,
        candidateCount: ofacCandidateCount,
        candidates: ofacCandidates ?? [],
        source: ofacRecord.source ?? null,
      },
      domain: {
        service: 'Authoritative Domain RDAP',
        complete: rdapEvidenceComplete,
        requestedDomain: input.domain,
        returnedDomain,
        domainAligned: rdapDomainAligned,
        registrationKnown: rdapRegistrationKnown,
        registered: domainRegistered,
        nameAligned: domainNameMatchesVendor,
        authoritativeRdap,
        registrar: rdapRecord.registrar ?? null,
        events: rdapRecord.events ?? null,
        source: rdapRecord.source ?? null,
      },
    },
    limitations: [
      'A proceed result only means the configured automated intake checks did not trigger review; it is not legal, compliance, sanctions, fraud, or credit approval.',
      'OFAC evidence is candidate-name screening only. A no-candidate result is not sanctions clearance and does not perform 50 Percent Rule ownership analysis.',
      'A Pennsylvania registry match does not prove current good standing, ownership, or authority to contract.',
      'A Census address match does not prove physical presence or control of the location.',
      'RDAP registration and vendor-name alignment do not prove vendor ownership or control of the domain.',
    ],
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
        return {
          kind: 'unresolved',
          reason: 'settlement_transport_unknown',
          detail:
            'Settlement response could not be confirmed. Retry the same payment authorization.',
        }
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

  return {
    kind: 'unresolved',
    reason: 'settlement_unknown',
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

  let input: VendorGateInput
  try {
    input = validateVendorGateInput(new URL(request.url))
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
    result = await runVendorGate(input)
  } catch {
    return flootJson(
      {
        error: 'vendor_evidence_unavailable',
        detail:
          'At least one authoritative evidence source was unavailable; payment was not settled.',
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
    {
      ...result,
      paid: true,
      price: PRICE,
    },
    200,
    {
      'PAYMENT-RESPONSE': encodeHeader(settlement.receipt),
      'x402-settled': 'true',
      'cache-control': 'no-store',
    }
  )
}
