const SOURCE_TIMEOUT_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const attempts = 2;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (
        attempt < attempts - 1 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await response.body?.cancel().catch(() => {});
        await sleep(250);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
      await sleep(250);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('fetch_failed');
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Census
function firstGeoByKey(geographies, key) {
  const value = geographies[key];
  return Array.isArray(value) && value.length ? value[0] : null;
}

function firstGeoByPattern(geographies, pattern) {
  for (const [key, value] of Object.entries(geographies)) {
    if (pattern.test(key) && Array.isArray(value) && value.length) return value[0];
  }
  return null;
}

export async function geocodeAddress(address) {
  if (typeof address !== 'string' || address.trim().length < 6 || address.length > 240) {
    throw new Error('invalid_address');
  }
  const cleaned = address.trim().replace(/\s+/g, ' ');
  const url = new URL(
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
  );
  url.searchParams.set('address', cleaned);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('format', 'json');

  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Census returned ' + res.status);
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];

  if (!match) {
    return {
      input: cleaned,
      matched: false,
      matchedAddress: null,
      coordinates: null,
      addressComponents: null,
      geographies: null,
      source: 'U.S. Census Bureau Geocoding Services',
    };
  }

  const geos = match.geographies ?? {};
  const state = firstGeoByKey(geos, 'States');
  const county = firstGeoByKey(geos, 'Counties');
  const tract = firstGeoByKey(geos, 'Census Tracts');
  const block =
    firstGeoByKey(geos, 'Census Blocks') ??
    firstGeoByPattern(geos, /^\d{4} Census Blocks$/i);
  const district = firstGeoByPattern(
    geos,
    /^(?:\d+(?:st|nd|rd|th) )?Congressional Districts$/i
  );

  return {
    input: cleaned,
    matched: true,
    matchedAddress: match.matchedAddress ?? null,
    coordinates: {
      longitude: numeric(match.coordinates?.x),
      latitude: numeric(match.coordinates?.y),
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
  };
}

// RDAP
const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
let rdapBootstrapCache = null;

function normalizeDomain(raw) {
  let value = String(raw ?? '').trim().toLowerCase();
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (
    value.length < 3 ||
    value.length > 253 ||
    !/^[a-z0-9.-]+$/.test(value) ||
    !value.includes('.')
  ) {
    throw new Error('invalid_domain');
  }
  const labels = value.split('.');
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-')
    )
  ) {
    throw new Error('invalid_domain');
  }
  return value;
}

async function rdapBootstrap() {
  if (
    rdapBootstrapCache &&
    Date.now() - rdapBootstrapCache.loadedAt < 60 * 60 * 1000
  ) {
    return rdapBootstrapCache.data;
  }
  const res = await fetchWithTimeout(IANA_RDAP_BOOTSTRAP, {
    headers: {
      accept: 'application/json',
      'user-agent': 'x402-domain-rdap/1.0 (https://pa-entity-x402.floot.app)',
    },
  });
  if (!res.ok) throw new Error('IANA bootstrap returned ' + res.status);
  const data = await res.json();
  rdapBootstrapCache = { loadedAt: Date.now(), data };
  return data;
}

function findRdapBase(data, tld) {
  for (const service of data?.services ?? []) {
    const tlds = service?.[0] ?? [];
    const urls = service?.[1] ?? [];
    if (
      tlds.some((value) => String(value).toLowerCase() === tld.toLowerCase()) &&
      urls.length
    ) {
      return urls[0];
    }
  }
  return null;
}

function vcardName(entity) {
  const card = entity?.vcardArray;
  if (!Array.isArray(card) || !Array.isArray(card[1])) return null;
  for (const item of card[1]) {
    if (Array.isArray(item) && item[0] === 'fn') {
      return String(item[3] ?? '') || null;
    }
  }
  return null;
}

function eventMap(events) {
  const out = {};
  if (!Array.isArray(events)) return out;
  for (const item of events) {
    const action = String(item?.eventAction ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)/g, (_m, c) => c.toUpperCase());
    const date = String(item?.eventDate ?? '');
    if (action && date && !out[action]) out[action] = date;
  }
  return out;
}

