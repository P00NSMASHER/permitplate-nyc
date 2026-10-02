# PA Entity Lookup x402

Current public index for the Pennsylvania x402 service family.

The detailed service map is maintained here:

- [Current service map](pa-entity-x402.md)
- [Vendor-intake gate reviewer evidence](vendor-intake-gate-evidence.md)
- [Floot bare-origin consolidation plan](floot-x402-consolidation-plan.md)
- [Agentic.ai resubmission draft — do not send before Agent402 evidence](agentic-ai-vendor-gate-resubmission-draft.md)

## Current availability

As of October 2, 2026, the two Floot Pennsylvania raw routes are healthy. AppDeploy Support confirmed the AppDeploy-hosted routes are credit-gated because the weekly allowance is exhausted; the allowance resets October 5 at 00:00 UTC and discovery paths are not exempt. No paid top-up/upgrade is authorized. Track incident #38 and direct Floot rehost #39. Do not count the AppDeploy routes as currently buyer-available until the external zero-spend verifier is green again.

## Current paid products

### Pennsylvania best match

`GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=NAME`

Price: **$0.001 USDC** on Base via x402 v2.

### Pennsylvania enriched search

`GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=N`

Price: **$0.005 USDC** on Base via x402 v2.

### Pennsylvania Vendor Intake Decision Gate

`GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN`

Price: **$0.020 USDC** on Base via x402 v2.

The composed gate combines PA registry identity, Census address consistency, OFAC SDN candidate-name screening, and authoritative RDAP domain evidence. It returns either:

- `proceed` / `continue_vendor_intake`, or
- `human_review` / `pause_and_request_human_review`.

It fails closed when registry, Census, OFAC, or RDAP evidence is missing, ambiguous, incomplete, inconsistent, or hits a configured review condition.

A `proceed` result is only a workflow signal. It is not legal/compliance approval, sanctions clearance, fraud/credit approval, current-good-standing proof, or ownership/control proof.

## Machine discovery

### Working bare-origin PA seller

- x402 manifest: https://pa-entity-x402.floot.app/.well-known/x402
- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- skill: https://pa-entity-x402.floot.app/skill.txt

The Floot manifest currently exposes the two PA raw routes. Portfolio consolidation to eight paid resources is prepared and is the next action after the Floot build quota resets.

### AppDeploy composed-gate mirror

- x402 manifest: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- OpenAPI: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- llms-full: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms-full.txt
- skill: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md

OpenAPI v2.2.0 documents typed evidence-completeness fields and fail-closed review semantics for the vendor gate.

## Reviewer fixtures

- proceed: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed
- address review: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch
- domain review: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch

These are fixed test fixtures, not an arbitrary free vendor-screening API.

## Current commercial truth

- attributable third-party buyers: **0**
- confirmed third-party revenue: **$0**
- composed gate paid verification: **not yet confirmed**
- self-tests, registrations, unpaid probes, shared-wallet activity, and seller-funded calls are **not** customer revenue

The next major distribution step is the prepared Floot bare-origin consolidation, followed by Agent402 re-registration and only then an Agentic.ai resubmission.
