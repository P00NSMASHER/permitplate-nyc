# Pennsylvania Vendor Intake Gate x402

A pay-per-call agent-loop check for prospective Pennsylvania vendors.

## Product

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN
```

Price: **$0.020 USDC on Base** via x402 v2.

The tool is designed to answer a workflow question rather than merely return source data:

> Can this automated vendor-intake flow continue, or should it pause for human review?

It returns one of two decisions:

- `proceed` with `agentAction=continue_vendor_intake`
- `human_review` with `agentAction=pause_and_request_human_review`

There is intentionally no automatic reject result.

## Evidence used

The gate combines four existing live service capabilities:

1. **Pennsylvania registry identity**
   - finds and ranks Pennsylvania Department of State entity records
   - requires a strong best-name match for automatic continuation

2. **Census address consistency**
   - geocodes the supplied address and the matched registry address
   - requires both to match and be within 0.25 miles

3. **OFAC SDN candidate-name screening**
   - uses current SDN primary names and aliases
   - any candidate at score 90 or above triggers human review

4. **Domain RDAP**
   - checks authoritative registration metadata via IANA RDAP bootstrap
   - automatic continuation requires `registered=true`

The JSON response includes `reviewTriggers`, policy thresholds, and the evidence that produced the workflow decision.

## Limits

A `proceed` result means only that the configured automated review triggers were not hit.

It does **not** mean:
- legal or compliance approval
- sanctions clearance
- good-standing certification
- proof of beneficial ownership or authority to contract
- proof of physical control of an address
- proof that the vendor owns or controls the supplied domain
- fraud or credit approval

OFAC screening is candidate-name screening only. A no-candidate result is not clearance, and OFAC 50 Percent Rule ownership analysis is not included.

## Payment semantics

The gate itself is one $0.020 x402 purchase.

Existing standalone products remain unchanged:
- PA best match: $0.001
- PA enriched search: $0.005
- Census geocoder: $0.005
- OFAC SDN screen: $0.005
- RDAP lookup: $0.005

The gate reuses those live service implementations and exposes the standalone paid endpoint URLs in returned evidence. It does not create nested seller-funded payments to the seller's own component services.

The gate verifies its outer x402 payment, collects the evidence, and only then settles. Required-source failure returns an error without intentionally settling the outer payment.

## Discovery

- landing: https://pa-entity-lookup-x402-4fbm4s.v2.appdeploy.ai/
- OpenAPI: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- x402 manifest: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- skill: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md
- fixed live demo: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo

OpenAPI operationId: `checkPennsylvaniaVendorIntakeGate`.

## Verified production evidence — 2026-10-02

Independent read-only live verification observed:
- landing page visibly advertises the gate at $0.020
- the original $0.001 and $0.005 PA offers remain visible
- fixed sample result: `proceed`
- fixed sample action: `continue_vendor_intake`
- fixed sample review-trigger count: 0
- fixed sample evidence: PA Registry, Census, OFAC, RDAP
- x402 manifest lists the gate at $0.020
- OpenAPI includes the gate operation
- unpaid production request returns HTTP 402 / `payment_required`, price $0.020 USDC, Base network `eip155:8453`, amount 20,000 atomic units

No payment, marketplace submission, or Agentic.ai resubmission was performed during this verification.
