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

## Live paid endpoint

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10
```

Price: **$0.005 USDC per successful paid lookup**

Protocol: **x402 v2**

Network: **Base mainnet (eip155:8453)**

No account or API key is required. An unpaid request returns HTTP 402 with a `PAYMENT-REQUIRED` challenge.

## Example

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1
```

The paid response is JSON with:

- `query`
- `count`
- `results[].businessName`
- `results[].filingNumber`
- `results[].registrationType`
- `results[].address1`
- `results[].address2`
- `results[].city`
- `results[].state`
- `results[].zip`
- `results[].county`
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

- Landing page: https://pa-entity-x402.floot.app
- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- skill.md: https://pa-entity-x402.floot.app/skill.md
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json
- x402 service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json

## External discovery / verification status

As of 2026-09-30:

- x402scan: registered
- true402: registered
- nohumans.directory: verified
- x402dash: registered and verified
- 402 Index: active, healthy, domain-verified
- x402 Arena: active and verified
- Agent402: listed as routable/healthy
- Market402: submission queued; immediate self-test passed 11/11 x402 checks
- Cinderwright Discovery Hub: queued for verification

The service has also passed AgentCash discovery as one paid GET route at $0.005 USD over x402.

## Wallet

Seller payout address:

```text
0x708f7b52b56eafd7fc1de65fc7752ed732914021
```

Base USDC contract:

```text
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
