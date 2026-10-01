# PA Entity Lookup x402

A pay-per-call Pennsylvania business-registry lookup for autonomous agents.

## Live endpoints

### $0.001 best match

```text
GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=NAME
```

Returns one highest-ranked Pennsylvania legal-entity match.

### $0.005 enriched search

```text
GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10
```

Returns up to 25 ranked Pennsylvania entity candidates.

Both routes use x402 v2 on Base mainnet (eip155:8453), Base USDC, and require no API key or account. An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED challenge.

## Buyer task examples

The $0.001 route is the lowest-friction choice when an agent needs one likely Pennsylvania entity rather than a candidate list. High-intent tasks include:

- one Pennsylvania legal entity
- Pennsylvania business registry best match
- Pennsylvania business best match
- Pennsylvania legal entity lookup
- Pennsylvania filing-number lookup

Use the $0.005 route when the buyer needs multiple candidates, richer comparison, or a broader company-name search.

## Data returned

The enriched schema includes:

- business name
- filing number
- registration type
- creation date
- registered address
- city/state/ZIP
- county and county code
- source-published principal/officer role and name records

Source: Pennsylvania Department of State public business-registration data via data.pa.gov.

The service does not claim current good standing, sanctions status, a legitimacy/risk score, or independent proof of current management authority.

## Machine discovery

- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- skill: https://pa-entity-x402.floot.app/skill.txt
- canonical x402 manifest: https://pa-entity-x402.floot.app/.well-known/x402
- JSON alias: https://pa-entity-x402.floot.app/.well-known/x402.json
- service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json
- catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json

## External status — 2026-10-01

### Agent402

- origin crawl: healthy
- health: 1
- routable: true
- paid tools discovered: 2
- main route ranked first for the query `Pennsylvania business registry`
- current router gate: `settlement_required`
- the seller is eligible for Agent402's low-price unproven tier, but proven sellers are preferred until independent settlement history exists

### ag3ntsearch

A machine-signed, public-evidence contribution nominating the $0.001 route for independent re-execution was accepted into ag3ntsearch's review queue on 2026-10-01.

- receipt: `contribution:2026-10-01T13:38:23.066Z:244eccd0-c9ce-43da-af59-a541dde5f632`
- status: `received_unreviewed`
- reference task: pay 0.001 USDC with a funded Base wallet and no API key/account, then read one Pennsylvania registry result

This is **not** a verification, endorsement, paid call, or revenue event. It is only an attributed nomination that ag3ntsearch may independently re-run.

### Coinbase/CDP

Both the $0.005 enriched route and $0.001 best-match route pass x402 validation with `valid: true` and accepted simulation.

### Market402

- $0.005 route: 11/11 self-test checks pass
- $0.001 route: 11/11 self-test checks pass
- $0.001 route submitted and queued for Market402's own scheduled probes
- Market402 verification is not seller-controlled and requires their own real paid purchase

### nohumans.directory

Main $0.005 listing:
- id: `958fd262-287`
- status: verified
- score: ~0.999
- paid-verified: false
- distinct payers: 0

Best-match $0.001 listing:
- id: `9f2f7a33-cb2`
- status: verified
- score: 1.0
- probes: 26/26 passing at the latest read
- paid-verified: false
- distinct payers: 0
- payment terms observed correctly at 1000 atomic Base USDC

### 402 Index

Best-match service:
- id: `07c46db0-c899-4475-8a1b-2a789021eeff`
- status: active
- health: healthy
- x402 payment valid: yes
- price: $0.001 USDC

### true402

The origin listing now advertises the $0.001 best-match route as its front door.

### x402dash

The $0.001 route is already registered.

### x402scan

The origin was registered previously. As of 2026-10-01, its refresh endpoint requires SIWX wallet authentication, so no unauthenticated refresh was forced.

## Payment reliability

The seller now:
- parses PayAI structured invalid-payment responses even on non-2xx facilitator responses;
- does not treat a generic `success:true` as verification;
- retries unresolved settlement using the same authorization;
- does not issue a fresh payment challenge for `settlement_pending` or duplicate settlement;
- avoids settlement when the primary PA registry lookup fails;
- applies bounded facilitator/source timeouts;
- blocks malformed query/limit input before facilitator work once a payment header is present.

## Current commercial scoreboard

As of 2026-10-01:

- third-party settled calls: **0**
- distinct third-party payers: **0**
- PayAI-recorded revenue: **$0**
- nohumans paid verification: **not yet**
- Market402 paid verification: **not yet**

Technical verification, directory registration, probes, and self-tests are not counted as revenue.

## Payout

Seller payout address:

```text
0x708f7b52b56eafd7fc1de65fc7752ed732914021
```

Base USDC:

```text
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
