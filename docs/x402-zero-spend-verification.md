# Zero-Spend x402 Portfolio Verification Runbook

_Last updated: 2026-10-02_

## Purpose

Verify the x402 portfolio from a buyer-like network path **without sending a payment signature, spending USDC, or manufacturing settlement history**.

The verifier checks:

1. all eight paid endpoints return HTTP 402 to an unpaid caller,
2. `PAYMENT-REQUIRED` decodes as x402 v2,
3. amount/network/asset/payee match the expected portfolio terms,
4. the 402 body is valid JSON,
5. the three fixed vendor-gate fixtures produce the expected decision branches,
6. the Floot and AppDeploy discovery manifests have the expected resource counts.

Script:

`scripts/verify-x402-portfolio.mjs`

Manual GitHub workflow:

`.github/workflows/verify-x402-portfolio.yml`

The workflow has **no schedule and no automatic push/pull-request trigger**.

## Same-origin Floot rehost mode

The verifier can switch the six AppDeploy-hosted products to same-origin Floot replacements without editing the script.

For the full rehost run, set:

- `expected_floot_resources = 8`
- `rehost_base_url = https://pa-entity-x402.floot.app`

That changes the verifier targets to:

- `/_api/vendor-intake-gate`
- `/_api/vendor-intake-demo`
- `/_api/sec-filings`
- `/_api/us-address-geocode`
- `/_api/ofac-sdn-screen`
- `/_api/domain-rdap`
- `/_api/treasury-average-rates`

The two existing PA Floot routes remain unchanged.

When `rehost_base_url` is empty, the verifier continues testing the current AppDeploy URLs and the AppDeploy PA discovery manifest.

## Before Floot consolidation

Run the manual workflow with:

`expected_floot_resources = 2`

Expected Floot manifest:

1. PA Entity Best Match — $0.001
2. PA Entity Enriched Search — $0.005

The AppDeploy PA manifest is expected to contain 3 resources:

1. Vendor Intake Gate — $0.020
2. PA Entity Enriched Search — $0.005
3. PA Entity Best Match — $0.001

## After Floot consolidation

Run the same workflow with:

`expected_floot_resources = 8`

Do not edit the verifier just to change the count.

Expected Floot portfolio resources:

1. PA best match — $0.001
2. PA enriched search — $0.005
3. PA vendor-intake gate — $0.020
4. SEC recent filings — $0.005
5. Census geocoder — $0.005
6. OFAC SDN name screen — $0.005
7. Domain RDAP lookup — $0.005
8. Treasury average interest rates — $0.005

## Vendor-gate fixture expectations

### Proceed fixture

`?case=proceed`

Must return:

- HTTP 200
- `decision=proceed`
- `agentAction=continue_vendor_intake`
- zero review triggers
- complete PA registry evidence
- complete provided-address Census evidence
- complete registry-address Census evidence
- complete OFAC evidence
- complete RDAP evidence

### Address-review fixture

`?case=address_mismatch`

Must return:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- trigger `registered_address_differs`

### Domain-review fixture

`?case=domain_mismatch`

Must return:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- trigger `domain_name_not_aligned`

## Evidence artifact

Every manual workflow run writes:

`x402-verification-report.json`

and uploads it as the GitHub Actions artifact:

`x402-verification-report`

The JSON report records:

- timestamp
- zero-spend flag
- payment-sent flag
- paid-route pass/fail summary
- per-route HTTP status and latency
- specific payment-term failures
- vendor-gate fixture outcomes
- discovery resource counts

## Interpretation rules

### PASS

A PASS means the unpaid buyer path and declared x402 terms matched the expected contract at that time.

It is **not** a payment, buyer, settlement, endorsement, or revenue event.

### FAIL

Any paid-route failure is a release/distribution blocker until explained.

### AppDeploy availability envelope

For AppDeploy-hosted routes, the verifier records:

- `x-appdeploy-app-availability`
- response body `code`
- response body `message`
- whether `PAYMENT-REQUIRED` is actually present

A response such as:

- HTTP 402
- `x-appdeploy-app-availability: temporarily-unavailable`
- body code `APP_TEMPORARILY_UNAVAILABLE`
- no `PAYMENT-REQUIRED`

is **not** an x402 payment challenge. It is a hosting/edge availability failure and must remain red even though the numeric HTTP status is 402.

Any paid-route failure is a release/distribution blocker until explained.

Examples:

- route no longer returns 402
- PAYMENT-REQUIRED cannot be decoded
- wrong amount
- wrong network
- wrong Base USDC asset
- wrong payout wallet
- non-JSON 402 response
- vendor-gate decision fixture regresses
- discovery resource count unexpectedly changes

Do not weaken the verifier merely to turn a real regression green.

### Expected manifest transition

Changing Floot from 2 resources to 8 is intentional only after the portfolio consolidation publish.

Run the workflow with the matching expected count. A count mismatch at any other time should be investigated.

## Commercial accounting

Never count any of these as third-party revenue:

- this verification workflow
- HTTP 402 probes
- fixed vendor-gate fixtures
- directory registration
- marketplace self-tests
- operator testing
- seller-funded payments
- shared-wallet activity not attributable to a specific outside buyer

Current commercial truth remains:

- attributable third-party buyers: 0
- confirmed attributable third-party revenue: $0

until independent payment evidence says otherwise.
