# Floot Rehost Implementation Map

_Last prepared: 2026-10-02 after AppDeploy incident #38._

## Objective

If AppDeploy still returns `APP_TEMPORARILY_UNAVAILABLE` after the Floot build-action quota resets, rehost the dead x402 implementations directly inside the existing working Floot seller:

https://pa-entity-x402.floot.app

Do not create six independent replacement apps.

The most action-efficient layout is:

1. preserve the two existing PA Floot endpoints,
2. add shared helper logic for Census, OFAC, and RDAP,
3. add the $0.020 vendor gate in the same app and call those helpers directly,
4. expose Census/OFAC/RDAP as their own $0.005 paid routes using the same helpers,
5. add SEC and Treasury as two more $0.005 routes,
6. publish one origin with eight paid resources.

This removes AppDeploy from the runtime dependency graph.

## Prepared code assets

Use these as the migration source of truth rather than re-copying AppDeploy code by hand:

- `recovery/x402-rehost-core.mjs` — Census, OFAC, RDAP, SEC, Treasury public-data logic
- `recovery/vendor-intake-gate-core.mjs` — authoritative fail-closed decision engine with injectable PA registry search
- `recovery/pa-registry-rehost-core.mjs` — standalone PA registry search/ranking helper for smoke/rehost use
- `recovery/floot-target-manifest.json` — exact eight-resource same-origin target
- `scripts/test-x402-rehost-core.mjs` — official-upstream smoke
- `scripts/test-vendor-intake-gate-core.mjs` — decision/core regression suite
- `scripts/test-vendor-intake-live-core.mjs` — live composed-gate smoke without AppDeploy
- `scripts/validate-floot-target-manifest.mjs` — target-manifest invariant test
- `scripts/compare-floot-manifest-to-target.mjs` — live Floot-vs-target comparator

The gate core intentionally takes a `searchRegistry` callback so the Floot implementation can reuse its already-proven PA registry code instead of maintaining a second registry implementation.

## Shared x402 terms

Reuse the existing Floot payment machinery already proven on the PA routes.

- protocol: x402 v2
- scheme: exact
- network: `eip155:8453`
- asset: Base USDC
- USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- payout wallet: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- facilitator: `https://facilitator.payai.network`

Prices:

- PA best match: 1,000 atomic = $0.001
- every raw non-PA route: 5,000 atomic = $0.005
- vendor-intake gate: 20,000 atomic = $0.020

Do not self-pay and do not manufacture settlement history.

## Phase 1 — shared decision stack

Implement these together because the vendor gate depends on all three.

### Census helper

AppDeploy source version used as reference:

`1790900108067`

Public upstream:

`https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress`

Request parameters:

- `address`
- `benchmark=Public_AR_Current`
- `vintage=Current_Current`
- `format=json`

Core behavior:

- read first `result.addressMatches[0]`,
- return `matched=false` with null address/coordinates/geographies when none,
- otherwise return normalized `matchedAddress`,
- longitude from `coordinates.x`,
- latitude from `coordinates.y`,
- extract States, Counties, Census Tracts, Census Blocks, Congressional Districts,
- preserve official-source label: `U.S. Census Bureau Geocoding Services`.

Validation:

- address length 6–240.

Portable status:

**Pure global-fetch logic. No AppDeploy-specific persistence or secrets.**

### RDAP helper

AppDeploy source version used as reference:

`1790878810567`

IANA bootstrap:

`https://data.iana.org/rdap/dns.json`

Behavior:

- cache bootstrap data for 1 hour,
- derive TLD from normalized domain,
- locate first authoritative RDAP base for that TLD,
- query `<base>/domain/<domain>`,
- authoritative 404 => `registered=false`,
- successful response => `registered=true`,
- extract registrar from entity with role `registrar`,
- extract events, nameservers, status and DNSSEC delegation state,
- return `authoritativeRdap`,
- source label: `Authoritative RDAP server discovered via IANA bootstrap`.

