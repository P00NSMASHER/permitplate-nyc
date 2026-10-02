import assert from 'node:assert/strict';
import { evaluateVendorIntakeEvidence } from '../recovery/vendor-intake-core.mjs';

const SOURCE = 'U.S. Census Bureau Geocoding Services';
const RDAP_SOURCE = 'Authoritative RDAP server discovered via IANA bootstrap';
const OFAC_SOURCE =
  'U.S. Treasury OFAC Specially Designated Nationals (SDN) List';

function baseBundle() {
  const input = {
    name: 'OpenAI OpCo',
    address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
    domain: 'openai.com',
  };
  const match = {
    businessName: 'OpenAI OpCo, LLC',
    filingNumber: '0014879623',
    registrationType: 'Foreign Limited Liability Company',
    creationDate: '2025-01-01',
    address1: '600 North Second Street',
    address2: 'Suite 401',
    city: 'Harrisburg',
    state: 'PA',
    zip: '17101',
    county: 'Dauphin',
    countyCode: '22',
    principals: [],
  };
  const registryAddress =
    '600 North Second Street, Suite 401, Harrisburg, PA, 17101';
  return {
    input,
    registryMatches: [match],
    submittedCensus: {
      input: input.address,
      matched: true,
      matchedAddress: '600 NORTH SECOND STREET, HARRISBURG, PA, 17101',
      coordinates: { latitude: 40.2601, longitude: -76.8838 },
      source: SOURCE,
    },
    registryCensus: {
      input: registryAddress,
      matched: true,
      matchedAddress: '600 NORTH SECOND STREET, HARRISBURG, PA, 17101',
      coordinates: { latitude: 40.2601, longitude: -76.8838 },
      source: SOURCE,
    },
    ofac: {
      query: input.name,
      minScore: 90,
      count: 0,
      totalCandidatesAboveThreshold: 0,
      candidates: [],
      source: OFAC_SOURCE,
      reviewRequired: true,
    },
    rdap: {
      domain: input.domain,
      registered: true,
      authoritativeRdap: 'https://rdap.verisign.com/com/v1/',
      registrar: { name: 'Registrar', handle: '1' },
      events: {},
      source: RDAP_SOURCE,
    },
  };
}

function clone(value) {
  return structuredClone(value);
}

function codes(result) {
  return result.reviewTriggers.map((item) => item.code);
}

const cases = [];

{
  const result = evaluateVendorIntakeEvidence(baseBundle(), {
    checkedAt: '2026-10-02T00:00:00.000Z',
  });
  assert.equal(result.decision, 'proceed');
  assert.equal(result.agentAction, 'continue_vendor_intake');
  assert.deepEqual(codes(result), []);
  assert.equal(result.evidence.registry.complete, true);
  assert.equal(result.evidence.address.consistent, true);
  assert.equal(result.evidence.ofac.complete, true);
  assert.equal(result.evidence.domain.complete, true);
  cases.push('proceed');
}

{
  const bundle = baseBundle();
  const duplicate = clone(bundle.registryMatches[0]);
  duplicate.filingNumber = '0099999999';
  duplicate.businessName = 'OpenAI OpCo, Inc.';
  bundle.registryMatches.push(duplicate);
  const result = evaluateVendorIntakeEvidence(bundle);
  assert.equal(result.decision, 'human_review');
  assert(codes(result).includes('pa_registry_name_ambiguous'));
  cases.push('registry ambiguity');
}

{
  const bundle = baseBundle();
  bundle.registryMatches[0].filingNumber = null;
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('pa_registry_evidence_incomplete'));
  cases.push('registry incomplete');
}

{
  const bundle = baseBundle();
  bundle.submittedCensus.matchedAddress =
    '601 NORTH SECOND STREET, HARRISBURG, PA, 17101';
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('registered_address_differs'));
  cases.push('address mismatch');
}

{
  const bundle = baseBundle();
  bundle.submittedCensus.coordinates = null;
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('census_provided_evidence_incomplete'));
  cases.push('census incomplete');
}

{
  const bundle = baseBundle();
  bundle.ofac.count = 1;
  bundle.ofac.totalCandidatesAboveThreshold = 1;
  bundle.ofac.candidates = [{ primaryName: 'OPENAI OPCO', score: 95 }];
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('ofac_name_candidate_present'));
  cases.push('ofac candidate');
}

{
  const bundle = baseBundle();
  delete bundle.rdap.authoritativeRdap;
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('rdap_evidence_incomplete'));
  cases.push('rdap incomplete');
}

{
  const bundle = baseBundle();
  bundle.input.domain = 'example.com';
  bundle.rdap.domain = 'example.com';
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('domain_name_not_aligned'));
  cases.push('domain mismatch');
}

{
  const bundle = baseBundle();
  bundle.rdap.registered = false;
  const result = evaluateVendorIntakeEvidence(bundle);
  assert(codes(result).includes('domain_registration_not_confirmed'));
  cases.push('domain unregistered');
}

console.log(
  `PASS ${cases.length}/${cases.length} vendor-intake decision cases`
);
for (const name of cases) console.log('  - ' + name);
