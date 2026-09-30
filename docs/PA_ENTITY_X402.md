# PA Entity Lookup x402

Live pay-per-call Pennsylvania business-registry lookup for autonomous agents.

## Live service

- Origin: https://pa-entity-x402.floot.app
- Paid endpoint: `GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1`
- Price: **$0.005 USDC per successful lookup**
- Protocol: x402 v2, `exact`
- Network: Base mainnet (`eip155:8453`)
- Payment asset: Base USDC
- Receiving address: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- Public source: Pennsylvania Department of State data via data.pa.gov

An unpaid request returns HTTP 402 with a `PAYMENT-REQUIRED` header. The paid retry returns structured Pennsylvania registration records after payment verification and settlement.

## What it is for

Use this API for Pennsylvania:

- company identity resolution;
- legal-entity enrichment;
- corporate identity checks;
- vendor/customer verification;
- filing-number lookup;
- registration-type lookup;
- registered-address, city, ZIP, and county confirmation;
- lead-enrichment and due-diligence workflows.

It is not legal advice and should not be treated as proof of current good-standing status unless the source record explicitly establishes that fact.

## Request

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

## Response fields

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

- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- Extended LLM reference: https://pa-entity-x402.floot.app/llms-full.txt
- Skill guide: https://pa-entity-x402.floot.app/skill.md
- x402 service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json

## Independent discovery / validation state

As of 2026-09-30:

- **x402scan** — registered from OpenAPI; 1 paid route, 0 failed, 0 skipped.
- **402 Index** — service `2a92dcd4-206a-42ad-b6e5-e457635bb75a`; domain-verified, active, and healthy.
- **x402dash** — endpoint registered and verified.
- **x402 Arena** — agent `pa-entity-lookup`; active, verified, Bazaar-compatible.
- **Agent402** — origin indexed, crawl health 1, routable; external Base dispatch remains gated on independent settlement history.
- **true402** — service `ca9c2ed8-930c-4d55-920c-f87a858bb045`.
- **nohumans.directory** — listing `958fd262-287`; request/response schemas and a parameterized sample call published. Latest observed probe passed after earlier onboarding failures.
- **Market402** — submission queued; free self-test passed all 11 x402 conformance checks.
- **Cinderwright Discovery Hub** — submission `sub_1790757996876` queued for independent verification.
- **Agent402 index** — seller is visible and healthy, but its router correctly reports `settlement_required` until independent buyers exist.
- **SCVD General Store preflight** — independent free probe on 2026-09-30 returned `verdict: ready`; HTTP 402, PAYMENT-REQUIRED parsing, x402 v2, accepts fields, and Bazaar extension all passed. Its separate `before-you-pay` simulation returned `will_your_client_pay: would_sign` for a stock x402 client at the advertised $0.005 price. Reproduce with `POST https://scvd.store/api/preflight/v1` or `POST https://scvd.store/api/before-you-pay/v1` and `{"url":"https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1"}`.

These are discovery or protocol observations, not endorsements. The SCVD checks are unpaid structural/client-selection evidence and do not prove delivery after payment.

## Revenue / buyer status

**Outside revenue: $0.00. Distinct outside payers: 0.**

No self-funded payment is counted as customer demand. The objective is a genuine third-party paid lookup.

## Failure behavior

The service is designed to avoid charging for an unusable upstream result:

1. verify payment;
2. query Pennsylvania public data;
3. only then settle the payment;
4. return the result with a payment response receipt.

If the Pennsylvania source fails before settlement, the service returns an upstream error and does not intentionally settle that payment.

## Current acquisition objective

The technical path is live. The remaining bottleneck is the first independent settlement, because that unlocks stronger router/catalog eligibility in networks that gate new Base sellers on real settlement history.