Validation:

- ASCII/punycode domain,
- 3–253 chars,
- valid dot-separated labels,
- no empty/leading-hyphen/trailing-hyphen labels.

Portable status:

**Pure global-fetch logic plus an in-memory one-hour cache. No secret.**

### OFAC helper

AppDeploy source version used as reference:

`1790878994736`

Public base:

`https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports`

Files:

- `SDN.CSV`
- `ALT.CSV`

Behavior:

- fetch both CSV files,
- parse CSV locally,
- build primary SDN entries keyed by UID,
- attach alternate names from ALT.CSV,
- cache parsed entries for 10 minutes,
- normalize names with Unicode NFKD + diacritic removal + uppercase token cleanup,
- score using:
  - exact = 100,
  - token-order exact = 99,
  - contained long names = 94,
  - Levenshtein similarity,
  - sorted-token Levenshtein,
  - Jaccard token overlap,
- keep candidates at/above `minScore`,
- rank descending,
- return total-above-threshold plus capped candidate array.

Default/validation:

- name 2–160 chars,
- default limit 5, clamp 1–10,
- default minScore 85, clamp 70–100,
- vendor gate uses threshold 90 and limit 3.

Required limitation language:

- candidate-name screening only,
- a match is not a legal determination,
- a no-match is not sanctions clearance,
- no OFAC 50 Percent Rule ownership analysis.

Portable status:

**Pure global-fetch + local CSV parsing + 10-minute memory cache. No secret.**

## Phase 2 — Pennsylvania Vendor Intake Gate

Reference AppDeploy source version:

`1790932374587`

Target same-origin route:

`/_api/vendor-intake-gate`

Price:

**$0.020**

Inputs:

- `name`
- `address`
- `domain`

Do **not** call the replacement Census/OFAC/RDAP paid HTTP endpoints from the gate.

Instead call the shared helper functions directly so one outer $0.020 purchase does not generate nested seller-funded payments.

### PA registry decision rules

Reuse the current Floot PA registry source/query path.

Automatic continuation requires:

- exactly one strong legal-entity candidate,
- strong canonical exact/prefix name match,
- business name present,
- filing number present,
- registration type present,
- usable registered address present.

Review triggers:

- `pa_registry_match_not_found`
- `pa_registry_name_ambiguous`
- `pa_registry_name_needs_review`
- `pa_registry_evidence_incomplete`

### Census decision rules

Both submitted-address and registry-address responses must:

- echo the expected input,
- identify the Census source,
- expose boolean `matched`,
- when matched, include nonempty normalized address and numeric coordinates.

Automatic continuation additionally requires:

- same Census-normalized primary street number,
- same ZIP,
- coordinate distance <= 0.25 miles.

Review triggers:

- `census_provided_evidence_incomplete`
- `provided_address_not_geocoded`
- `registry_address_missing`
- `census_registry_evidence_incomplete`
- `registry_address_not_geocoded`
- `registered_address_differs`

### OFAC decision rules

Evidence contract must include:

- query aligned with submitted vendor name,
- threshold exactly 90,
- valid returned count,
- valid total count,
- candidates array count consistency,
- source,
- `reviewRequired=true`.

Review triggers:

- `ofac_evidence_incomplete`
- `ofac_name_candidate_present`

### RDAP decision rules

Evidence contract must include:

- returned domain equals requested domain,
- boolean registration result,
- authoritative RDAP URL,
- source.

For automatic continuation:

- domain must be registered,
- hostname must plausibly align with vendor name.

Review triggers:

- `rdap_evidence_incomplete`
- `domain_registration_not_confirmed`
- `domain_name_not_aligned`

### Output

Preserve:

- `decision`
- `agentAction`
- typed `reviewTriggers`
- `checkedAt`
- normalized input
- policy
- structured registry evidence
- structured address evidence
- structured OFAC evidence
- structured domain evidence
- limitations
- paid/price fields on paid response

