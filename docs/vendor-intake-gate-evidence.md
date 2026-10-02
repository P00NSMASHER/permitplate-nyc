# Pennsylvania Vendor Intake Gate x402 — Reviewer Evidence

_Last refreshed: 2026-10-02_

## Current availability incident — 2026-10-02

As of **2026-10-02 13:04 UTC**, the AppDeploy shared API edge is returning HTTP 402 with `x-appdeploy-app-availability: temporarily-unavailable`, body code `APP_TEMPORARILY_UNAVAILABLE`, and no seller `PAYMENT-REQUIRED` header for the AppDeploy-hosted x402 services. Reapplying the current vendor-gate deployment did not clear the condition.

This is being tracked in [incident #38](https://github.com/P00NSMASHER/permitplate-nyc/issues/38). The direct Floot rehost is tracked in [recovery #39](https://github.com/P00NSMASHER/permitplate-nyc/issues/39).

The two Floot Pennsylvania raw routes remain healthy and continue to return valid x402 challenges. Do **not** treat the AppDeploy vendor gate or other AppDeploy-hosted routes as currently buyer-available until the zero-spend buyer verifier is green again.

## What this product does

The Pennsylvania Vendor Intake Gate is a composed x402 endpoint for an autonomous agent that needs a bounded workflow decision during vendor intake.

**Paid endpoint**

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN`

**Price:** $0.020 USDC per successful paid call on Base.

The gate combines four evidence families:

1. Pennsylvania Department of State business-registry identity
2. U.S. Census address normalization and coordinate consistency
3. OFAC SDN candidate-name screening
4. Authoritative RDAP domain-registration evidence

It returns either:

- `decision=proceed` with `agentAction=continue_vendor_intake`, or
- `decision=human_review` with `agentAction=pause_and_request_human_review`

A `proceed` result is only a workflow signal that the configured review triggers were not hit. It is **not** legal, compliance, sanctions, fraud, credit, ownership, or good-standing approval.

## Fixed live reviewer fixtures

These are deliberately bounded free fixtures. They do not expose arbitrary free vendor screening.

### 1. Expected automatic continuation

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed`

Expected result:

- HTTP 200
- `decision=proceed`
- `agentAction=continue_vendor_intake`
- no review triggers
- exactly one strong Pennsylvania registry candidate
- core registry identity evidence complete
- submitted and registry Census evidence complete
- OFAC evidence contract complete
- RDAP evidence contract complete
- vendor/domain name alignment true

### 2. Expected address review

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch`

Expected result:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- includes `registered_address_differs`

The fixture keeps the vendor name and domain fixed while supplying a known far-away Census-geocodable address.

### 3. Expected domain review

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch`

Expected result:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- includes `domain_name_not_aligned`

The fixture uses a registered but unrelated domain so that "registered" alone cannot produce automatic continuation.

## Fail-closed decision contract

The gate returns `human_review` when any of these conditions applies:

### Pennsylvania registry

- `pa_registry_match_not_found`
- `pa_registry_name_ambiguous`
- `pa_registry_name_needs_review`
- `pa_registry_evidence_incomplete`

Automatic continuation requires exactly one strong legal-entity candidate plus a business name, filing number, registration type, and usable registered address.

### Census address evidence

- `census_provided_evidence_incomplete`
- `provided_address_not_geocoded`
- `registry_address_missing`
- `census_registry_evidence_incomplete`
- `registry_address_not_geocoded`
- `registered_address_differs`

Each Census response must echo the expected input, expose a boolean match result, identify the Census source, and—when matched—include a normalized address plus numeric coordinates.

For automatic continuation, the submitted and registry addresses must also have the same Census-normalized primary street number and ZIP and be within the configured 0.25-mile coordinate threshold.

### OFAC evidence

- `ofac_evidence_incomplete`
- `ofac_name_candidate_present`

A clean zero-candidate result is trusted only when the OFAC response satisfies the expected evidence contract: aligned query, configured threshold, valid counts, candidate array consistency, source, and review-oriented semantics.

This is candidate-name screening only. It does not perform OFAC 50 Percent Rule ownership analysis and a no-candidate result is not sanctions clearance.

### RDAP evidence

- `rdap_evidence_incomplete`
- `domain_registration_not_confirmed`
- `domain_name_not_aligned`

RDAP evidence must echo the requested domain, expose a boolean registration result, include an authoritative RDAP endpoint, and identify its source.

A registered domain must additionally have hostname labels that plausibly align with the submitted vendor name before automatic continuation. This is a conservative heuristic and does not prove ownership or control.

## x402 payment behavior

Machine discovery:

- `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402`
- `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402.json`
- `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json`
- `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms-full.txt`
- `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md`

Payment terms:

- x402 version 2
- network: Base (`eip155:8453`)
- asset: USDC
- amount: 20,000 atomic units = $0.020
- payout address: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- facilitator: `https://facilitator.payai.network`

An unpaid call receives HTTP 402 with a `PAYMENT-REQUIRED` challenge.

The service verifies payment before performing the paid workflow. If a required evidence source fails before a usable result is produced, the response is 502 and payment is not settled. Settlement occurs only after the decision result has been produced successfully. A successful paid response includes `PAYMENT-RESPONSE` and `x402-settled: true`.

## Machine-readable output

The paid response exposes:

- `decision`
- `agentAction`
- typed `reviewTriggers`
- `checkedAt`
- original normalized input
- policy metadata
- structured `evidence.registry`
- structured `evidence.address`
- structured `evidence.ofac`
- structured `evidence.domain`
- explicit limitations
- paid/price fields

Each evidence family exposes completeness/alignment fields so an autonomous caller can audit why the workflow continued or paused.

## Related raw endpoints

The composed gate is additive. The underlying PA products remain available:

- `GET /api/pa-entity-one?q=NAME` — $0.001 USDC
- `GET /api/pa-business?q=NAME&limit=N` — $0.005 USDC

The Census, OFAC, and RDAP products are also separately available as x402 endpoints, but the vendor-intake gate exists specifically to make/check a bounded workflow decision instead of returning only raw data.