export async function lookupDomain(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  const tld = domain.split('.').pop() ?? '';
  const registry = await rdapBootstrap();
  const base = findRdapBase(registry, tld);

  if (!base) {
    return {
      domain,
      registered: null,
      error: 'no_rdap_bootstrap_service',
      source: 'IANA RDAP Bootstrap Service Registry',
    };
  }

  const url = base.replace(/\/+$/, '') + '/domain/' + encodeURIComponent(domain);
  const res = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/rdap+json, application/json',
      'user-agent': 'x402-domain-rdap/1.0 (https://pa-entity-x402.floot.app)',
    },
    redirect: 'follow',
  });

  if (res.status === 404) {
    return {
      domain,
      registered: false,
      authoritativeRdap: base,
      source: 'Authoritative RDAP server discovered via IANA bootstrap',
    };
  }
  if (!res.ok) throw new Error('RDAP returned ' + res.status);
  const data = await res.json();

  const registrarEntity = Array.isArray(data?.entities)
    ? data.entities.find(
        (entity) =>
          Array.isArray(entity?.roles) &&
          entity.roles
            .map((role) => String(role).toLowerCase())
            .includes('registrar')
      )
    : undefined;

  const nameservers = Array.isArray(data?.nameservers)
    ? data.nameservers
        .map((ns) => String(ns?.ldhName ?? ns?.unicodeName ?? ''))
        .filter(Boolean)
    : [];

  return {
    domain,
    registered: true,
    handle: data?.handle ?? null,
    unicodeName: data?.unicodeName ?? null,
    status: Array.isArray(data?.status) ? data.status : [],
    registrar: registrarEntity
      ? {
          name: vcardName(registrarEntity),
          handle: registrarEntity.handle ?? null,
        }
      : null,
    events: eventMap(data?.events),
    nameservers,
    secureDns: data?.secureDNS
      ? { delegationSigned: data.secureDNS.delegationSigned ?? null }
      : null,
    authoritativeRdap: base,
    source: 'Authoritative RDAP server discovered via IANA bootstrap',
  };
}

// OFAC
const OFAC_BASE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';
const OFAC_CACHE_MS = 10 * 60 * 1000;
let ofacCache = null;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

function clean(value) {
  if (!value || value === '-0-') return null;
  return value.trim() || null;
}

async function fetchOfacFile(name) {
  const res = await fetchWithTimeout(OFAC_BASE + '/' + name, {
    headers: {
      'user-agent': 'x402-ofac-screen/1.0 (https://pa-entity-x402.floot.app)',
      accept: 'text/csv,*/*',
    },
    redirect: 'follow',
  }, 30000);
  if (!res.ok) throw new Error('OFAC returned ' + res.status + ' for ' + name);
  return await res.text();
}

async function loadOfacEntries() {
  if (ofacCache && Date.now() - ofacCache.loadedAt < OFAC_CACHE_MS) {
    return ofacCache.entries;
  }
  const [sdnText, altText] = await Promise.all([
    fetchOfacFile('SDN.CSV'),
    fetchOfacFile('ALT.CSV'),
  ]);
  const primaryRows = parseCsv(sdnText);
  const aliasRows = parseCsv(altText);
  const map = new Map();

  for (const cols of primaryRows) {
    const uid = (cols[0] ?? '').trim();
    const name = (cols[1] ?? '').trim();
    if (!uid || !name) continue;
    map.set(uid, {
      uid,
      name,
      type: clean(cols[2]),
      program: clean(cols[3]),
      title: clean(cols[4]),
      remarks: clean(cols[11]),
      aliases: [],
    });
  }

  for (const cols of aliasRows) {
    const uid = (cols[0] ?? '').trim();
    const altName = (cols[3] ?? '').trim();
    const entry = map.get(uid);
    if (!entry || !altName) continue;
    entry.aliases.push({
      type: clean(cols[2]),
      name: altName,
      remarks: clean(cols[4]),
    });
  }

  const entries = Array.from(map.values());
  ofacCache = { loadedAt: Date.now(), entries };
  return entries;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortedTokens(value) {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < next.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function jaccardTokens(a, b) {
  const aa = new Set(normalizeName(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  for (const token of aa) if (bb.has(token)) shared += 1;
  const union = new Set([...aa, ...bb]).size;
  return shared / union;
}

function scoreName(query, candidate) {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (sortedTokens(q) === sortedTokens(c)) return 99;
  const contains =
    q.length >= 5 && c.length >= 5 && (q.includes(c) || c.includes(q)) ? 94 : 0;
  const maxLen = Math.max(q.length, c.length);
  const edit = maxLen ? (1 - levenshtein(q, c) / maxLen) * 100 : 0;
  const sortedQ = sortedTokens(q);
  const sortedC = sortedTokens(c);
  const editSorted = maxLen
    ? (1 - levenshtein(sortedQ, sortedC) / Math.max(sortedQ.length, sortedC.length, 1)) * 100
    : 0;
  const tokens = jaccardTokens(q, c) * 100;
  return Math.max(contains, edit, editSorted, tokens);
}

export async function screenOfacName(name, options = {}) {
  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 160) throw new Error('invalid_name');
  const limit = Math.max(1, Math.min(Number.parseInt(String(options.limit ?? 5), 10) || 5, 10));
  const minScore = Math.max(
    70,
    Math.min(Number.parseInt(String(options.minScore ?? 85), 10) || 85, 100)
  );

  const entries = await loadOfacEntries();
  const candidates = [];

  for (const entry of entries) {
    let bestScore = scoreName(cleanName, entry.name);
    let matchedOn = 'primary';
    let matchedName = entry.name;
    for (const alias of entry.aliases) {
      const aliasScore = scoreName(cleanName, alias.name);
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        matchedOn = 'alias';
        matchedName = alias.name;
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
      });
    }
  }

  candidates.sort(
    (a, b) =>
      Number(b.score) - Number(a.score) ||
      String(a.primaryName).localeCompare(String(b.primaryName))
  );

  return {
    query: cleanName,
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
  };
}

// SEC EDGAR
const SEC_UA = 'x402-sec-filings/1.0 https://pa-entity-x402.floot.app';

async function secJson(url) {
  const res = await fetchWithTimeout(url, {
    headers: { 'user-agent': SEC_UA, accept: 'application/json' },
  });
  if (!res.ok) throw new Error('SEC returned ' + res.status);
  return await res.json();
}

function normalizeCik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 10) return null;
  return digits.padStart(10, '0');
}

