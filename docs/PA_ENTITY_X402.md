# PA Entity Lookup x402

Live pay-per-call Pennsylvania business-registry lookup for autonomous agents.

## Buyer entry point — $0.001 best match

The lowest-friction SKU is a single-record resolver:

- Endpoint: `GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/pa-entity-one?q=OpenAI`
- Price: **$0.001 USDC**
- Protocol: x402 v2, `exact`
- Network: Base mainnet (`eip155:8453`)
- Payment asset: Base USDC (`USD Coin`, EIP-712 version `2`)
- Receiving address: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- Result: one best-ranked Pennsylvania legal-entity match or `found:false`
- Public source: Pennsylvania Department of State data via data.pa.gov

Use this route when an agent needs a quick company-identity answer and does not need a list of candidate records.

Example:

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/pa-entity-one?q=OpenAI
```

An unpaid request returns HTTP 402 with `PAYMENT-REQUIRED`, amount `1000` atomic USDC, and Bazaar-compatible input/output metadata.

## Deeper search — $0.005 multi-result

The fuller search remains live at the Floot origin:

- Origin: https://pa-entity-x402.floot.app
- Paid endpoint: `GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1`
- Price: **$0.005 USDC per successful lookup**
- Protocol: x402 v2, `exact`
- Network: Base mainnet (`eip155:8453`)
- Payment asset: Base USDC
- Receiving address: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- Public source: Pennsylvania Department of State data via data.pa.gov

Use the multi-result route when an agent needs to disambiguate names or inspect several candidate registrations.

## What it is for

Use these APIs for Pennsylvania:

- company identity resolution;
- legal-entity enrichment;
- corporate identity checks;
- vendor/customer verification;
- filing-number lookup;
- registration-type lookup;
- registered-address, city, ZIP, and county confirmation;
- lead-enrichment and due-diligence workflows.

They are not legal advice and should not be treated as proof of current good-standing status unless the source record explicitly establishes that fact.

## Multi-result request

```text
GET /_api/pa-business?q=NAME&limit=10
```

Parameters:

- `q` — required; business name or distinctive name fragment; minimum 2 characters.
- `limit` — optional; 1–25; default 10.

Matching is case-insensitive against the Pennsylvania `business_name` field. Results rank normalized legal-name matches first (ignoring common suffixes such as LLC/Inc.), then starts-with matches, then broader substring matches.

Examples:

```text
/_api/pa-business?q=OpenAI&limit=1
/_api/pa-business?q=Sheetz&limit=5
/_api/pa-business?q=Wawa&limit=5
```

## Multi-result response fields

```json
{
  "query": "OpenAI",
  "count": 1,
  "results": [
    {
      "businessName": "Openai, L.l.c.",
      "filingNumber": "0014371957",
      "registrationType": "Foreign Limited Liability Company",
      "address1": "600 North Second Street, Suite 401",
      "address2": null,
      "city": "Harrisburg",
      "state": "PA",
      "zip": "17101",
      "county": "Dauphin"
    }
  ],
  "source": "Pennsylvania Department of State via data.pa.gov",
  "paid": true
}
```

## Machine discovery

Floot multi-result discovery:

- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- Extended LLM reference: https://pa-entity-x402.floot.app/llms-full.txt
- Skill guide: https://pa-entity-x402.floot.app/skill.md
- x402 service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json

The AppDeploy OpenAPI/discovery contract also advertises the $0.001 best-match route alongside the existing $0.005 route. The cheap route currently inherits the older multi-result Bazaar example/schema inside its 402 extension; payment terms are correct, but route-specific single-match Bazaar metadata is queued for correction after the free deployment budget resets.

## Independent discovery / validation state

As of 2026-09-30:

### $0.001 best-match SKU

- **Market402** — free self-test passed all **11/11** x402 conformance checks; submission accepted and queued for Market402's rotating real-USDC paid-probe pool. The $0.001 price is within its purchase-test cap.
- **x402dash** — registered and independently marked `verified:true`.
- **x402 Arena** — agent `pa-entity-best-match`; active, verified, Bazaar-compatible; advertised price `0.001 USDC`.
- **402 Index** — service `3d5b06e5-9d2b-43e3-bc73-db35c4725253`; live HTTP 402 verified, health `healthy`, pending directory review because the shared AppDeploy origin cannot be domain-claimed by this seller.
- **Cinderwright Discovery Hub** — submission `sub_1790759792472` queued for independent verification.
- **nohumans.directory** — canonical cheap listing `64403ef1-4ad` is **verified**, score **1.0**, with **3/3** passing probes, no current failure streak, a free live PA-data sample, and a field-level response schema for paid-delivery validation. The accidental duplicate listing was delisted.
- **true402** — cheap service `360d6155-41e4-44c6-ac23-56062b633aa9` registered at $0.001; current transaction / settled-volume history is still zero.

### $0.005 multi-result SKU

- **x402scan** — registered from OpenAPI; 1 paid route, 0 failed, 0 skipped.
- **402 Index** — service `2a92dcd4-206a-42ad-b6e5-e457635bb75a`; domain-verified, active, and healthy. Current search for “Pennsylvania business registry” has returned this listing first.
- **x402dash** — endpoint registered and verified.
- **x402 Arena** — agent `pa-entity-lookup`; active, verified, Bazaar-compatible.
- **Agent402** — origin indexed and routable; external Base dispatch remains gated on independent settlement history.
- **true402** — service `ca9c2ed8-930c-4d55-920c-f87a858bb045`.
- **nohumans.directory** — listing `958fd262-287`; request/response schemas and a parameterized paid sample call published. Latest observed probe passed after earlier onboarding failures.
- **Market402** — submission queued; free self-test passed all 11 x402 conformance checks.
- **Cinderwright Discovery Hub** — endpoint-level submission `sub_1790759386628` queued for independent verification.
- **SCVD General Store preflight** — independent free probe returned `verdict: ready`; HTTP 402, PAYMENT-REQUIRED parsing, x402 v2, accepts fields, and Bazaar extension passed. Its separate `before-you-pay` simulation returned `will_your_client_pay: would_sign` at the advertised $0.005 price.

These are discovery or protocol observations, not endorsements. Unpaid conformance tests do not prove paid delivery after settlement.

## Revenue / buyer status

**Outside revenue: $0.00. Distinct outside payers: 0.**

No self-funded payment is counted as customer demand. The objective is a genuine third-party paid lookup.

## Failure behavior

The paid paths are designed to avoid settling payment when the public-data lookup cannot be delivered:

1. verify payment;
2. query Pennsylvania public data;
3. only then settle the payment;
4. return the result with a payment response receipt.

If the Pennsylvania source fails before settlement, the service returns an upstream error and does not intentionally settle that payment.

## Current acquisition objective

The $0.001 resolver is the low-friction acquisition SKU. The $0.005 route remains the deeper search product. The remaining bottleneck is the first independent settlement, because that creates real demand evidence and unlocks stronger router/catalog trust in systems that weight payment history.
