# Pennsylvania Vendor Intake Gate x402 — production evidence receipt

Date: 2026-10-02
Production AppDeploy app: `pa-entity-lookup-x402-4fbm4s`
Deployment snapshot: `1790919343993`
Rollback baseline retained: AppDeploy v13 / `1790900255883`

## Product change

Added one composed paid endpoint to the existing PA Entity Lookup x402 service:

```text
GET /api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN
```

Price: $0.020 USDC on Base.

Existing paid routes were not repriced or removed:
- `/api/pa-entity-one`: $0.001
- `/api/pa-business`: $0.005

The new endpoint returns `proceed` or `human_review`, an explicit agent action, review triggers, policy thresholds, and source evidence.

## Decision evidence

Automatic continuation requires:
- strong PA registry best-name match
- supplied and registry addresses both matched by Census and within 0.25 miles
- zero OFAC SDN name candidates at configured score >= 90
- RDAP confirms the supplied domain is registered

Any failed/uncertain condition becomes `human_review`; the gate does not issue an automatic rejection.

## Safety/claim boundary

The production response explicitly states:
- proceed is not legal, compliance, sanctions, fraud, or credit approval
- OFAC no-candidate is not sanctions clearance
- 50 Percent Rule ownership analysis is not included
- PA registry match is not proof of good standing, ownership, or contracting authority
- Census match is not proof of location control
- RDAP registration is not proof of domain ownership

## Live verification

AppDeploy status after release:
- status: ready
- frontend errors: none
- backend errors: none

Independent public browser verification:
- landing shows Agent-loop vendor intake gate at $0.020
- original $0.001 and $0.005 PA products remain visible
- fixed live sample decision: `proceed`
- fixed live sample action: `continue_vendor_intake`
- fixed live sample review triggers: `0`
- evidence shown: PA Registry, Census, OFAC, RDAP
- `/.well-known/x402` lists `/api/vendor-intake-gate` at $0.020
- OpenAPI contains operationId `checkPennsylvaniaVendorIntakeGate`
- unpaid production request returns HTTP 402 `payment_required`
- unpaid challenge states $0.020 USDC on Base, amount 20,000 atomic units

Live URLs:
- https://pa-entity-lookup-x402-4fbm4s.v2.appdeploy.ai/
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo

## Component reuse

The gate reuses the existing live PA registry, Census, OFAC, and RDAP service implementations. Their standalone paid x402 endpoints and prices remain unchanged and are identified in returned evidence.

Nested seller-funded x402 purchases were intentionally not introduced between the seller's own services; that would create self-payment/double settlement rather than improve the buyer-facing agent action. The gate is the single buyer-facing x402 transaction.

## Submission status

Agentic.ai was **not** resubmitted during this work. The product was first implemented and live-verified so a later resubmission can point to working agent-loop evidence rather than another raw data API.


---

## Addendum — subsequent hardening and attribution evidence on 2026-10-02

The sections above record the original production release at snapshot `1790919343993`. The gate was subsequently hardened without changing its $0.020 price or outer x402 payment model.

### Hardening added after initial release

Later production changes added fail-closed checks for:

- ambiguous PA registry matches
- incomplete PA registry core identity evidence
- Census response provenance/completeness
- primary street-number + ZIP equality in addition to the 0.25-mile coordinate rule
- OFAC response completeness before a zero-candidate result can support continuation
- RDAP response completeness
- registered-domain/vendor-name alignment

The machine contract was expanded to OpenAPI **2.2.0** with typed review triggers and structured evidence-completeness fields.

Latest successful machine-schema deployment snapshot in this sequence: `1790932107657`.

### Bounded regression fixtures

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch
```

Expected negative cases:
- address mismatch -> `human_review` + `registered_address_differs`
- unrelated registered domain -> `human_review` + `domain_name_not_aligned`

Reviewer evidence:
https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md

### Settlement / revenue separation

A separate resource-specific settlement was observed on the Floot **$0.001 PA best-match raw route**, not on the $0.020 vendor gate:

- PayAI reports 1 settlement on `https://pa-entity-x402.floot.app/_api/pa-entity-one`
- matching Base transfer: 0.001 USDC
- tx: `0x17985b16137ff8aef95641be06424a5fa4e9edacc6ade5aaf0a58d523ad1cd73`
- payer: `0x7e6b6556322c4e26c567a867964ac793f5ee2b1c`
- internal attribution: `external_unattributed`
- verified-customer revenue counted: $0

The payer is external to the seller wallet and absent from repository/test history, but current public evidence does not distinguish an end-customer agent from an independent verifier/probe. Under the strict accounting rule, it remains excluded from customer revenue until provenance is resolved.

The vendor-intake gate itself remains at 0 settlements / $0 revenue.

Durable attribution receipt:
`verification/x402-revenue-attribution-latest.json`

### Distribution

- Agent402 remains healthy/routable for the two current PA raw routes but still reports `settlement_required`.
- ForgeMesh upstream validation of the prepared PA raw seller record passed **95/100** and independently verified the 0.001 USDC proof transaction.
- Zero-cost ForgeMesh submission transport is blocked because the connected GitHub toolset cannot fork the ForgeMesh repository; the $0.05 paid submission endpoint is intentionally not used.
- Agentic.ai resubmission remains unsent until the vendor gate is independently visible through the working Floot bare-origin path.
