import { matchScore } from './vendor-intake-gate-core.mjs';

const PA_SOURCE = 'https://data.pa.gov/resource/xvd7-5r2c.json';
const SOURCE_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
  ].join(',');
}

function normalizeCreationDate(value) {
  if (value == null) return null;
  const raw = String(value);
  if (raw.startsWith('1753-01-01')) return null;
  return raw.slice(0, 10);
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
  const escaped = String(query).toUpperCase().replaceAll("'", "''");
  const pattern = mode === 'starts' ? `${escaped}%` : `%${escaped}%`;
  const url = new URL(PA_SOURCE);
  url.searchParams.set('$select', `distinct ${entityProjection()}`);
  url.searchParams.set('$where', `upper(business_name) like '${pattern}'`);
  url.searchParams.set('$limit', String(limit));

  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'PA-Entity-x402/2.0 (https://pa-entity-x402.floot.app)',
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`PA Open Data returned ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error('PA Open Data returned invalid JSON');
  }
  return rows.map(mapEntity);
}

function dedupeAndRank(rows, query, limit) {
  const unique = new Map();
  for (const row of rows) {
    const key =
      row.filingNumber ??
      `${row.businessName ?? ''}|${row.address1 ?? ''}|${row.city ?? ''}`;
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

export async function searchPennsylvaniaEntities(query, limit = 3) {
  const cleaned = String(query ?? '').trim();
  if (cleaned.length < 2 || cleaned.length > 120) {
    throw new Error('invalid_query');
  }

  const starts = await fetchEntityCandidates(cleaned, 'starts');
  if (starts.length >= limit) return dedupeAndRank(starts, cleaned, limit);

  const contains = await fetchEntityCandidates(cleaned, 'contains');
  return dedupeAndRank([...starts, ...contains], cleaned, limit);
}
