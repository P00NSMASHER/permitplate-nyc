# PA Entity Lookup x402

A pay-per-call Pennsylvania business-registry lookup for autonomous agents.

## What it does

Resolve a Pennsylvania company name or distinctive name fragment into structured Pennsylvania Department of State registration records.

Common agent use cases:

- company identity resolution
- legal-entity enrichment
- corporate identity checks
- vendor and customer verification
- due diligence
- filing-number lookup
- registration-type lookup
- registered address, city, ZIP, and county confirmation
- lead enrichment

## Paid product ladder

Current production:

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10
```

Price: **$0.005 USDC per successful settled lookup**

Prepared for the next hardened production release:

```text
GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=NAME
```

Price: **$0.001 USDC per successful settled lookup**

The $0.001 route returns at most one best-ranked legal entity. The $0.005 route returns multiple ranked candidates for disambiguation and enrichment.

Protocol: **x402 v2**

Network: **Base mainnet (eip155:8453)**

No account or API key is required. An unpaid request returns HTTP 402 with a `PAYMENT-REQUIRED` challenge.

## Example

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1
```

The hardened response schema is JSON with:

- `query`
- `count`
- `results[].businessName`
- `results[].filingNumber`
- `results[].registrationType`
- `results[].creationDate`
- `results[].address1`
- `results[].address2`
- `results[].city`
- `results[].state`
- `results[].zip`
- `results[].county`
- `results[].countyCode`
- `results[].principals[]`
- `enrichment.principals`
- `source`
- `paid`

## Matching behavior

Search is case-insensitive against the Pennsylvania `business_name` field.

Results are ranked to prefer normalized legal-name matches first, ignoring common suffixes such as LLC or Inc., followed by starts-with and broader substring matches.

Examples:

- `OpenAI` prioritizes `Openai, L.l.c.`
- `Sheetz` prioritizes `Sheetz, Inc.`
- `Wawa` prioritizes `Wawa, Inc.`

## Source

Pennsylvania Department of State registered-business public data via data.pa.gov.

This service is a factual lookup/enrichment API. It is not legal advice and should not be treated as proof of current good-standing status unless the underlying Pennsylvania source explicitly establishes that fact.

## Machine discovery

Currently working live surfaces:

- Landing page: https://pa-entity-x402.floot.app
- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json
- provider-specific x402 service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json

Known discovery defects pending the next production release:

- `/.well-known/x402`, `/.well-known/x402.json`, and `/.well-known/x402-services.json` are not yet live.
- `/skill.md` currently resolves to Floot's HTML application shell rather than raw Markdown, so it should **not** be treated as a working machine-readable surface.

The parser-tested canonical manifest intended for the next release is tracked in `x402-manifest.json`.

## External discovery / verification status

Current red-team snapshot on 2026-09-30:

- Coinbase/CDP x402 validator: **valid=true**, simulation **accepted** in the most recent completed validation; required preflights passed for live HTTP 402, `PAYMENT-REQUIRED`, x402 v2, Base, USDC, exact scheme, resource metadata, Bazaar extension, input metadata, and Bazaar schema.
- x402scan: registered.
- true402: registered, but the current record has **0 transactions**, **trustScore 0**, and an old `lastSeen`; refresh after the next production release.
- nohumans.directory main $0.005 listing: **verified by probe**; latest commercial sweep improved the score to about **0.896** and moved the seller to about **#18** for the buyer query "Pennsylvania business registry"; **not paid-verified**, 0 distinct payers.
- 402 Index: **active** and **healthy**. Its current record says `approval_reason: domain-verified` but also reports `domain_verified: 0`, `verified: 0`, and `x402_payment_valid: null`; do not describe it as currently verified until those fields agree.
- Agent402: indexed and parses the paid OpenAPI route, but currently **routable=false** because the canonical x402 manifest path still returns 403. The parser-tested manifest repair is prepared for the next production release.
- Market402: the exact $0.005 endpoint is now **actually queued and present in the paid-probe opt-in roster** with a valid sample input. Its instant self-test passes **11/11**. Paid-probe qualification is currently blocked only by `not_in_catalog` until the resource appears in the public Bazaar catalog. This is not yet a verified badge or a paid settlement.
- Cinderwright Discovery Hub: an earlier submission was accepted into its verification queue; no independent paid verification has been established.
- x402dash and x402 Arena were previously accepted by their registration APIs; they were not re-audited in the latest red-team sweep.

Historical 402 Index buyer-search snapshot from earlier on 2026-09-30:

- `Pennsylvania business registry`: rank **#1**
- `company identity Pennsylvania`: rank **#1**
- `vendor verification Pennsylvania`: rank **#2**

AgentCash has also previously discovered the seller as one paid GET route at $0.005 USD over x402.

## Lower-cost product

A legacy AppDeploy **$0.001** single-best-match route is live and independently passes Market402's 11/11 x402 self-test and Coinbase/CDP validation. However, its older settlement-recovery implementation predates the latest red-team hardening, so it is **not being promoted to funded paid probes**.

A hardened $0.001 best-match route is prepared for the Floot origin and covered by the same settlement-pending, invalid-payment, timeout, CORS, ranking, and enrichment protections as the $0.005 route. Once deployed, the intended product ladder is:

- $0.001: one best-ranked entity;
- $0.005: multi-result enriched search.

Neither route counts as revenue until an independent buyer actually settles USDC.

## Revenue

At the latest PayAI resource-stat readback:

- settlements: **0**
- unique buyers: **0**
- total volume: **$0**

Third-party revenue remains **$0.00**.

## Wallet

Seller payout address:

```text
0x708f7b52b56eafd7fc1de65fc7752ed732914021
```

Base USDC contract:

```text
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
