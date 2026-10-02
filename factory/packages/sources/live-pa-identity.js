"use strict";

const PA_SOURCE = "https://data.pa.gov/resource/xvd7-5r2c.json";
const CENSUS_DEMO = "https://api-v2.appdeploy.ai/app/us-census-address-geocoder-x402-23mj4x/api/demo";
const RDAP_DEMO = "https://api-v2.appdeploy.ai/app/domain-rdap-lookup-x402-spdfnq/api/demo";
const SOURCE_TIMEOUT_MS = 10000;

function canonicalBusinessName(value) {
  let text = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = /\s+(?:L\s+L\s+C|LLC|INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|L\s+P|LP|L\s+L\s+P|LLP|P\s+C|PC)$/;
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(suffix, "").trim();
  }
  return text;
}

function matchScore(name, query) {
  const candidate = canonicalBusinessName(name);
  const wanted = canonicalBusinessName(query);
  if (candidate === wanted) return 0;
  if (candidate.startsWith(wanted + " ")) return 1;
  if ((" " + candidate + " ").includes(" " + wanted + " ")) return 2;
  if (candidate.replaceAll(" ", "").includes(wanted.replaceAll(" ", ""))) return 3;
  return 4;
}

function normalizeCompany(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/[%_]/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if ([...value].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length < 2) {
    const error = new Error("company_too_short");
    error.code = "INVALID_INPUT";
    throw error;
  }
  if (value.length > 120) {
    const error = new Error("company_too_long");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

async function fetchJson(fetchImpl, url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response || response.ok !== true) {
      const error = new Error("source_http_" + (response?.status ?? "unknown"));
      error.code = "SOURCE_HTTP_ERROR";
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function entityProjection() {
  return [
    "business_name",
    "filing_number",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "zip",
    "typeofbusinessregistration",
    "creationdate",
    "shortcountyname",
    "county_code",
  ].join(",");
}

function mapEntity(row) {
  return {
    businessName: row.business_name == null ? null : String(row.business_name),
    filingNumber: row.filing_number == null ? null : String(row.filing_number),
    registrationType: row.typeofbusinessregistration == null ? null : String(row.typeofbusinessregistration),
    creationDate: row.creationdate == null || String(row.creationdate).startsWith("1753-01-01")
      ? null
      : String(row.creationdate).slice(0, 10),
    address1: row.address_line1 == null ? null : String(row.address_line1),
    address2: row.address_line2 == null ? null : String(row.address_line2),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    zip: row.zip == null ? null : String(row.zip),
    county: row.shortcountyname == null ? null : String(row.shortcountyname),
    countyCode: row.county_code == null ? null : String(row.county_code),
  };
}

function entityAddress(entity) {
  const parts = [entity?.address1, entity?.address2, entity?.city, entity?.state, entity?.zip]
    .filter((value) => typeof value === "string" && value.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

function dedupeAndRank(rows, query, limit) {
  const unique = new Map();
  for (const row of rows) {
    const key = row.filingNumber || [row.businessName || "", row.address1 || "", row.city || ""].join("|");
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()]
    .sort((a, b) => {
      const an = a.businessName || "";
      const bn = b.businessName || "";
      const score = matchScore(an, query) - matchScore(bn, query);
      if (score !== 0) return score;
      if (an.length !== bn.length) return an.length - bn.length;
      return an.localeCompare(bn);
    })
    .slice(0, limit);
}

function createPaRegistryAdapter({ fetchImpl = fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  async function candidates(query, mode) {
    const escaped = query.toUpperCase().replaceAll("'", "''");
    const pattern = mode === "starts" ? escaped + "%" : "%" + escaped + "%";
    const url = new URL(PA_SOURCE);
    url.searchParams.set("$select", "distinct " + entityProjection());
    url.searchParams.set("$where", "upper(business_name) like '" + pattern + "'");
    url.searchParams.set("$limit", "100");
    const rows = await fetchJson(fetchImpl, url.toString(), {
      headers: { "user-agent": "x402-product-factory/0.1" },
    }, timeoutMs);
    if (!Array.isArray(rows)) {
      const error = new Error("pa_registry_invalid_json");
      error.code = "SOURCE_CONTRACT_INVALID";
      throw error;
    }
    return rows.map(mapEntity);
  }

  return {
    async lookup({ company }) {
      const query = normalizeCompany(company);
      const starts = await candidates(query, "starts");
      const rows = starts.length >= 3 ? starts : [...starts, ...(await candidates(query, "contains"))];
      const ranked = dedupeAndRank(rows, query, 3);
      const entity = ranked[0] || null;
      const score = entity?.businessName ? matchScore(entity.businessName, query) : null;
      const strongCandidates = ranked.filter((candidate) =>
        candidate.businessName ? matchScore(candidate.businessName, query) <= 1 : false
      );
      const ambiguous = strongCandidates.length > 1;
      const complete = Boolean(
        entity?.businessName &&
        entity?.filingNumber &&
        entity?.registrationType &&
        entityAddress(entity)
      );
      return {
        available: true,
        strongMatch: score != null && score <= 1 && !ambiguous && complete,
        entity,
        candidateCount: ranked.length,
        strongCandidateCount: strongCandidates.length,
        ambiguous,
        matchScore: score,
        identityComplete: complete,
        provenance: {
          source: "Pennsylvania Department of State via data.pa.gov",
          url: PA_SOURCE,
        },
      };
    },
  };
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function coords(payload) {
  const c = payload?.coordinates;
  const latitude = Number(c?.latitude);
  const longitude = Number(c?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function addressIdentity(value) {
  if (typeof value !== "string") return { streetNumber: null, zip: null };
  const text = value.toUpperCase().trim();
  return {
    streetNumber: text.match(/^\s*(\d+[A-Z-]?)/)?.[1] ?? null,
    zip: text.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null,
  };
}

function distanceMiles(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const radius = 3958.7613;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function censusPayloadComplete(payload, requestedAddress) {
  if (!payload || typeof payload !== "object") return false;
  if (normalizeAddress(payload.input) !== normalizeAddress(requestedAddress)) return false;
  if (typeof payload.source !== "string" || !/Census Bureau/i.test(payload.source)) return false;
  if (typeof payload.matched !== "boolean") return false;
  if (payload.matched === true) {
    if (typeof payload.matchedAddress !== "string" || !payload.matchedAddress.trim()) return false;
    if (!coords(payload)) return false;
  }
  return true;
}

function createCensusAddressAdapter({ fetchImpl = fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  async function lookup(address) {
    const url = new URL(CENSUS_DEMO);
    url.searchParams.set("address", address);
    return await fetchJson(fetchImpl, url.toString(), { headers: { accept: "application/json" } }, timeoutMs);
  }

  return {
    async compare({ suppliedAddress, registryAddress }) {
      const [supplied, registered] = await Promise.all([lookup(suppliedAddress), lookup(registryAddress)]);
      if (!censusPayloadComplete(supplied, suppliedAddress) || !censusPayloadComplete(registered, registryAddress)) {
        return { available: false, detail: "census_contract_incomplete" };
      }
      const suppliedCoordinates = coords(supplied);
      const registryCoordinates = coords(registered);
      const suppliedId = addressIdentity(supplied.matchedAddress);
      const registryId = addressIdentity(registered.matchedAddress);
      const bothMatched = supplied.matched === true && registered.matched === true;
      return {
        available: true,
        suppliedMatched: supplied.matched === true,
        registryMatched: registered.matched === true,
        sameStreetNumber: bothMatched && suppliedId.streetNumber != null && suppliedId.streetNumber === registryId.streetNumber,
        sameZip: bothMatched && suppliedId.zip != null && suppliedId.zip === registryId.zip,
        distanceMiles: suppliedCoordinates && registryCoordinates
          ? Number(distanceMiles(suppliedCoordinates, registryCoordinates).toFixed(3))
          : null,
        suppliedMatchedAddress: supplied.matchedAddress ?? null,
        registryMatchedAddress: registered.matchedAddress ?? null,
        provenance: { source: "U.S. Census Bureau Geocoding Services", url: CENSUS_DEMO },
      };
    },
  };
}

function normalizeDomain(raw) {
  const value = String(raw || "").trim().toLowerCase().replace(/\.$/, "");
  if (value.length < 3 || value.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(value)) {
    const error = new Error("invalid_domain");
    error.code = "INVALID_INPUT";
    throw error;
  }
  return value;
}

function createRdapAdapter({ fetchImpl = fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  return {
    async lookup({ domain }) {
      const requested = normalizeDomain(domain);
      const url = new URL(RDAP_DEMO);
      url.searchParams.set("domain", requested);
      const payload = await fetchJson(fetchImpl, url.toString(), { headers: { accept: "application/json" } }, timeoutMs);
      const returned = typeof payload?.domain === "string" ? payload.domain.trim().toLowerCase().replace(/\.$/, "") : null;
      const authoritative = typeof payload?.authoritativeRdap === "string" && /^https?:\/\//i.test(payload.authoritativeRdap)
        ? payload.authoritativeRdap
        : null;
      const complete =
        returned === requested &&
        typeof payload?.registered === "boolean" &&
        authoritative != null &&
        typeof payload?.source === "string" &&
        payload.source.trim().length > 0;
      if (!complete) return { available: false, detail: "rdap_contract_incomplete" };
      return {
        available: true,
        registered: payload.registered === true,
        domain: returned,
        authoritativeRdap: authoritative,
        registrar: payload.registrar ?? null,
        events: payload.events ?? null,
        provenance: { source: payload.source, url: RDAP_DEMO },
      };
    },
  };
}

module.exports = {
  PA_SOURCE,
  CENSUS_DEMO,
  RDAP_DEMO,
  canonicalBusinessName,
  matchScore,
  addressIdentity,
  distanceMiles,
  createPaRegistryAdapter,
  createCensusAddressAdapter,
  createRdapAdapter,
};
