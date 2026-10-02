import { geocodeAddress, lookupDomain, screenOfacName } from './x402-rehost-core.mjs';

const PA_SOURCE = 'https://data.pa.gov/resource/xvd7-5r2c.json';
const PA_SOURCE_LABEL = 'Pennsylvania Department of State via data.pa.gov';
const SOURCE_TIMEOUT_MS = 15000;
const OFAC_REVIEW_THRESHOLD = 90;
const ADDRESS_MAX_MILES = 0.25;
const DEFAULT_ORIGIN = 'https://pa-entity-x402.floot.app';

async function fetchWithTimeout(url, init = {}, timeoutMs = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function canonicalBusinessName(value) {
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

export function matchScore(name, query) {
  const candidate = canonicalBusinessName(name);
  const wanted = canonicalBusinessName(query);
  if (candidate === wanted) return 0;
  if (candidate.startsWith(`${wanted} `)) return 1;
  if (` ${candidate} `.includes(` ${wanted} `)) return 2;
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) return 3;
  return 4;
}

export function normalizeVendorInput(raw = {}) {
  const name = String(raw.name ?? '')
    .trim()
    .replace(/[%_]/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const significant = [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (name.length > 120) throw new Error('query_too_long');
  if (significant.length < 2) throw new Error('query_too_short');

  const address = String(raw.address ?? '').trim().replace(/\s+/g, ' ');
  if (address.length < 6 || address.length > 240) throw new Error('invalid_address');

  let domain = String(raw.domain ?? '').trim().toLowerCase();
  if (domain.endsWith('.')) domain = domain.slice(0, -1);
  if (
    domain.length < 3 ||
    domain.length > 253 ||
    !/^[a-z0-9.-]+$/.test(domain) ||
    !domain.includes('.')
  ) {
    throw new Error('invalid_domain');
  }
  const labels = domain.split('.');
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

  return { name, address, domain };
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
  const escaped = query.toUpperCase().replaceAll("'", "''");
  const pattern = mode === 'starts' ? `${escaped}%` : `%${escaped}%`;
  const url = new URL(PA_SOURCE);
  url.searchParams.set('$select', `distinct ${entityProjection()}`);
  url.searchParams.set('$where', `upper(business_name) like '${pattern}'`);
  url.searchParams.set('$limit', String(limit));
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'PA-Entity-x402/2.0 (https://pa-entity-x402.floot.app)',
    },
  });
  if (!response.ok) throw new Error(`PA Open Data returned ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('PA Open Data returned invalid JSON');
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
  const starts = await fetchEntityCandidates(query, 'starts');
  if (starts.length >= limit) return dedupeAndRank(starts, query, limit);
  const contains = await fetchEntityCandidates(query, 'contains');
  return dedupeAndRank([...starts, ...contains], query, limit);
}

function registryAddress(entity) {
  if (!entity) return null;
  const parts = [
    entity.address1,
    entity.address2,
    entity.city,
    entity.state,
    entity.zip,
  ].filter((value) => typeof value === 'string' && value.trim());
  return parts.length ? parts.join(', ') : null;
}

function coordinates(payload) {
  const latitude = numeric(payload?.coordinates?.latitude);
  const longitude = numeric(payload?.coordinates?.longitude);
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

function addressIdentity(value) {
  if (typeof value !== 'string') return { streetNumber: null, zip: null };
  const text = value.toUpperCase().trim();
  return {
    streetNumber: text.match(/^\s*(\d+[A-Z-]?)/)?.[1] ?? null,
    zip: text.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null,
  };
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

function normalizeAddressInput(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function domainNameAligned(domain, vendorName) {
  const vendorCanonical = canonicalBusinessName(vendorName);
  const vendorCompact = vendorCanonical.replace(/[^A-Z0-9]/g, '').toLowerCase();
  const vendorTokens = vendorCanonical
    .toLowerCase()
    .split(' ')
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3);
  const ignored = new Set([
    'www',
    'api',
    'app',
    'portal',
    'secure',
    'vendor',
    'vendors',
  ]);
  const hostTokens = String(domain)
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

export function evaluateVendorIntakeEvidence(bundle, options = {}) {
  const input = normalizeVendorInput(bundle?.input ?? {});
  const registryMatches = Array.isArray(bundle?.registryMatches)
    ? bundle.registryMatches
    : [];
  const registryMatch = registryMatches[0] ?? null;
  const registryNameScore =
    registryMatch?.businessName != null
      ? matchScore(registryMatch.businessName, input.name)
      : null;
  const strongCandidates = registryMatches.filter(
    (candidate) =>
      candidate?.businessName != null &&
      matchScore(candidate.businessName, input.name) <= 1
  );
  const strongCandidateCount = strongCandidates.length;
  const registryAmbiguous = strongCandidateCount > 1;
  const registryStrong =
    registryNameScore != null &&
    registryNameScore <= 1 &&
    !registryAmbiguous;
  const registeredAddress = registryAddress(registryMatch);
  const registryComplete =
    registryMatch != null &&
    typeof registryMatch.businessName === 'string' &&
    registryMatch.businessName.trim().length > 0 &&
    typeof registryMatch.filingNumber === 'string' &&
    registryMatch.filingNumber.trim().length > 0 &&
    typeof registryMatch.registrationType === 'string' &&
    registryMatch.registrationType.trim().length > 0 &&
    registeredAddress != null;

  const submittedCensus = bundle?.submittedCensus ?? {};
  const registryCensus = bundle?.registryCensus ?? null;
  const submittedCoordinates = coordinates(submittedCensus);
  const registryCoordinates = coordinates(registryCensus);
  const submittedInputAligned =
    typeof submittedCensus?.input === 'string' &&
    normalizeAddressInput(submittedCensus.input) ===
      normalizeAddressInput(input.address);
  const registryInputAligned =
    !registeredAddress ||
    (typeof registryCensus?.input === 'string' &&
      normalizeAddressInput(registryCensus.input) ===
        normalizeAddressInput(registeredAddress));
  const submittedSourceComplete =
    typeof submittedCensus?.source === 'string' &&
    /Census Bureau/i.test(submittedCensus.source);
  const registrySourceComplete =
    !registeredAddress ||
    (typeof registryCensus?.source === 'string' &&
      /Census Bureau/i.test(registryCensus.source));
  const submittedMatchKnown = typeof submittedCensus?.matched === 'boolean';
  const registryMatchKnown =
    !registeredAddress || typeof registryCensus?.matched === 'boolean';
  const submittedMatchedAddressComplete =
    submittedCensus?.matched !== true ||
    (typeof submittedCensus?.matchedAddress === 'string' &&
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
  const submittedMatched = submittedCensus?.matched === true;
  const registryMatched = registryCensus?.matched === true;
  const submittedIdentity = addressIdentity(submittedCensus?.matchedAddress);
  const registryIdentity = addressIdentity(registryCensus?.matchedAddress);
  const sameStreetNumber =
    submittedIdentity.streetNumber != null &&
    submittedIdentity.streetNumber === registryIdentity.streetNumber;
  const sameZip =
    submittedIdentity.zip != null && submittedIdentity.zip === registryIdentity.zip;
  const addressConsistent =
    submittedMatched &&
    registryMatched &&
    sameStreetNumber &&
    sameZip &&
    addressDistanceMiles != null &&
    addressDistanceMiles <= ADDRESS_MAX_MILES;

  const ofac = bundle?.ofac ?? {};
  const ofacCandidates = Array.isArray(ofac?.candidates)
    ? ofac.candidates.slice(0, 3)
    : null;
  const ofacReturnedCount = numeric(ofac?.count);
  const ofacTotalCount = numeric(ofac?.totalCandidatesAboveThreshold);
  const ofacThreshold = numeric(ofac?.minScore);
  const ofacQueryAligned =
    typeof ofac?.query === 'string' &&
    canonicalBusinessName(ofac.query) === canonicalBusinessName(input.name);
  const ofacComplete =
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
    ofac?.reviewRequired === true;
  const ofacCandidateCount = ofacComplete ? ofacTotalCount : null;

  const rdap = bundle?.rdap ?? {};
  const returnedDomain =
    typeof rdap?.domain === 'string'
      ? rdap.domain.trim().toLowerCase().replace(/\.$/, '')
      : null;
  const domainAligned = returnedDomain === input.domain;
  const registrationKnown = typeof rdap?.registered === 'boolean';
  const authoritativeRdap =
    typeof rdap?.authoritativeRdap === 'string' &&
    /^https?:\/\//i.test(rdap.authoritativeRdap)
      ? rdap.authoritativeRdap
      : null;
  const rdapSourceComplete =
    typeof rdap?.source === 'string' && rdap.source.trim().length > 0;
  const rdapComplete =
    domainAligned &&
    registrationKnown &&
    authoritativeRdap != null &&
    rdapSourceComplete;
  const domainRegistered = rdapComplete && rdap.registered === true;
  const nameAligned =
    domainRegistered && domainNameAligned(input.domain, input.name);

  const reviewTriggers = [];
  if (!registryMatch) {
    reviewTriggers.push({
      code: 'pa_registry_match_not_found',
      detail:
        'No Pennsylvania registry candidate was found for the supplied vendor name.',
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
  } else if (!registryComplete) {
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
      detail:
        'The matched Pennsylvania registry record did not provide a usable registered address.',
    });
  } else if (registeredAddress && !registryCensusComplete) {
    reviewTriggers.push({
      code: 'census_registry_evidence_incomplete',
      detail:
        'The Census response for the Pennsylvania registry address did not satisfy the expected evidence contract, so the workflow cannot safely compare the addresses.',
    });
  } else if (registeredAddress && !registryMatched) {
    reviewTriggers.push({
      code: 'registry_address_not_geocoded',
      detail:
        'The Pennsylvania registry address did not produce a Census match.',
    });
  } else if (
    registeredAddress &&
    submittedMatched &&
    registryMatched &&
    !addressConsistent
  ) {
    reviewTriggers.push({
      code: 'registered_address_differs',
      detail:
        'The supplied vendor address does not closely align with the Pennsylvania registry address: Census-normalized street number and ZIP must match and coordinates must fall within the configured distance rule.',
    });
  }

  if (!ofacComplete) {
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

  if (!rdapComplete) {
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
  } else if (!nameAligned) {
    reviewTriggers.push({
      code: 'domain_name_not_aligned',
      detail:
        'The supplied domain is registered, but its hostname does not plausibly align with the submitted vendor name; a human should confirm the relationship before continuing.',
    });
  }

  const decision = reviewTriggers.length === 0 ? 'proceed' : 'human_review';
  const origin = String(options.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');

  return {
    decision,
    agentAction:
      decision === 'proceed'
        ? 'continue_vendor_intake'
        : 'pause_and_request_human_review',
    reviewTriggers,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
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
      addressMaxDistanceMiles: ADDRESS_MAX_MILES,
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
        paidEndpoint: origin + '/_api/pa-entity-one',
        found: Boolean(registryMatch),
        complete: registryComplete,
        candidateCount: registryMatches.length,
        strongCandidateCount,
        ambiguous: registryAmbiguous,
        strongNameMatch: registryStrong,
        matchScore: registryNameScore,
        match: registryMatch,
        source: PA_SOURCE_LABEL,
      },
      address: {
        service: 'US Census Address Geocoder x402',
        paidEndpoint: origin + '/_api/us-address-geocode',
        providedEvidenceComplete: submittedCensusComplete,
        providedInputAligned: submittedInputAligned,
        providedMatched: submittedMatched,
        providedMatchedAddress: submittedCensus?.matchedAddress ?? null,
        registryAddress: registeredAddress,
        registryEvidenceComplete: registryCensusComplete,
        registryInputAligned,
        registryMatched,
        registryMatchedAddress: registryCensus?.matchedAddress ?? null,
        submittedStreetNumber: submittedIdentity.streetNumber,
        registryStreetNumber: registryIdentity.streetNumber,
        sameStreetNumber,
        submittedZip: submittedIdentity.zip,
        registryZip: registryIdentity.zip,
        sameZip,
        distanceMiles: addressDistanceMiles,
        consistent: addressConsistent,
      },
      ofac: {
        service: 'OFAC SDN Name Screen x402',
        paidEndpoint: origin + '/_api/ofac-sdn-screen',
        complete: ofacComplete,
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
        paidEndpoint: origin + '/_api/domain-rdap',
        complete: rdapComplete,
        requestedDomain: input.domain,
        returnedDomain,
        domainAligned,
        registrationKnown,
        registered: domainRegistered,
        nameAligned,
        authoritativeRdap,
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

export async function collectVendorIntakeEvidence(rawInput) {
  const input = normalizeVendorInput(rawInput);
  const registryMatches = await searchPennsylvaniaEntities(input.name, 3);
  const registeredAddress = registryAddress(registryMatches[0] ?? null);
  const [submittedCensus, registryCensus, ofac, rdap] = await Promise.all([
    geocodeAddress(input.address),
    registeredAddress
      ? geocodeAddress(registeredAddress)
      : Promise.resolve(null),
    screenOfacName(input.name, {
      limit: 3,
      minScore: OFAC_REVIEW_THRESHOLD,
    }),
    lookupDomain(input.domain),
  ]);
  return {
    input,
    registryMatches,
    submittedCensus,
    registryCensus,
    ofac,
    rdap,
  };
}

export async function runVendorIntakeGate(rawInput, options = {}) {
  const bundle = await collectVendorIntakeEvidence(rawInput);
  return evaluateVendorIntakeEvidence(bundle, options);
}
