# Floot x402 Portfolio Consolidation Plan

_Last prepared: 2026-10-02_

## Goal

Use the working bare-origin Floot seller:

https://pa-entity-x402.floot.app

as the portfolio discovery front door so Agent402 and similar crawlers can discover the full paid tool set from a valid bare-origin `/.well-known/x402` document.

Do **not** remove or alter the two working Pennsylvania routes.

## Current blocker

The Floot free-plan build-action quota is exhausted until:

**2026-10-02 18:00 UTC = 2:00 PM America/New_York**

Before reset, source reads/writes are refused. Do not repeatedly retry before the reset unless the plan/quota state changes.

## Target paid resources: 8 total

### 1. Pennsylvania best match

- Resource: `https://pa-entity-x402.floot.app/_api/pa-entity-one`
- Price: **$0.001 USDC**
- Existing working route
- Preserve unchanged

### 2. Pennsylvania enriched search

- Resource: `https://pa-entity-x402.floot.app/_api/pa-business`
- Price: **$0.005 USDC**
- Existing working route
- Preserve unchanged

### 3. Pennsylvania vendor-intake decision gate

- Resource: `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate`
- Price: **$0.020 USDC**
- Operation ID: `checkPennsylvaniaVendorIntakeGate`
- Inputs: `name`, `address`, `domain`
- Output: `proceed` or `human_review` with typed review triggers and PA registry/Census/OFAC/RDAP evidence
- Reviewer evidence: `docs/vendor-intake-gate-evidence.md`

### 4. SEC Recent Filings

- Resource: `https://api-v2.appdeploy.ai/app/sec-recent-filings-x402-f9qatj/api/sec-filings`
- Price: **$0.005 USDC**
- Operation ID: `getRecentSecFilings`
- Inputs include ticker or CIK, optional form and limit

### 5. U.S. Census Address Geocoder

- Resource: `https://api-v2.appdeploy.ai/app/us-census-address-geocoder-x402-23mj4x/api/us-address-geocode`
- Price: **$0.005 USDC**
- Operation ID: `geocodeUsAddress`
- Input: `address`

### 6. OFAC SDN Name Screen

- Resource: `https://api-v2.appdeploy.ai/app/ofac-sdn-name-screen-x402-m9ko96/api/ofac-sdn-screen`
- Price: **$0.005 USDC**
- Operation ID: `screenOfacSdnName`
- Inputs include `name`, optional `limit`, optional `minScore`
- Candidate-name review only; no sanctions-clearance claim

### 7. Domain RDAP Lookup

- Resource: `https://api-v2.appdeploy.ai/app/domain-rdap-lookup-x402-spdfnq/api/domain-rdap`
- Price: **$0.005 USDC**
- Operation ID: `lookupDomainRdap`
- Input: `domain`

### 8. Treasury Average Interest Rates

- Resource: `https://api-v2.appdeploy.ai/app/treasury-average-interest-rates-x402-xeqftl/api/treasury-average-rates`
- Price: **$0.005 USDC**
- Operation ID: `getTreasuryAverageInterestRates`
- Optional security-class filtering

## Shared payment terms

For the AppDeploy seller endpoints:

- x402 version: 2
- network: Base mainnet (`eip155:8453`)
- asset: Base USDC
- USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- payout wallet: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- facilitator: `https://facilitator.payai.network`

Do not manufacture settlement history. Do not self-pay or seller-fund probes.

## First action after quota reset

1. Call Floot `list_files` for project:
   `b69a3ee6-eb01-430d-aa51-da2fc7beeac4`
2. Read the Floot overview/publishing guides if required by the connector.
3. Read the current files that implement:
   - `/.well-known/x402`
   - `openapi.json`
   - `llms.txt`
   - `llms-full.txt`
   - `skill.txt`
4. Preserve the two working PA routes exactly.
5. Add the six AppDeploy resources above so the manifest advertises **8 paid resources total**.
6. Update OpenAPI/LLM/skill discovery consistently.
7. Typecheck/tests if the project has relevant specs.
8. Publish once to the existing subdomain:
   `pa-entity-x402.floot.app`

## External acceptance sequence

After publish:

### A. Bare-origin manifest

Fetch:

`https://pa-entity-x402.floot.app/.well-known/x402`

Acceptance:

- HTTP 200
- valid JSON
- x402Version 2
- **8 resources**
- both existing Floot PA routes still present
- vendor-intake gate present at $0.020
- SEC/Census/OFAC/RDAP/Treasury present at $0.005

### B. Other discovery files

Confirm:

- `/openapi.json`
- `/llms.txt`
- `/llms-full.txt`
- `/skill.txt`
- `/robots.txt`
- `/sitemap.xml`

remain valid and describe the expanded portfolio.

### C. Zero-spend portfolio verification

Run the manual GitHub workflow `Verify x402 portfolio` with:

`expected_floot_resources = 8`

Acceptance:

- all 8 paid routes pass unpaid HTTP 402 challenge validation,
- all three vendor-gate decision fixtures pass,
- Floot manifest reports 8 resources,
- AppDeploy PA manifest remains healthy,
- `x402-verification-report.json` is uploaded as the workflow artifact.

Runbook: `docs/x402-zero-spend-verification.md`

### D. Agent402 re-registration

POST the Floot origin to Agent402 registration:

`https://pa-entity-x402.floot.app`

Acceptance:

- `listed=true`
- `routable=true`
- `health=1`
- documents reread
- routes rechecked/probed
- the vendor-intake resource is visible
- target paid-tool/resource count reflects the expanded manifest

**Important:** do not declare portfolio consolidation complete merely because Floot serves eight manifest entries. Agent402 must actually accept/index the external absolute resource URLs.

### E. External-resource same-origin fallback

If Agent402 ignores or rejects external AppDeploy resource URLs because they are not on the Floot host:

1. Keep the valid expanded documentation.
2. Add same-origin Floot proxy endpoints one at a time.
3. Each proxy must preserve:
   - query parameters
   - `payment-signature` / `x-payment` request headers
   - upstream HTTP status
   - `PAYMENT-REQUIRED`
   - `PAYMENT-RESPONSE`
   - `x402-*` headers
   - JSON response body
4. Point the Floot manifest at those same-origin proxy routes.
5. Re-probe before proceeding to the next route.

Do not build proxies unless the direct absolute-resource manifest fails the Agent402 acceptance check.

## Step 2 completion rule

Step 2 ("solve bare-origin discovery") is complete only when:

- the Floot bare origin serves the consolidated portfolio manifest,
- the existing PA routes remain healthy,
- Agent402 or an equivalent independent crawler actually reads the consolidated origin and recognizes the expanded paid resources,
- no self-funded settlement is used to manufacture routability history.

## Next external action after Step 2

Only after the composed vendor-intake gate is visible through the working bare-origin discovery path:

1. capture the new Agent402 evidence,
2. update reviewer documentation,
3. resubmit the composed gate to Agentic.ai,
4. continue Step 3 buyer-style verification.

Do not resubmit Agentic.ai before this evidence exists.
