# Agentic.ai Resubmission Package — Pennsylvania Vendor Intake Gate

> **DEPRECATED HISTORICAL PACKAGE — DO NOT SEND OR USE FOR REVIEW.** The AppDeploy URLs below are historical and currently unavailable. The canonical unsent review source is `docs/agentic-ai-vendor-gate-resubmission-draft.md`; after Floot + Agent402 acceptance, `scripts/finalize-agentic-ai-vendor-gate-draft.mjs` generates the evidence-complete Floot-targeted copy.

_Status: prepared, **do not send yet**_

## Why this exists

Agentic.ai previously reviewed the raw x402 services and declined to list them because they were data APIs rather than tools that make/check decisions inside an agent loop.

The Pennsylvania Vendor Intake Gate is the response to that feedback. It performs a bounded vendor-intake decision and returns an explicit next action:

- `proceed` / `continue_vendor_intake`
- `human_review` / `pause_and_request_human_review`

This package is intentionally staged. **Do not resubmit until the gate is visible through the working Floot bare-origin discovery path and Agent402 has independently crawled that expanded origin.**

## Product

**Name:** Pennsylvania Vendor Intake Gate x402

**Paid endpoint**

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN`

**Price:** $0.020 USDC on Base

**Machine discovery**

- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms-full.txt
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md

**Reviewer evidence**

- https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md

## What it does inside an agent loop

The caller supplies:

- prospective vendor name
- U.S. address
- domain

The gate checks:

1. Pennsylvania Department of State registry identity
2. U.S. Census address evidence
3. OFAC SDN candidate-name screening
4. authoritative RDAP domain evidence

It returns a machine-actionable decision plus explicit review triggers and structured evidence.

Automatic continuation is deliberately fail-closed. Incomplete, ambiguous, inconsistent, or review-triggering evidence returns `human_review` instead of silently passing.

## Fixed live evidence

### Proceed path

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed`

Expected:

- HTTP 200
- `decision=proceed`
- `agentAction=continue_vendor_intake`
- no review triggers
- exactly one strong PA registry candidate
- registry evidence complete
- submitted and registry Census evidence complete
- OFAC evidence complete
- RDAP evidence complete

### Address-review path

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch`

Expected:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- trigger includes `registered_address_differs`

### Domain-review path

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch`

Expected:

- HTTP 200
- `decision=human_review`
- `agentAction=pause_and_request_human_review`
- trigger includes `domain_name_not_aligned`

These are fixed bounded fixtures, not an arbitrary free-vendor-screening bypass.

## Fail-closed behavior

The gate can pause for review on these codes:

### Pennsylvania registry

- `pa_registry_match_not_found`
- `pa_registry_name_ambiguous`
- `pa_registry_name_needs_review`
- `pa_registry_evidence_incomplete`

### Census

- `census_provided_evidence_incomplete`
- `provided_address_not_geocoded`
- `registry_address_missing`
- `census_registry_evidence_incomplete`
- `registry_address_not_geocoded`
- `registered_address_differs`

### OFAC

- `ofac_evidence_incomplete`
- `ofac_name_candidate_present`

### RDAP

- `rdap_evidence_incomplete`
- `domain_registration_not_confirmed`
- `domain_name_not_aligned`

## Safety/claim boundary

A `proceed` result means only that the configured automated intake checks did not trigger review.

It is not:

- legal advice
- sanctions clearance
- OFAC 50 Percent Rule ownership analysis
- fraud approval
- credit approval
- proof of current good standing
- proof that the vendor owns or controls an address
- proof that the vendor owns or controls a domain

## x402 behavior

- x402 v2
- Base mainnet (`eip155:8453`)
- Base USDC
- 20,000 atomic units = $0.020
- payout wallet: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- facilitator: `https://facilitator.payai.network`

Unpaid requests return HTTP 402 with `PAYMENT-REQUIRED`.

Evidence collection happens before settlement. If a required evidence source fails before a usable decision is produced, payment is not settled.

A successful paid response includes `PAYMENT-RESPONSE` and `x402-settled: true`.

## Current external evidence

Do not overstate this section.

Confirmed:

- production AppDeploy deployment is ready
- frontend/backend/network QA errors are zero
- gate is present in x402 discovery at $0.020
- OpenAPI exposes `checkPennsylvaniaVendorIntakeGate` and typed evidence fields
- three fixed live decision fixtures exercise proceed/address-review/domain-review behavior
- Market402 submission was accepted and its instant self-test passed 11/11
- 402 Index registration was accepted but remains constrained by the shared AppDeploy domain
- raw PA endpoints already have independent crawl/probe evidence in multiple directories

Not yet confirmed:

- vendor gate independently routed by Agent402
- vendor gate paid-verified by a directory
- attributable third-party vendor-gate payer
- third-party vendor-gate revenue

## Mandatory pre-send gate

Do not send the resubmission until all of these are true:

- [ ] Floot build quota has reset
- [ ] `https://pa-entity-x402.floot.app/.well-known/x402` advertises the expanded portfolio
- [ ] vendor-intake gate appears in that bare-origin manifest
- [ ] Agent402 re-registration rereads the Floot documents
- [ ] Agent402 recognizes the vendor-intake gate or an equivalent independent crawler recognizes it
- [ ] reviewer evidence doc is refreshed with the new independent crawl receipt
- [ ] no seller-funded/self-payment is presented as buyer evidence

## Draft resubmission copy

> We rebuilt the submission around your feedback that the prior services were raw data APIs rather than tools that make/check decisions inside an agent loop.
>
> The new Pennsylvania Vendor Intake Gate is a $0.020 x402 endpoint that takes a prospective vendor name, address, and domain, checks Pennsylvania registry identity, Census address consistency, OFAC SDN name candidates, and authoritative RDAP domain evidence, then returns either `proceed` / `continue_vendor_intake` or `human_review` / `pause_and_request_human_review`.
>
> It is deliberately fail-closed: ambiguous or incomplete registry evidence, incomplete Census/OFAC/RDAP evidence, address mismatch, OFAC review candidates, unregistered domains, or vendor/domain name misalignment pause the workflow for human review.
>
> Three bounded live fixtures show both action paths without exposing arbitrary free screening:
>
> - proceed: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed
> - address review: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch
> - domain review: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch
>
> Paid endpoint:
> https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate
>
> Reviewer evidence:
> https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md
>
> Machine discovery:
> https://pa-entity-x402.floot.app/.well-known/x402
>
> The result is an intake workflow signal only, not legal/compliance approval or sanctions clearance.

## Send-time edit

Before sending, replace the final machine-discovery/evidence paragraph with the newest independent Agent402/bare-origin crawl facts and date. Do not claim paid verification or buyer activity unless it actually exists.