async function resolveTicker(ticker) {
  const map = await secJson('https://www.sec.gov/files/company_tickers.json');
  const wanted = String(ticker ?? '').trim().toUpperCase();
  for (const value of Object.values(map)) {
    if (String(value?.ticker ?? '').toUpperCase() === wanted) {
      return normalizeCik(String(value?.cik_str ?? ''));
    }
  }
  return null;
}

export async function lookupSecFilings(input = {}) {
  const ticker = String(input.ticker ?? '').trim();
  const formFilter = String(input.form ?? '').trim().toUpperCase();
  const limit = Math.max(
    1,
    Math.min(Number.parseInt(String(input.limit ?? 10), 10) || 10, 25)
  );
  let cik = input.cik ? normalizeCik(input.cik) : null;
  if (!cik && ticker) cik = await resolveTicker(ticker);
  if (!cik) throw new Error('company_not_found');

  const data = await secJson(
    'https://data.sec.gov/submissions/CIK' + cik + '.json'
  );
  const recent = data?.filings?.recent ?? {};
  const forms = recent.form ?? [];
  const cikNoZero = String(Number.parseInt(cik, 10));
  const filings = [];

  for (let i = 0; i < forms.length && filings.length < limit; i += 1) {
    const form = String(forms[i] ?? '');
    if (formFilter && form.toUpperCase() !== formFilter) continue;
    const accessionNumber = String(recent.accessionNumber?.[i] ?? '');
    const primaryDocument = String(recent.primaryDocument?.[i] ?? '');
    const accessionCompact = accessionNumber.replace(/-/g, '');
    filings.push({
      form,
      filingDate: recent.filingDate?.[i] ?? null,
      reportDate: recent.reportDate?.[i] ?? null,
      acceptanceDateTime: recent.acceptanceDateTime?.[i] ?? null,
      accessionNumber,
      primaryDocument,
      primaryDocDescription: recent.primaryDocDescription?.[i] ?? null,
      filingUrl:
        accessionCompact && primaryDocument
          ? 'https://www.sec.gov/Archives/edgar/data/' +
            cikNoZero +
            '/' +
            accessionCompact +
            '/' +
            primaryDocument
          : null,
    });
  }

  return {
    company: {
      name: data?.name ?? null,
      cik,
      tickers: data?.tickers ?? [],
      exchanges: data?.exchanges ?? [],
      sic: data?.sic ?? null,
      sicDescription: data?.sicDescription ?? null,
    },
    count: filings.length,
    filings,
    source: 'U.S. Securities and Exchange Commission EDGAR',
  };
}

// Treasury Fiscal Data
const TREASURY_API =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates';

export async function latestTreasuryRates(security = '') {
  const filter = String(security ?? '').trim();
  if (filter.length > 100) throw new Error('invalid_security_filter');

  const url = new URL(TREASURY_API);
  url.searchParams.set(
    'fields',
    'record_date,security_type_desc,security_desc,avg_interest_rate_amt'
  );
  url.searchParams.set('sort', '-record_date');
  url.searchParams.set('page[size]', '100');

  const res = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'x402-treasury-average-rates/1.0 (https://pa-entity-x402.floot.app)',
    },
  });
  if (!res.ok) throw new Error('Treasury returned ' + res.status);

  const payload = await res.json();
  const rows = payload?.data ?? [];
  if (!rows.length) throw new Error('Treasury returned no data');

  const recordDate = String(rows[0]?.record_date ?? '');
  const needle = filter.toLowerCase();
  const latest = rows.filter((row) => String(row?.record_date ?? '') === recordDate);
  const filtered = needle
    ? latest.filter((row) =>
        String(row?.security_desc ?? '').toLowerCase().includes(needle)
      )
    : latest;

  return {
    recordDate,
    count: filtered.length,
    rates: filtered.map((row) => ({
      securityDescription: row?.security_desc ?? null,
      securityType: row?.security_type_desc ?? null,
      averageInterestRatePercent:
        row?.avg_interest_rate_amt === '' || row?.avg_interest_rate_amt == null
          ? null
          : Number(row.avg_interest_rate_amt),
    })),
    source:
      'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
    frequency: 'monthly',
  };
}


