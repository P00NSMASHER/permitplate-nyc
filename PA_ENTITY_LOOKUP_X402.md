# PA Entity Lookup x402

A pay-per-call Pennsylvania business-registry lookup for autonomous agents.

## Live product ladder

### $0.001 best match

```text
GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=NAME
```

Returns one highest-ranked Pennsylvania legal-entity match.

### $0.005 enriched search

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10
```

Returns multiple ranked Pennsylvania entities for disambiguation and enrichment.

Both are live on:

- protocol: x402 v2
- network: Base mainnet (eip155:8453)
- asset: USDC
- payTo: 0x708f7b52b56eafd7fc1de65fc7752ed732914021
- source: Pennsylvania Department of State public data via data.pa.gov

No account or API key is required. Unpaid requests return HTTP 402 with `PAYMENT-REQUIRED`.

## Response data

The enriched entity schema includes:

- businessName
- filingNumber
- registrationType
- creationDate
- address1
- address2
- city
- state
- zip
- county
- countyCode
- principals[].role
- principals[].firstName
- principals[].middleName
- principals[].lastName

The $0.001 route preserves its original `found/result` response fields and also exposes additive `count/results` fields for machine consistency.

The API does not establish current good standing, sanctions status, a risk score, legitimacy, or independent proof of current management authority.

## Search behavior

Search is case-insensitive against the Pennsylvania `business_name` field.

The live hardened search:

1. uses a fast starts-with lookup first;
2. ranks normalized legal-name matches first, ignoring common suffixes such as LLC or Inc.;
3. falls back to a broader contains search only when necessary;
4. deduplicates by filing number;
5. never uses whole-record `$q` matching that can accidentally match only an address.

Representative intended matches:

- OpenAI → Openai, L.l.c. / 0014371957
- Sheetz → Sheetz, Inc. / 0000326968
- Wawa → Wawa, Inc. / 0000233685

## Payment hardening

The production seller now:

- requires explicit PayAI `isValid:true`; generic success flags do not verify payment;
- parses structured invalid-payment bodies even when the facilitator returns HTTP 4xx;
- returns invalid payment as 402 rather than misreporting it as a verifier outage;
- never turns `settlement_pending` or `duplicate_settlement` into a fresh payment request;
- retries the same settlement authorization in bounded recovery attempts;
- returns an unresolved retryable state without `PAYMENT-REQUIRED` when settlement is ambiguous;
- does not settle when the primary Pennsylvania source fails;
- limits payment header size and query length;
- validates paid-retry input before spending facilitator/upstream capacity;
- uses bounded PayAI and PA Open Data timeouts;
- emits `Cache-Control: no-store` on payment/unresolved states;
- exposes x402 payment headers on GET responses for browser clients.

Known platform limitation: Floot owns the OPTIONS gateway. OPTIONS returns HTTP 204 but currently does not expose custom CORS headers. Server-to-server x402 buyers are unaffected.

## Machine discovery

Live:

- https://pa-entity-x402.floot.app/openapi.json
- https://pa-entity-x402.floot.app/llms.txt
- https://pa-entity-x402.floot.app/llms-full.txt
- https://pa-entity-x402.floot.app/skill.txt
- https://pa-entity-x402.floot.app/.well-known/x402
- https://pa-entity-x402.floot.app/.well-known/x402.json
- https://pa-entity-x402.floot.app/.well-known/x402-services.json
- https://pa-entity-x402.floot.app/.well-known/x402-service.json
- https://pa-entity-x402.floot.app/.well-known/x402-catalog.json
- https://pa-entity-x402.floot.app/.well-known/security.txt

The canonical extensionless x402 document is live. Floot serves that extensionless file as `application/octet-stream`; the JSON aliases return `application/json`.

## Independent validation snapshot

Latest completed checks after the hardened production release:

- Coinbase/CDP validator:
  - $0.005 enriched route: **valid=true**, simulation **accepted**
  - $0.001 best-match route: **valid=true**, simulation **accepted**
- Market402:
  - both routes: **11/11** instant spec checks
  - both routes are queued for scheduled independent probing
- Agent402:
  - current origin registration: **listed=true**
  - seller: **routable=true**
  - paid tools indexed: **2**
  - current crawl health: **0.4**, reflecting older failed crawls still present in its five-crawl history
  - remaining route-execution blocker: **settlement_required**, not discovery failure
- nohumans.directory:
  - $0.005 listing: **verified**, score about **0.990**, zero consecutive failures
  - $0.005 listing ranks about **#2** for both “Pennsylvania business registry” and “company identity Pennsylvania”
  - $0.001 best-match listing id `9f2f7a33-cb2`: submitted with request schema, response schema, and executable sample URL; awaiting its initial probe streak
- 402 Index:
  - $0.005 service: active + healthy
  - $0.001 best-match service id `07c46db0-c899-4475-8a1b-2a789021eeff`: active + healthy immediately after registration
  - “Pennsylvania business registry”: $0.005 rank **#1**, $0.001 rank **#2**
  - “best Pennsylvania company match”: $0.001 rank **#1**
- true402:
  - registered, but still has no transaction history
- x402scan:
  - previously registered; its registration endpoint now requires SIWX wallet authentication, so the origin was not re-submitted during this release

## Revenue

PayAI public resource statistics after the hardened release:

- settlements.total: **0**
- buyers.unique: **0**
- volume.totalUsd: **$0**
- reliability: **100**

Third-party revenue remains **$0.00** until an outside payer actually settles USDC.

## Public source and limitations

Pennsylvania Department of State registered-business data via data.pa.gov.

This is a factual registry lookup/enrichment API. It is not legal advice and should not be treated as proof of current good standing unless the underlying source explicitly establishes that fact.

## Wallet

Seller payout address:

```text
0x708f7b52b56eafd7fc1de65fc7752ed732914021
```

Base USDC contract:

```text
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
