import {
  geocodeAddress,
  lookupDomain,
  screenOfacName,
  lookupSecFilings,
  latestTreasuryRates,
  searchPennsylvaniaEntities,
  runVendorGateFixture,
} from '../recovery/x402-rehost-core.mjs';

const checks = [];

async function run(name, fn, validate) {
  const started = Date.now();
  try {
    const value = await fn();
    const ok = validate(value);
    checks.push({ name, ok, latencyMs: Date.now() - started, value });
    console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(value).slice(0, 500));
  } catch (error) {
    checks.push({
      name,
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause ? JSON.stringify(error.cause) : '';
    console.log('FAIL ' + name + ' ' + message + (cause ? ' cause=' + cause : ''));
  }
}

await run(
  'Census',
  () => geocodeAddress('4600 Silver Hill Rd, Washington, DC 20233'),
  (v) =>
    v?.matched === true &&
    typeof v?.matchedAddress === 'string' &&
    Number.isFinite(v?.coordinates?.latitude) &&
    Number.isFinite(v?.coordinates?.longitude)
);

await run(
  'RDAP',
  () => lookupDomain('example.com'),
  (v) =>
    v?.domain === 'example.com' &&
    v?.registered === true &&
    typeof v?.authoritativeRdap === 'string'
);

await run(
  'OFAC',
  () => screenOfacName('VLADIMIR PUTIN', { limit: 3, minScore: 90 }),
  (v) =>
    v?.query === 'VLADIMIR PUTIN' &&
    v?.minScore === 90 &&
    Number.isInteger(v?.totalCandidatesAboveThreshold) &&
    Array.isArray(v?.candidates) &&
    v.candidates.length >= 1
);

await run(
  'SEC',
  () => lookupSecFilings({ ticker: 'AAPL', form: '10-K', limit: 1 }),
  (v) =>
    v?.company?.cik === '0000320193' &&
    Array.isArray(v?.filings) &&
    v.filings.length === 1 &&
    v.filings[0]?.form === '10-K'
);

await run(
  'Treasury',
  () => latestTreasuryRates('Total Marketable'),
  (v) =>
    typeof v?.recordDate === 'string' &&
    v.recordDate.length === 10 &&
    Array.isArray(v?.rates) &&
    v.rates.length >= 1
);

await run(
  'PA registry',
  () => searchPennsylvaniaEntities('OpenAI OpCo', 1),
  (v) =>
    Array.isArray(v?.results) &&
    v.results.length >= 1 &&
    v.results[0]?.businessName != null &&
    v.results[0]?.filingNumber != null
);

await run(
  'Vendor gate proceed',
  () => runVendorGateFixture('proceed'),
  (v) =>
    v?.decision === 'proceed' &&
    v?.agentAction === 'continue_vendor_intake' &&
    Array.isArray(v?.reviewTriggers) &&
    v.reviewTriggers.length === 0 &&
    v?.evidence?.registry?.complete === true &&
    v?.evidence?.address?.providedEvidenceComplete === true &&
    v?.evidence?.address?.registryEvidenceComplete === true &&
    v?.evidence?.ofac?.complete === true &&
    v?.evidence?.domain?.complete === true
);

await run(
  'Vendor gate address review',
  () => runVendorGateFixture('address_mismatch'),
  (v) =>
    v?.decision === 'human_review' &&
    v?.agentAction === 'pause_and_request_human_review' &&
    v?.reviewTriggers?.some((trigger) => trigger?.code === 'registered_address_differs')
);

await run(
  'Vendor gate domain review',
  () => runVendorGateFixture('domain_mismatch'),
  (v) =>
    v?.decision === 'human_review' &&
    v?.agentAction === 'pause_and_request_human_review' &&
    v?.reviewTriggers?.some((trigger) => trigger?.code === 'domain_name_not_aligned')
);

const passed = checks.filter((x) => x.ok).length;
console.log('\nSUMMARY ' + passed + '/' + checks.length + ' passed');
if (passed !== checks.length) process.exitCode = 1;