// Pennsylvania registry + composed vendor-intake gate
const PA_SOURCE = 'https://data.pa.gov/resource/xvd7-5r2c.json';
const PA_SOURCE_LABEL = 'Pennsylvania Department of State via data.pa.gov';
const MAX_QUERY_LENGTH = 120;
const OFAC_REVIEW_THRESHOLD = 90;
const VENDOR_GATE_ADDRESS_MAX_MILES = 0.25;

function canonicalBusinessName(value) {
  let text = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const suffix =
    /\s+(?:L\s+L\s+C|LLC|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|L\s+P|LP|L\s+L\s+P|LLP|P\s+C|PC)$/;
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(suffix, '').trim();
  }
  return text;
}

function matchScore(name, query) {
  const candidate = canonicalBusinessName(name);
  const wanted = canonicalBusinessName(query);
  if (candidate === wanted) return 0;
  if (candidate.startsWith(wanted + ' ')) return 1;
  if ((' ' + candidate + ' ').includes(' ' + wanted + ' ')) return 2;
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) return 3;
  return 4;
}

function normalizeSearchTerm(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length > MAX_QUERY_LENGTH) throw new Error('query_too_long');
  const cleaned = trimmed
    .replace(/[%_]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const significant = [...cleaned].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (significant.length < 2) throw new Error('query_too_short');
  return cleaned;
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
  ].join(',');
}

function normalizeCreationDate(value) {
  if (value == null) return null;
  const rawDate = String(value);
  if (rawDate.startsWith('1753-01-01')) return null;
  return rawDate.slice(0, 10);
}

function mapEntity(row) {
  return {
    businessName: row?.business_name == null ? null : String(row.business_name),
    filingNumber: row?.filing_number == null ? null : String(row.filing_number),
    registrationType:
      row?.typeofbusinessregistration == null
        ? null
        : String(row.typeofbusinessregistration),
    creationDate: normalizeCreationDate(row?.creationdate),
    address1: row?.address_line1 == null ? null : String(row.address_line1),
    address2: row?.address_line2 == null ? null : String(row.address_line2),
    city: row?.city == null ? null : String(row.city),
    state: row?.state == null ? null : String(row.state),
    zip: row?.zip == null ? null : String(row.zip),
    county: row?.shortcountyname == null ? null : String(row.shortcountyname),
    countyCode: row?.county_code == null ? null : String(row.county_code),
    principals: [],
  };
}

async function fetchEntityCandidates(query, mode, limit = 100) {
  const escaped = query.toUpperCase().replaceAll("'", "''");
  const pattern = mode === 'starts' ? escaped + '%' : '%' + escaped + '%';
  const url = new URL(PA_SOURCE);
  url.searchParams.set('$select', 'distinct ' + entityProjection());
  url.searchParams.set('$where', "upper(business_name) like '" + pattern + "'");
  url.searchParams.set('$limit', String(limit));

  const response = await fetchWithTimeout(url, {
    headers: { 'user-agent': 'PA-Entity-x402/2.0' },
  });
  if (!response.ok) throw new Error('PA Open Data returned ' + response.status);
  const rows = await response.json();
  return rows.map(mapEntity);
}

function dedupeAndRank(rows, query, limit) {
  const unique = new Map();
  for (const row of rows) {
    const key =
      row.filingNumber ??
      (row.businessName ?? '') + '|' + (row.address1 ?? '') + '|' + (row.city ?? '');
    if (!unique.has(key)) unique.set(key, row);
  }

  return [...unique.values()]
    .sort((a, b) => {
      const aName = a.businessName ?? '';
      const bName = b.businessName ?? '';
      const score = matchScore(aName, query) - matchScore(bName, query);
      if (score !== 0) return score;
      if (aName.length !== bName.length) return aName.length - bName.length;
      return aName.localeCompare(bName);
    })
    .slice(0, limit);
}

async function searchPennsylvaniaBase(query, limit) {
  const starts = await fetchEntityCandidates(query, 'starts');
  if (starts.length >= limit) return dedupeAndRank(starts, query, limit);
  const contains = await fetchEntityCandidates(query, 'contains');
  return dedupeAndRank([...starts, ...contains], query, limit);
}

function principalKey(principal) {
  return [
    principal?.role,
    principal?.firstName,
    principal?.middleName,
    principal?.lastName,
  ]
    .map((value) => value ?? '')
    .join('|')
    .toUpperCase();
}