### Fixed reviewer fixtures

Expose exactly three fixed cases, not arbitrary free gate execution:

- `proceed`
- `address_mismatch`
- `domain_mismatch`

## Phase 3 — standalone Census / OFAC / RDAP routes

Reuse the same helpers from Phase 1.

Suggested same-origin routes:

- `/_api/us-address-geocode`
- `/_api/ofac-sdn-screen`
- `/_api/domain-rdap`

Each costs **$0.005**.

This means the vendor gate and the standalone products share one implementation per evidence family instead of duplicating code.

## Phase 4 — SEC Recent Filings

Reference AppDeploy source version:

`1790932377946`

Suggested route:

`/_api/sec-filings`

Price:

**$0.005**

Public upstreams:

- ticker map: `https://www.sec.gov/files/company_tickers.json`
- submissions: `https://data.sec.gov/submissions/CIK<10-digit-cik>.json`

Core behavior:

- accept ticker or CIK,
- normalize CIK to 10 digits,
- resolve ticker through SEC ticker map when needed,
- optional exact form filter,
- limit 1–25,
- return company identity + recent filing metadata,
- construct direct filing URL from CIK/accession/primary document.

Required source label:

`U.S. Securities and Exchange Commission EDGAR`

Portable status:

**Pure global-fetch logic. Requires a respectful SEC User-Agent but no secret.**

## Phase 5 — Treasury Average Interest Rates

Reference AppDeploy source version:

`1790899700286`

Suggested route:

`/_api/treasury-average-rates`

Price:

**$0.005**

Public upstream:

`https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates`

Query:

- fields:
  `record_date,security_type_desc,security_desc,avg_interest_rate_amt`
- sort: `-record_date`
- page size: 100

Behavior:

- take latest record date,
- optionally filter `security_desc` case-insensitively,
- return description/type/average interest rate,
- frequency = monthly.

Validation:

- optional security filter <= 100 chars.

Portable status:

**Pure global-fetch logic. No secret.**

## Recommended Floot file layout

Determine the exact current Floot conventions with `list_files` after quota reset, but prefer a shared-helper structure such as:

- helper: x402 payment/challenge/verify/settle
- helper: PA registry
- helper: Census
- helper: OFAC
- helper: RDAP
- endpoint: existing PA best match
- endpoint: existing PA enriched search
- endpoint: vendor intake gate
- endpoint: Census
- endpoint: OFAC
- endpoint: RDAP
- endpoint: SEC
- endpoint: Treasury

Do not duplicate the same data implementation across the gate and standalone endpoints.

## Migration order at quota reset

1. Read current Floot file tree and endpoint conventions.
2. Preserve both proven PA routes.
3. Reuse/extract Floot's existing x402 payment helper.
4. Add Census + RDAP helpers first.
5. Add OFAC helper/cache.
6. Add vendor gate + three fixed fixtures.
7. Verify vendor gate paid 402 challenge and free fixtures externally.
8. Add standalone Census/OFAC/RDAP endpoints using the same helpers.
9. Add SEC.
10. Add Treasury.
11. Update one consolidated `/.well-known/x402`, OpenAPI, llms, skill, robots and sitemap.
12. Publish once when typecheck/tests are green.
13. Run the zero-spend buyer verifier with the actual manifest count.
14. Re-register Floot with Agent402.
15. Do not call Step 2 complete until all 8 target routes are healthy and recognized.

## Why this is preferable to proxying

During incident #38, the AppDeploy shared API edge returns `APP_TEMPORARILY_UNAVAILABLE` before seller code executes.

A Floot proxy to those URLs would only relay the outage.

A true rehost:

- removes the failed host from the runtime path,
- keeps one working bare origin,
- reduces marketplace/domain-verification friction,
- lets the vendor gate call component logic internally,
- preserves the same public authoritative data sources,
- needs no new secrets,
- keeps default spend at $0.
