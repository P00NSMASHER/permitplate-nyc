# Pennsylvania Vendor Intake Gate x402

A pay-per-call, fail-closed decision tool for prospective Pennsylvania vendors inside an autonomous agent loop.

## Product

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN
```

Price: **$0.020 USDC on Base** via x402 v2.

The tool returns either:

- `proceed` + `agentAction=continue_vendor_intake`
- `human_review` + `agentAction=pause_and_request_human_review`

It also returns typed `reviewTriggers`, `checkedAt`, policy metadata, structured PA registry/Census/OFAC/RDAP evidence, and explicit limitations. There is intentionally no automatic legal/compliance rejection result.

## Fail-closed evidence contract

### Pennsylvania registry
Automatic continuation requires exactly one strong legal-entity candidate plus business name, filing number, registration type, and a usable registered address.

Review triggers include `pa_registry_match_not_found`, `pa_registry_name_ambiguous`, `pa_registry_name_needs_review`, and `pa_registry_evidence_incomplete`.

### Census
Both submitted-address and registry-address responses must echo the expected input, expose a boolean match result, identify the Census source, and—when matched—include normalized address text plus numeric coordinates.

Automatic continuation additionally requires matching primary street number + ZIP and coordinate distance <= 0.25 miles.

### OFAC
The response must satisfy the expected query/threshold/count/candidate/source contract. Incomplete evidence or any candidate at the configured score threshold (90) forces human review.

This is candidate-name screening only. A no-candidate result is not sanctions clearance and does not perform OFAC 50 Percent Rule ownership analysis.

### RDAP
The response must echo the requested domain, expose a boolean registration result, include an authoritative RDAP endpoint, and identify its source.

Automatic continuation additionally requires the domain to be registered and its hostname to plausibly align with the submitted vendor name. This does not prove domain ownership/control.

## Bounded live fixtures

These use the same decision engine without exposing arbitrary free vendor screening.

- proceed:
  `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed`
- address review:
  `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch`
  -> `human_review` + `registered_address_differs`
- domain review:
  `https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch`
  -> `human_review` + `domain_name_not_aligned`

Full reviewer evidence:
https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md

## Payment semantics

The gate is one outer x402 purchase at **$0.020 USDC**. It does not create nested seller-funded payments to its own component services.

Unpaid calls return HTTP 402 with `PAYMENT-REQUIRED`. Evidence collection occurs before settlement. A required-source failure before a usable decision returns an error without intentionally settling. Successful paid responses are wired to include `PAYMENT-RESPONSE` and `x402-settled: true`.

## Discovery

- OpenAPI 2.2.0: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- x402 manifest: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- llms-full: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms-full.txt
- skill: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md

OpenAPI operationId: `checkPennsylvaniaVendorIntakeGate`.

## Current hosting availability — 2026-10-02

The AppDeploy control plane still reports the stored deployment as ready, but an independent GitHub cloud probe at `2026-10-02T12:51:06Z` found the public vendor-gate URL and all five other AppDeploy-hosted x402 services returning the platform availability envelope instead of the seller challenge:

- HTTP 402
- `x-appdeploy-app-availability: temporarily-unavailable`
- `code=APP_TEMPORARILY_UNAVAILABLE`
- no `PAYMENT-REQUIRED`

Therefore the vendor gate is **temporarily not buyable** at its AppDeploy URL.

AppDeploy documents that hosted apps stop when no usable account credits remain and resume automatically after usable credits return. No paid top-up/upgrade is being used under the $0-additional-spend rule.

Outage receipt:
`verification/x402-portfolio-verification-latest.json`

The 2 PM ET Floot reset is now the primary zero-spend recovery path: preserve the two healthy PA routes and rehost the vendor gate on Floot if AppDeploy is still unavailable.

## Current external status — 2026-10-02

Confirmed:

- AppDeploy control plane retains a ready deployment, but public hosting is currently paused and the paid gate is temporarily not buyable
- Market402 submission accepted; instant self-test previously passed 11/11
- current Market402 public index/search does not independently surface the gate
- current 402 Index buyer-style search does not surface the gate; the earlier gate registration ID currently returns 404
- current nohumans vendor-intake discovery does not surface the composed gate
- current Agent402 Floot seller is healthy/routable but exposes only the two raw PA tools; the gate is not yet in the Floot manifest
- PayAI resource stats for the **vendor gate itself** report 0 settlements and $0 volume

A separate 0.001 USDC settlement was observed on the Floot **PA best-match raw route**. It is not a vendor-gate settlement and is not vendor-gate revenue.

Vendor-gate scoreboard:

- settlements: **0**
- attributable buyers: **0**
- verified-customer revenue: **$0**

## Limits

`proceed` means only that configured automated review triggers were not hit. It is not legal/compliance approval, sanctions clearance, good-standing certification, proof of ownership/control, fraud approval, or credit approval.

## Next distribution gate

Do not resubmit to Agentic.ai until the Floot bare-origin manifest includes this gate and Agent402 or an equivalent independent crawler recognizes it.