async function enrichPrincipals(results) {
  const filingNumbers = results
    .map((item) => item.filingNumber)
    .filter(Boolean);
  if (filingNumbers.length === 0) return 'complete';

  const where = filingNumbers
    .map((value) => "'" + String(value).replaceAll("'", "''") + "'")
    .join(',');
  const url = new URL(PA_SOURCE);
  url.searchParams.set(
    '$select',
    'filing_number,party_type,first_name,middle_name,last_name'
  );
  url.searchParams.set('$where', 'filing_number in(' + where + ')');
  url.searchParams.set('$limit', '1000');

  try {
    const response = await fetchWithTimeout(url, {
      headers: { 'user-agent': 'PA-Entity-x402/2.0' },
    });
    if (!response.ok) return 'unavailable';
    const rows = await response.json();
    const byFiling = new Map();

    for (const row of rows) {
      if (row?.filing_number == null) continue;
      const filing = String(row.filing_number);
      const principal = {
        role: row?.party_type == null ? null : String(row.party_type),
        firstName: row?.first_name == null ? null : String(row.first_name),
        middleName: row?.middle_name == null ? null : String(row.middle_name),
        lastName: row?.last_name == null ? null : String(row.last_name),
      };
      const list = byFiling.get(filing) ?? [];
      const key = principalKey(principal);
      if (!list.some((item) => principalKey(item) === key)) list.push(principal);
      byFiling.set(filing, list);
    }

    for (const result of results) {
      result.principals =
        result.filingNumber == null ? [] : byFiling.get(result.filingNumber) ?? [];
    }
    return 'complete';
  } catch {
    return 'unavailable';
  }
}

export async function searchPennsylvaniaEntities(rawQuery, limit = 3) {
  const query = normalizeSearchTerm(rawQuery);
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 3, 25));
  const results = await searchPennsylvaniaBase(query, boundedLimit);
  const principals = await enrichPrincipals(results);
  return {
    query,
    count: results.length,
    results,
    enrichment: { principals },
    source: PA_SOURCE_LABEL,
  };
}

function registryAddress(entity) {
  const parts = [
    entity?.address1,
    entity?.address2,
    entity?.city,
    entity?.state,
    entity?.zip,
  ].filter((value) => Boolean(value && String(value).trim()));
  return parts.length ? parts.join(', ') : null;
}

function censusCoordinates(payload) {
  const coordinates = payload?.coordinates;
  if (!coordinates || typeof coordinates !== 'object') return null;
  const latitude = numeric(coordinates.latitude);
  const longitude = numeric(coordinates.longitude);
  return latitude == null || longitude == null
    ? null
    : { latitude, longitude };
}

function censusAddressIdentity(value) {
  if (typeof value !== 'string') return { streetNumber: null, zip: null };
  const text = value.toUpperCase().trim();
  const streetNumber = text.match(/^\s*(\d+[A-Z-]?)/)?.[1] ?? null;
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  return { streetNumber, zip };
}

function distanceMiles(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.7613;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function domainNameAligned(domain, vendorName) {
  const vendorCanonical = canonicalBusinessName(vendorName);
  const vendorCompact = vendorCanonical.replace(/[^A-Z0-9]/g, '').toLowerCase();
  const vendorTokens = vendorCanonical
    .toLowerCase()
    .split(' ')
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3);
  const ignored = new Set(['www', 'api', 'app', 'portal', 'secure', 'vendor', 'vendors']);
  const hostTokens = domain
    .toLowerCase()
    .split('.')
    .slice(0, -1)
    .map((label) => label.replace(/[^a-z0-9]/g, ''))
    .filter((label) => label.length >= 3 && !ignored.has(label));

  return hostTokens.some((host) => {
    if (host === vendorCompact) return true;
    if (
      host.length >= 4 &&
      vendorCompact.length >= 4 &&
      (host.includes(vendorCompact) || vendorCompact.includes(host))
    ) {
      return true;
    }
    return vendorTokens.some(
      (token) =>
        host === token ||
        (host.length >= 4 &&
          token.length >= 4 &&
          (host.includes(token) || token.includes(host)))
    );
  });
}

