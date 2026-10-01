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

## Zero-cost live mirror

A second production origin is live on AppDeploy so the service can keep improving while Floot's daily build quota is unavailable:

```text
https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s
```

Paid routes:

- $0.001 best match: `GET /api/pa-entity-one?q=NAME`
- $0.005 enriched search: `GET /api/pa-business?q=NAME&limit=N`

Discovery:

- OpenAPI: `/openapi.json`
- canonical x402 manifest: `/.well-known/x402`
- JSON aliases: `/.well-known/x402.json` and `/.well-known/x402-services.json`

The mirror preserves the same Base USDC asset, payout wallet, PayAI facilitator, payment-state protections, strict input validation, and Pennsylvania Department of State source. Its public preview is sample-only: OpenAI, Sheetz, and Wawa are fixed cached examples; arbitrary company names return HTTP 400 and must use the paid x402 routes.

Independent checks on 2026-10-01:

- AppDeploy deployment: ready; no frontend/backend errors
- Agent402: listed, health 1, routable, two paid tools observed
- Agent402 fresh crawl: the $0.001 best-match route ranks **#1** for `Pennsylvania business registry`, **#1** for `company identity Pennsylvania`, and **#1** for `vendor verification Pennsylvania`; health 1; unproven-tier eligible
- Market402: both routes pass 11/11 self-test checks and are queued for Market402's own probes
- Coinbase/CDP: both routes return `valid: true` with accepted simulation
- Circle agent-readiness score against the hosted OpenAPI: **93/100, grade A, tier strong**
- nohumans.directory buyer search: the $0.001 AppDeploy best-match route is currently the first result for `Pennsylvania business registry`; the Floot $0.005 route is second and the Floot $0.001 route is third
- PayAI public stats: zero settlements, zero distinct buyers, $0 volume at the latest check

The remaining Agent402 dispatch gate is independent settlement history (`settlement_required`), not crawl health. No self-funded settlement is being used to manufacture that history.

## External status — 2026-10-01

### Agent402

- origin crawl: healthy
- health: 1
- routable: true
- paid tools discovered: 2
- $0.001 best-match route ranked first for `Pennsylvania business registry`, `company identity Pennsylvania`, and `vendor verification Pennsylvania` after the fresh 2026-10-01 crawl
- current router gate: `settlement_required`
- the seller is eligible for Agent402's low-price unproven tier, but proven sellers are preferred until independent settlement history exists

### ag3ntsearch

Two machine-signed, public-evidence contributions nominating the $0.001 route for independent re-execution were accepted into ag3ntsearch's review intake on 2026-10-01:

- Floot receipt: `contribution:2026-10-01T13:38:23.066Z:244eccd0-c9ce-43da-af59-a541dde5f632`
- AppDeploy mirror receipt: `contribution:2026-10-01T14:53:23.291Z:90ea1a5d-f6db-4ee9-969e-47c072985e7a`
- current status on both submissions: `received_unreviewed`
- reference task: pay 0.001 USDC with a funded Base wallet and no API key/account, then read one Pennsylvania registry result

These receipts are **not** verification, endorsement, paid calls, or revenue events. They are attributed nominations that ag3ntsearch may independently re-run.

### Coinbase/CDP

Both the $0.005 enriched route and $0.001 best-match route pass x402 validation with `valid: true` and accepted simulation.

### Market402

- Floot $0.005 route: 11/11 self-test checks pass
- Floot $0.001 route: 11/11 self-test checks pass
- AppDeploy $0.005 route: 11/11 self-test checks pass
- AppDeploy $0.001 route: 11/11 self-test checks pass
- all four were accepted/queued for normal unpaid probes
- funded paid-probe qualification is currently **false** with reason `not_in_catalog`
- Market402 says paid-probe qualification will be re-evaluated automatically when the resource appears in its weekly refreshed public Bazaar catalog
- no seller-funded probe was used

### PayAI Bazaar

PayAI now supports verify-only cataloging for GET resources, so a settlement is not strictly required to create a Bazaar row. A zero-spend verify-only trigger was tested against both AppDeploy paid routes with an ephemeral unfunded Base wallet using the official x402 client. The client echoed the Bazaar declaration correctly, but PayAI rejected verification with `invalid_exact_evm_insufficient_balance`; `/discovery/listing-status` remained 404 for both resources.

Conclusion: the verify-only path moves no funds, but still requires a verifier-valid payer authorization with sufficient USDC balance. Under the standing $0-additional-spend rule and without using a funded signing wallet, this path is exhausted. No funds moved, no listing was manufactured, and the attempt is not counted as payment or revenue.

### nohumans.directory

Current buyer search for `Pennsylvania business registry` returns our $0.001 AppDeploy best-match route first, the Floot $0.005 route second, and the Floot $0.001 route third.

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

### Cinderwright

A previous submission was accepted into Cinderwright's queue, but the current public `/discover` endpoint returns zero matches for the PA Entity mirror and the previously tested `/onchain` path now returns 404. Treat this lane as non-actionable until Cinderwright exposes a current discoverable record or supported status path.

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
