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