export async function runVendorIntakeGate(rawInput) {
  const input = {
    name: normalizeSearchTerm(rawInput?.name ?? ''),
    address: String(rawInput?.address ?? '').trim().replace(/\s+/g, ' '),
    domain: normalizeDomain(rawInput?.domain ?? ''),
  };
  if (input.address.length < 6 || input.address.length > 240) {
    throw new Error('invalid_address');
  }

  const registryMatches = await searchPennsylvaniaBase(input.name, 3);
  const registryMatch = registryMatches[0] ?? null;
  const registryNameScore =
    registryMatch?.businessName != null
      ? matchScore(registryMatch.businessName, input.name)
      : null;
  const registryStrongCandidates = registryMatches.filter((candidate) =>
    candidate?.businessName != null
      ? matchScore(candidate.businessName, input.name) <= 1
      : false
  );
  const registryStrongCandidateCount = registryStrongCandidates.length;
  const registryAmbiguous = registryStrongCandidateCount > 1;
  const registryStrong =
    registryNameScore != null && registryNameScore <= 1 && !registryAmbiguous;
  const registeredAddress = registryMatch ? registryAddress(registryMatch) : null;
  const registryEvidenceComplete =
    registryMatch != null &&
    typeof registryMatch.businessName === 'string' &&
    registryMatch.businessName.trim().length > 0 &&
    typeof registryMatch.filingNumber === 'string' &&
    registryMatch.filingNumber.trim().length > 0 &&
    typeof registryMatch.registrationType === 'string' &&
    registryMatch.registrationType.trim().length > 0 &&
    registeredAddress != null;

  const [submittedCensus, registryCensus, ofac, rdap] = await Promise.all([
    geocodeAddress(input.address),
    registeredAddress ? geocodeAddress(registeredAddress) : Promise.resolve(null),
    screenOfacName(input.name, { limit: 3, minScore: OFAC_REVIEW_THRESHOLD }),
    lookupDomain(input.domain),
  ]);

  const submittedCoordinates = censusCoordinates(submittedCensus);
  const registryCoordinates = censusCoordinates(registryCensus);
  const normalizeAddressInput = (value) =>
    String(value).trim().replace(/\s+/g, ' ').toUpperCase();
  const submittedInputAligned =
    typeof submittedCensus.input === 'string' &&
    normalizeAddressInput(submittedCensus.input) === normalizeAddressInput(input.address);
  const registryInputAligned =
    !registeredAddress ||
    (typeof registryCensus?.input === 'string' &&
      normalizeAddressInput(registryCensus.input) ===
        normalizeAddressInput(registeredAddress));
  const submittedSourceComplete =
    typeof submittedCensus.source === 'string' &&
    /Census Bureau/i.test(submittedCensus.source);
  const registrySourceComplete =
    !registeredAddress ||
    (typeof registryCensus?.source === 'string' &&
      /Census Bureau/i.test(registryCensus.source));
  const submittedMatchKnown = typeof submittedCensus.matched === 'boolean';
  const registryMatchKnown =
    !registeredAddress || typeof registryCensus?.matched === 'boolean';
  const submittedMatchedAddressComplete =
    submittedCensus.matched !== true ||
    (typeof submittedCensus.matchedAddress === 'string' &&
      submittedCensus.matchedAddress.trim().length > 0 &&
      submittedCoordinates != null);
  const registryMatchedAddressComplete =
    !registeredAddress ||
    registryCensus?.matched !== true ||
    (typeof registryCensus?.matchedAddress === 'string' &&
      registryCensus.matchedAddress.trim().length > 0 &&
      registryCoordinates != null);
  const submittedCensusComplete =
    submittedInputAligned &&
    submittedSourceComplete &&
    submittedMatchKnown &&
    submittedMatchedAddressComplete;
  const registryCensusComplete =
    registryInputAligned &&
    registrySourceComplete &&
    registryMatchKnown &&
    registryMatchedAddressComplete;
  const addressDistanceMiles =
    submittedCoordinates && registryCoordinates
      ? Number(distanceMiles(submittedCoordinates, registryCoordinates).toFixed(3))
      : null;
  const submittedMatched = submittedCensus.matched === true;
  const registryAddressMatched = registryCensus?.matched === true;
  const submittedAddressIdentity = censusAddressIdentity(submittedCensus.matchedAddress);
  const registryAddressIdentity = censusAddressIdentity(registryCensus?.matchedAddress);
  const sameStreetNumber =
    submittedAddressIdentity.streetNumber != null &&
    submittedAddressIdentity.streetNumber === registryAddressIdentity.streetNumber;
  const sameZip =
    submittedAddressIdentity.zip != null &&
    submittedAddressIdentity.zip === registryAddressIdentity.zip;
  const addressConsistent =
    submittedMatched &&
    registryAddressMatched &&
    sameStreetNumber &&
    sameZip &&
    addressDistanceMiles != null &&
    addressDistanceMiles <= VENDOR_GATE_ADDRESS_MAX_MILES;

  const ofacCandidates = Array.isArray(ofac?.candidates)
    ? ofac.candidates.slice(0, 3)
    : null;
  const ofacReturnedCount = numeric(ofac?.count);
  const ofacTotalCount = numeric(ofac?.totalCandidatesAboveThreshold);
  const ofacThreshold = numeric(ofac?.minScore);
  const ofacQueryAligned =
    typeof ofac?.query === 'string' &&
    canonicalBusinessName(ofac.query) === canonicalBusinessName(input.name);
  const ofacEvidenceComplete =
    ofacQueryAligned &&
    ofacThreshold === OFAC_REVIEW_THRESHOLD &&
    ofacReturnedCount != null &&
    ofacReturnedCount >= 0 &&
    ofacTotalCount != null &&
    ofacTotalCount >= ofacReturnedCount &&
    ofacCandidates != null &&
    ofacCandidates.length === ofacReturnedCount &&
    typeof ofac?.source === 'string' &&
    ofac.source.trim().length > 0 &&
    ofac.reviewRequired === true;
  const ofacCandidateCount = ofacEvidenceComplete ? ofacTotalCount : null;

  const rdapReturnedDomain =
    typeof rdap?.domain === 'string'
      ? rdap.domain.trim().toLowerCase().replace(/\.$/, '')
      : null;
  const rdapDomainAligned = rdapReturnedDomain === input.domain;
  const rdapRegistrationKnown = typeof rdap?.registered === 'boolean';
  const rdapAuthoritativeRdap =
    typeof rdap?.authoritativeRdap === 'string' &&
    /^https?:\/\//i.test(rdap.authoritativeRdap)
      ? rdap.authoritativeRdap
      : null;
  const rdapSourceComplete =
    typeof rdap?.source === 'string' && rdap.source.trim().length > 0;
  const rdapEvidenceComplete =
    rdapDomainAligned &&
    rdapRegistrationKnown &&
    rdapAuthoritativeRdap != null &&
    rdapSourceComplete;
  const domainRegistered = rdapEvidenceComplete && rdap.registered === true;
  const domainNameMatchesVendor =
    domainRegistered && domainNameAligned(input.domain, input.name);

  const reviewTriggers = [];
  if (!registryMatch) {
    reviewTriggers.push({
      code: 'pa_registry_match_not_found',
      detail: 'No Pennsylvania registry candidate was found for the supplied vendor name.',
    });
  } else if (registryAmbiguous) {
    reviewTriggers.push({
      code: 'pa_registry_name_ambiguous',
      detail:
        'Multiple Pennsylvania registry records are strong matches for the supplied vendor name, so a human should select the intended legal entity before continuing.',
    });
  } else if (!registryStrong) {
    reviewTriggers.push({
      code: 'pa_registry_name_needs_review',
      detail:
        'The best Pennsylvania registry name match was not strong enough for automatic continuation.',
    });
  } else if (!registryEvidenceComplete) {
    reviewTriggers.push({
      code: 'pa_registry_evidence_incomplete',
      detail:
        'The selected Pennsylvania registry record is missing one or more core identity fields required for automatic continuation: business name, filing number, registration type, and usable registered address.',
    });
  }

  if (!submittedCensusComplete) {
    reviewTriggers.push({
      code: 'census_provided_evidence_incomplete',
      detail:
        'The Census response for the supplied vendor address did not satisfy the expected evidence contract, so the workflow cannot safely interpret its address match.',
    });
  } else if (!submittedMatched) {
    reviewTriggers.push({
      code: 'provided_address_not_geocoded',
      detail: 'The supplied vendor address did not produce a Census match.',
    });
  } else if (registryMatch && !registeredAddress) {
    reviewTriggers.push({
      code: 'registry_address_missing',
      detail: 'The matched Pennsylvania registry record did not provide a usable registered address.',
    });
  } else if (registeredAddress && !registryCensusComplete) {
    reviewTriggers.push({
      code: 'census_registry_evidence_incomplete',
      detail:
        'The Census response for the Pennsylvania registry address did not satisfy the expected evidence contract, so the workflow cannot safely compare the addresses.',
    });
  } else if (registeredAddress && !registryAddressMatched) {
    reviewTriggers.push({
      code: 'registry_address_not_geocoded',
      detail: 'The Pennsylvania registry address did not produce a Census match.',
    });
  } else if (
    registeredAddress &&
    submittedMatched &&
    registryAddressMatched &&
    !addressConsistent
  ) {
    reviewTriggers.push({
      code: 'registered_address_differs',
      detail:
        'The supplied vendor address does not closely align with the Pennsylvania registry address: Census-normalized street number and ZIP must match and coordinates must fall within the configured distance rule.',
    });
  }

  if (!ofacEvidenceComplete) {
    reviewTriggers.push({
      code: 'ofac_evidence_incomplete',
      detail:
        'The OFAC SDN name-screen response did not satisfy the expected evidence contract, so the workflow cannot safely interpret it as a no-candidate result.',
    });
  } else if (ofacCandidateCount != null && ofacCandidateCount > 0) {
    reviewTriggers.push({
      code: 'ofac_name_candidate_present',
      detail:
        'The OFAC SDN name screen returned at least one candidate at or above the configured review threshold; a human should inspect the candidate details before continuing.',
    });
  }

  if (!rdapEvidenceComplete) {
    reviewTriggers.push({
      code: 'rdap_evidence_incomplete',
      detail:
        'The RDAP response did not satisfy the expected evidence contract for the requested domain, so the workflow cannot safely interpret its registration result.',
    });
  } else if (!domainRegistered) {
    reviewTriggers.push({
      code: 'domain_registration_not_confirmed',
      detail:
        'Authoritative RDAP confirmed that the supplied domain is not currently registered.',
    });
  } else if (!domainNameMatchesVendor) {
    reviewTriggers.push({
      code: 'domain_name_not_aligned',
      detail:
        'The supplied domain is registered, but its hostname does not plausibly align with the submitted vendor name; a human should confirm the relationship before continuing.',
    });
  }

  const decision = reviewTriggers.length === 0 ? 'proceed' : 'human_review';
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
        'exactly one canonical exact or strong-prefix legal-entity candidate is required for automatic continuation',
      registryEvidenceContract:
        'business name, filing number, registration type, and usable registered address are required for automatic continuation',
      censusEvidenceContract:
        'expected input echo, boolean matched result, Census source, and matched=true requires a normalized address plus numeric coordinates',
      addressMatch:
        'Census-normalized primary street number and ZIP must match, plus coordinate distance threshold',
      addressMaxDistanceMiles: VENDOR_GATE_ADDRESS_MAX_MILES,
      ofacReviewThreshold: OFAC_REVIEW_THRESHOLD,
      domainMustBeRegistered: true,
      domainEvidenceContract:
        'requested domain, boolean registration result, authoritative RDAP endpoint, and source must all be present',
      domainNameAlignment:
        'registered domain hostname labels must plausibly align with the submitted vendor name',
    },
    evidence: {
      registry: {
        service: 'PA Entity Lookup x402',
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
        service: 'US Census Address Geocoder x402',
        providedEvidenceComplete: submittedCensusComplete,
        providedInputAligned: submittedInputAligned,
        providedMatched: submittedMatched,
        providedMatchedAddress: submittedCensus.matchedAddress ?? null,
        registryAddress: registeredAddress,
        registryEvidenceComplete: registryCensusComplete,
        registryInputAligned,
        registryMatched: registryAddressMatched,
        registryMatchedAddress: registryCensus?.matchedAddress ?? null,
        submittedStreetNumber: submittedAddressIdentity.streetNumber,
        registryStreetNumber: registryAddressIdentity.streetNumber,
        sameStreetNumber,
        submittedZip: submittedAddressIdentity.zip,
        registryZip: registryAddressIdentity.zip,
        sameZip,
        distanceMiles: addressDistanceMiles,
        consistent: addressConsistent,
      },
      ofac: {
        service: 'OFAC SDN Name Screen x402',
        complete: ofacEvidenceComplete,
        queryAligned: ofacQueryAligned,
        reviewThreshold: OFAC_REVIEW_THRESHOLD,
        reportedThreshold: ofacThreshold,
        returnedCount: ofacReturnedCount,
        candidateCount: ofacCandidateCount,
        candidates: ofacCandidates ?? [],
        source: ofac?.source ?? null,
      },
      domain: {
        service: 'Domain RDAP Lookup x402',
        complete: rdapEvidenceComplete,
        requestedDomain: input.domain,
        returnedDomain: rdapReturnedDomain,
        domainAligned: rdapDomainAligned,
        registrationKnown: rdapRegistrationKnown,
        registered: domainRegistered,
        nameAligned: domainNameMatchesVendor,
        authoritativeRdap: rdapAuthoritativeRdap,
        registrar: rdap?.registrar ?? null,
        events: rdap?.events ?? null,
        source: rdap?.source ?? null,
      },
    },
    limitations: [
      'A proceed result only means the configured automated intake checks did not trigger review; it is not legal, compliance, sanctions, fraud, or credit approval.',
      'OFAC evidence is candidate-name screening only. A no-candidate result is not sanctions clearance and does not perform 50 Percent Rule ownership analysis.',
      'A Pennsylvania registry match does not prove current good standing, ownership, or authority to contract.',
      'A Census address match does not prove physical presence or control of the location.',
      'RDAP registration and vendor-name alignment do not prove that the vendor owns or controls the domain; name alignment is a conservative heuristic and brand domains may require human review.',
    ],
  };
}

export async function runVendorGateFixture(sampleCase = 'proceed') {
  if (!['proceed', 'address_mismatch', 'domain_mismatch'].includes(sampleCase)) {
    throw new Error('unknown_fixture');
  }
  const input =
    sampleCase === 'address_mismatch'
      ? {
          name: 'OpenAI OpCo',
          address: '4600 Silver Hill Rd, Washington, DC 20233',
          domain: 'openai.com',
        }
      : sampleCase === 'domain_mismatch'
        ? {
            name: 'OpenAI OpCo',
            address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
            domain: 'example.com',
          }
        : {
            name: 'OpenAI OpCo',
            address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
            domain: 'openai.com',
          };
  return runVendorIntakeGate(input);
}
