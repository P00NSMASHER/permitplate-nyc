import {
  geocodeAddress,
  lookupDomain,
  screenOfacName,
} from './x402-rehost-core.mjs';

export const OFAC_REVIEW_THRESHOLD = 90;
export const VENDOR_GATE_ADDRESS_MAX_MILES = 0.25;

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
  if (!candidate || !wanted) return 4;
  if (candidate === wanted) return 0;
  if (candidate.startsWith(`${wanted} `)) return 1;
  if (` ${candidate} `.includes(` ${wanted} `)) return 2;
  if (candidate.replaceAll(' ', '').includes(wanted.replaceAll(' ', ''))) return 3;
  return 4;
}

function registryAddress(entity) {
  const parts = [
    entity?.address1,
    entity?.address2,
    entity?.city,
    entity?.state,
    entity?.zip,
  ].filter((value) => typeof value === 'string' && value.trim());
  return parts.length ? parts.join(', ') : null;
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function censusCoordinates(payload) {
  const coordinates =
    payload?.coordinates && typeof payload.coordinates === 'object'
      ? payload.coordinates
      : null;
  if (!coordinates) return null;
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

export function domainNameAligned(domain, vendorName) {
  const vendorCanonical = canonicalBusinessName(vendorName);
  const vendorCompact = vendorCanonical.replace(/[^A-Z0-9]/g, '').toLowerCase();
  const vendorTokens = vendorCanonical
    .toLowerCase()
    .split(' ')
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3);
  const ignored = new Set(['www', 'api', 'app', 'portal', 'secure', 'vendor', 'vendors']);
  const hostTokens = String(domain ?? '')
    .toLowerCase()
    .replace(/\.$/, '')
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

function normalizeAddressInput(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function evaluateVendorIntakeEvidence({
  input,
  registryMatches,
  submittedCensus,
  registryCensus,
  ofac,
  rdap,
}) {
  const registryMatch = registryMatches?.[0] ?? null;
  const registryNameScore =
    registryMatch?.businessName != null
      ? matchScore(registryMatch.businessName, input.name)
      : null;
  const registryStrongCandidates = (registryMatches ?? []).filter((candidate) =>
    candidate?.businessName != null
      ? matchScore(candidate.businessName, input.name) <= 1
      : false
  );
  const registryStrongCandidateCount = registryStrongCandidates.length;
  const registryAmbiguous = registryStrongCandidateCount > 1;
  const registryStrong =
    registryNameScore != null &&
    registryNameScore <= 1 &&
    !registryAmbiguous;
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

  const submittedCoordinates = censusCoordinates(submittedCensus);
  const registryCoordinates = censusCoordinates(registryCensus);
  const submittedInputAligned =
    typeof submittedCensus?.input === 'string' &&
    normalizeAddressInput(submittedCensus.input) === normalizeAddressInput(input.address);
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
  const registryAddressMatched = registryCensus?.matched === true;
  const submittedAddressIdentity = censusAddressIdentity(submittedCensus?.matchedAddress);
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
    ofac?.reviewRequired === true;
  const ofacCandidateCount = ofacEvidenceComplete ? ofacTotalCount : null;

  const requestedDomain = String(input.domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const rdapReturnedDomain =
    typeof rdap?.domain === 'string'
      ? rdap.domain.trim().toLowerCase().replace(/\.$/, '')
      : null;
  const rdapDomainAligned = rdapReturnedDomain === requestedDomain;
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
    domainRegistered && domainNameAligned(requestedDomain, input.name);

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
      detail:
        'The matched Pennsylvania registry record did not provide a usable registered address.',
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
    input: {
      name: String(input.name ?? '').trim(),
      address: String(input.address ?? '').trim().replace(/\s+/g, ' '),
      domain: requestedDomain,
    },
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
        found: Boolean(registryMatch),
        complete: registryEvidenceComplete,
        candidateCount: registryMatches?.length ?? 0,
        strongCandidateCount: registryStrongCandidateCount,
        ambiguous: registryAmbiguous,
        strongNameMatch: registryStrong,
        matchScore: registryNameScore,
        match: registryMatch,
      },
      address: {
        providedEvidenceComplete: submittedCensusComplete,
        providedInputAligned: submittedInputAligned,
        providedMatched: submittedMatched,
        providedMatchedAddress: submittedCensus?.matchedAddress ?? null,
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
        complete: rdapEvidenceComplete,
        requestedDomain,
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

export async function runVendorIntakeGateCore(input, options) {
  if (!options || typeof options.searchRegistry !== 'function') {
    throw new Error('searchRegistry callback is required');
  }

  const normalizedInput = {
    name: String(input?.name ?? '').trim(),
    address: String(input?.address ?? '').trim().replace(/\s+/g, ' '),
    domain: String(input?.domain ?? '').trim().toLowerCase().replace(/\.$/, ''),
  };
  if (normalizedInput.name.length < 2 || normalizedInput.name.length > 120) {
    throw new Error('invalid_name');
  }
  if (normalizedInput.address.length < 6 || normalizedInput.address.length > 240) {
    throw new Error('invalid_address');
  }

  const registryMatches = await options.searchRegistry(normalizedInput.name, 3);
  const registryMatch = registryMatches?.[0] ?? null;
  const registeredAddress = registryMatch ? registryAddress(registryMatch) : null;

  const geocode = options.geocodeAddress ?? geocodeAddress;
  const screenOfac = options.screenOfacName ?? screenOfacName;
  const lookupRdap = options.lookupDomain ?? lookupDomain;

  const submittedPromise = geocode(normalizedInput.address);
  const registryPromise = registeredAddress
    ? geocode(registeredAddress)
    : Promise.resolve(null);
  const ofacPromise = screenOfac(normalizedInput.name, {
    limit: 3,
    minScore: OFAC_REVIEW_THRESHOLD,
  });
  const rdapPromise = lookupRdap(normalizedInput.domain);

  const [submittedCensus, registryCensus, ofac, rdap] = await Promise.all([
    submittedPromise,
    registryPromise,
    ofacPromise,
    rdapPromise,
  ]);

  return evaluateVendorIntakeEvidence({
    input: normalizedInput,
    registryMatches,
    submittedCensus,
    registryCensus,
    ofac,
    rdap,
  });
}
