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

## Availability gate added after AppDeploy edge regression

A zero-spend marketplace refresh on 2026-10-02 observed the AppDeploy vendor-gate API returning HTTP 402 with platform body `APP_TEMPORARILY_UNAVAILABLE` and **no** `PAYMENT-REQUIRED` header, even though AppDeploy's control plane still reported the deployment as ready.

Therefore the consolidation rule is now stricter:

1. **Before adding any AppDeploy resource to the Floot manifest, probe that exact paid URL from an independent cloud runner.**
2. Require the expected unpaid x402 challenge: HTTP 402, decodable `PAYMENT-REQUIRED`, x402 v2, correct amount/network/asset/payTo.
3. Do not advertise a route that is returning a platform availability/error envelope rather than the seller's x402 challenge.
4. If AppDeploy remains unavailable at the Floot reset:
   - preserve the two working Floot PA routes;
   - prioritize implementing/rehosting the **vendor-intake gate** on Floot itself;
   - then migrate the highest-value component routes in demand order rather than publishing dead external resources.
5. External absolute URLs remain acceptable only after they independently pass the same zero-spend buyer-style check.

The portfolio verifier at `scripts/verify-x402-portfolio.mjs` and receipt `verification/x402-portfolio-verification-latest.json` are the authority for this availability gate.

## Prepared rehost assets

Use these before writing new implementation from scratch:

- `docs/floot-rehost-implementation-map.md` — exact source versions, public upstreams, cache behavior, migration order
- `recovery/x402-rehost-core.mjs` — host-independent Census/OFAC/RDAP/SEC/Treasury data core
- `scripts/test-x402-rehost-core.mjs` — official-upstream smoke test for that core
- issue #38 — AppDeploy availability incident
- issue #39 — Floot direct-rehost recovery checklist

The host-independent core intentionally contains no AppDeploy SDK dependency and no secrets.

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
5. Probe all six AppDeploy resources independently. Add only resources that currently return their real x402 payment challenge. If all six are healthy, the manifest target is **8 paid resources total**; otherwise keep unavailable routes out and begin the Floot rehost path above.
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
- resource count matches the set of routes that passed the independent availability gate
- both existing Floot PA routes still present
- vendor-intake gate present at $0.020 only if its live route is healthy or it has been rehosted on Floot
- SEC/Census/OFAC/RDAP/Treasury present only when their advertised paid URLs pass the real x402 challenge check

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

Run the manual GitHub workflow `Verify x402 portfolio` with `expected_floot_resources` set to the number of resources actually published in the Floot manifest.

There are two distinct acceptance states:

**Interim recovery acceptance**

Use this while AppDeploy remains unavailable and only a subset has been rehosted.

- every resource actually advertised by Floot must pass its real unpaid HTTP 402 challenge,
- the Floot manifest count must match the published set,
- the two existing PA Floot routes must remain green,
- any rehosted vendor-gate fixtures must pass,
- unavailable AppDeploy routes remain explicitly red in the full portfolio report and must not be advertised as healthy,
- `x402-verification-report.json` is uploaded as evidence.

**Full Step 2 acceptance**

Do not call Step 2 complete until:

- all 8 target paid routes pass the unpaid buyer-style challenge,
- all 3 vendor-gate fixtures pass,
- Floot advertises all 8 healthy resources,
- no resource in the manifest points to an `APP_TEMPORARILY_UNAVAILABLE` upstream,
- Agent402 recognizes the expanded set.

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

If Agent402 ignores/rejects healthy external AppDeploy resource URLs because they are not on the Floot host, use same-origin proxies.

**Do not use a proxy as a workaround for `APP_TEMPORARILY_UNAVAILABLE`.** A proxy to a dead AppDeploy upstream is still dead. When AppDeploy is unavailable, port/rehost the implementation itself on Floot.

For the healthy-external-URL case:

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
