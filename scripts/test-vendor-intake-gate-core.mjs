import {
  evaluateVendorIntakeEvidence,
  runVendorIntakeGateCore,
  matchScore,
  domainNameAligned,
} from '../recovery/vendor-intake-gate-core.mjs';

const registryCandidate = {
  businessName: 'OpenAI OpCo, LLC',
  filingNumber: '0014879623',
  registrationType: 'Foreign Limited Liability Company',
  creationDate: null,
  address1: '600 North Second Street, Suite 401',
  address2: null,
  city: 'Harrisburg',
  state: 'PA',
  zip: '17101',
  county: 'Dauphin',
  countyCode: '22',
  principals: [],
};

const searchRegistry = async () => [registryCandidate];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeCensus(input, matchedAddress, lat, lon) {
  return {
    input,
    matched: true,
    matchedAddress,
    coordinates: { latitude: lat, longitude: lon },
    source: 'U.S. Census Bureau Geocoding Services',
  };
}

function makeOfac(query) {
  return {
    query,
    minScore: 90,
    count: 0,
    totalCandidatesAboveThreshold: 0,
    candidates: [],
    source: 'U.S. Treasury OFAC Specially Designated Nationals (SDN) List',
    reviewRequired: true,
  };
}

function makeRdap(domain) {
  return {
    domain,
    registered: true,
    authoritativeRdap: 'https://rdap.example.test/',
    source: 'Authoritative RDAP server discovered via IANA bootstrap',
    registrar: null,
    events: {},
  };
}

const checks = [];
async function run(name, fn) {
  const started = Date.now();
  try {
    await fn();
    checks.push({ name, ok: true, latencyMs: Date.now() - started });
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({
      name,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(
      'FAIL ' + name + ' ' + (error instanceof Error ? error.message : String(error))
    );
  }
}

await run('canonical legal-suffix matching', async () => {
  assert(matchScore('OpenAI OpCo, LLC', 'OpenAI OpCo') === 0, 'expected exact canonical match');
  assert(matchScore('OpenAI OpCo Holdings LLC', 'OpenAI OpCo') === 1, 'expected strong prefix');
});

await run('domain/vendor alignment heuristic', async () => {
  assert(domainNameAligned('openai.com', 'OpenAI OpCo') === true, 'openai.com should align');
  assert(domainNameAligned('example.com', 'OpenAI OpCo') === false, 'example.com should not align');
});

await run('synthetic proceed decision', async () => {
  const input = {
    name: 'OpenAI OpCo',
    address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
    domain: 'openai.com',
  };
  const result = evaluateVendorIntakeEvidence({
    input,
    registryMatches: [registryCandidate],
    submittedCensus: makeCensus(
      input.address,
      '600 NORTH SECOND ST, HARRISBURG, PA, 17101',
      40.2601,
      -76.8839
    ),
    registryCensus: makeCensus(
      '600 North Second Street, Suite 401, Harrisburg, PA, 17101',
      '600 NORTH SECOND ST, HARRISBURG, PA, 17101',
      40.2601,
      -76.8839
    ),
    ofac: makeOfac(input.name),
    rdap: makeRdap(input.domain),
  });
  assert(result.decision === 'proceed', 'expected proceed');
  assert(result.reviewTriggers.length === 0, 'expected zero triggers');
  assert(result.evidence.registry.complete === true, 'registry evidence incomplete');
  assert(result.evidence.address.consistent === true, 'address evidence inconsistent');
  assert(result.evidence.ofac.complete === true, 'OFAC evidence incomplete');
  assert(result.evidence.domain.complete === true, 'RDAP evidence incomplete');
});

await run('synthetic registry ambiguity fails closed', async () => {
  const input = {
    name: 'Acme',
    address: '100 Main St, Harrisburg, PA 17101',
    domain: 'acme.com',
  };
  const candidateA = {
    ...registryCandidate,
    businessName: 'Acme LLC',
    filingNumber: 'A1',
    address1: '100 Main St',
  };
  const candidateB = {
    ...registryCandidate,
    businessName: 'Acme Inc.',
    filingNumber: 'A2',
    address1: '100 Main St',
  };
  const census = makeCensus(
    input.address,
    '100 MAIN ST, HARRISBURG, PA, 17101',
    40.0,
    -76.0
  );
  const result = evaluateVendorIntakeEvidence({
    input,
    registryMatches: [candidateA, candidateB],
    submittedCensus: census,
    registryCensus: census,
    ofac: makeOfac(input.name),
    rdap: makeRdap(input.domain),
  });
  assert(result.decision === 'human_review', 'ambiguous registry should review');
  assert(
    result.reviewTriggers.some((trigger) => trigger.code === 'pa_registry_name_ambiguous'),
    'missing ambiguity trigger'
  );
});

await run('synthetic incomplete registry fails closed', async () => {
  const input = {
    name: 'Acme',
    address: '100 Main St, Harrisburg, PA 17101',
    domain: 'acme.com',
  };
  const incomplete = {
    ...registryCandidate,
    businessName: 'Acme LLC',
    filingNumber: null,
    address1: '100 Main St',
  };
  const census = makeCensus(
    input.address,
    '100 MAIN ST, HARRISBURG, PA, 17101',
    40.0,
    -76.0
  );
  const result = evaluateVendorIntakeEvidence({
    input,
    registryMatches: [incomplete],
    submittedCensus: census,
    registryCensus: census,
    ofac: makeOfac(input.name),
    rdap: makeRdap(input.domain),
  });
  assert(result.decision === 'human_review', 'incomplete registry should review');
  assert(
    result.reviewTriggers.some((trigger) => trigger.code === 'pa_registry_evidence_incomplete'),
    'missing incomplete-registry trigger'
  );
});

await run('live proceed fixture through rehost core', async () => {
  const result = await runVendorIntakeGateCore(
    {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'openai.com',
    },
    { searchRegistry }
  );
  assert(result.decision === 'proceed', 'live proceed fixture did not proceed');
  assert(result.reviewTriggers.length === 0, 'live proceed fixture has review triggers');
});

await run('live address mismatch fixture through rehost core', async () => {
  const result = await runVendorIntakeGateCore(
    {
      name: 'OpenAI OpCo',
      address: '4600 Silver Hill Rd, Washington, DC 20233',
      domain: 'openai.com',
    },
    { searchRegistry }
  );
  assert(result.decision === 'human_review', 'address mismatch should review');
  assert(
    result.reviewTriggers.some((trigger) => trigger.code === 'registered_address_differs'),
    'missing registered_address_differs'
  );
});

await run('live domain mismatch fixture through rehost core', async () => {
  const result = await runVendorIntakeGateCore(
    {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'example.com',
    },
    { searchRegistry }
  );
  assert(result.decision === 'human_review', 'domain mismatch should review');
  assert(
    result.reviewTriggers.some((trigger) => trigger.code === 'domain_name_not_aligned'),
    'missing domain_name_not_aligned'
  );
});

const passed = checks.filter((check) => check.ok).length;
console.log('\nSUMMARY ' + passed + '/' + checks.length + ' passed');
if (passed !== checks.length) process.exitCode = 1;
