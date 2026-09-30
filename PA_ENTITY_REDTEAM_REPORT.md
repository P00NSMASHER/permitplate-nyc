# PA Entity Lookup x402 — Red-team report

Date: 2026-09-30

Target:
https://pa-entity-x402.floot.app

Paid route:
GET /_api/pa-business?q=NAME&limit=N

Price:
$0.005 USDC on Base (eip155:8453)

PayTo:
0x708f7b52b56eafd7fc1de65fc7752ed732914021

## Executive result

No tested payment bypass exposed paid registry data without a real payment authorization.

The live seller correctly blocks:
- paid=true query spoofing
- x402-settled header/query spoofing
- PAYMENT-RESPONSE spoofing
- Authorization spoofing
- X-HTTP-Method-Override spoofing
- x-floot-status spoofing
- Range requests
- HEAD requests without payment

Oversized ~93 KB payment headers are rejected by the edge before reaching the app.

The main weaknesses were payment-state recovery, discovery, and machine-facing consistency rather than unauthorized access.

## High severity

### 1. Unresolved settlement can lead to a fresh payment challenge

Risk:
The previous implementation treated a non-success settle response as another 402. That is unsafe for settlement_pending and duplicate_settlement because the original authorization may still settle.

PayAI's current contract says:
- settlement_pending is unresolved
- duplicate_settlement can be in-flight/replay state
- identical settlement bodies are idempotent
- callers should reconcile the same authorization instead of generating a new one

Hardened fix:
- bounded retries of the identical settlement request
- unresolved result => 503 + Retry-After
- no PAYMENT-REQUIRED header on unresolved state
- retrySamePayment=true
- only terminally unusable settlement outcomes return a fresh 402

Regression coverage:
scripts/test-pa-entity-floot-release.mts

### 2. Canonical x402 discovery paths are absent in production

Observed live:
- /.well-known/x402 => 403 AccessDenied
- /.well-known/x402.json => 403 AccessDenied
- /.well-known/x402-services.json => 403 AccessDenied

Impact:
Agent402 reads the OpenAPI and extracts the paid route but still marks:
- routable=false
- routerDispatchEligible=false
- routerDispatchReason=crawl_failed

Prepared fix:
- x402.json fixture
- x402-services.json fixture
- attempt extensionless /.well-known/x402 after Floot reset
- manifest already validated against Agent402's current parser

### 3. Invalid signed payment is misclassified as verifier outage

Observed:
Sending a base64-decoded empty object caused the live seller to return:
503 payment_verifier_unavailable

Direct PayAI response for the same malformed verification body:
HTTP 400
{
  "isValid": false,
  "invalidReason": "invalid_payload",
  "invalidMessage": "x402Version: Invalid input"
}

Cause:
The seller discarded structured x402 error bodies on non-2xx facilitator responses.

Hardened fix:
- parse PayAI JSON regardless of HTTP status
- isValid:false => 402 with invalidReason
- network/unknown verifier response => 503
- no generic success=true acceptance

Regression coverage:
scripts/test-pa-entity-floot-release.mts

## Medium severity

### 4. /skill.md is not a skill document

Observed:
GET /skill.md => 200 text/html
Body is the Floot SPA shell.

Impact:
x402-catalog.json advertises a machine-readable skill URL that returns HTML.

Fix:
- stop advertising /skill.md
- point discovery to:
  https://raw.githubusercontent.com/P00NSMASHER/permitplate-nyc/main/PA_ENTITY_SKILL.md
- remove /skill.md from sitemap

### 5. Browser CORS path is incomplete

Observed:
OPTIONS returns 204, but expected x402 CORS headers were not exposed on live responses.

Fix:
explicit OPTIONS endpoint and CORS on all paid responses:
- Access-Control-Allow-Origin: *
- GET, OPTIONS
- allow PAYMENT-SIGNATURE / X-PAYMENT
- expose PAYMENT-REQUIRED / PAYMENT-RESPONSE / x402-settled / Retry-After

### 6. Discovery metadata version ambiguity

Current custom x402-service.json uses:
"x402": "1.0"

while the live payment protocol is x402 v2.

Fix:
retain the custom manifest version for compatibility but add:
- x402Version: 2
- protocol.name: x402
- protocol.version: 2

### 7. Bazaar example currently shows an empty OpenAI result

Live challenge advertises an example with:
count: 0
results: []

But the official Pennsylvania source has:
Openai, L.l.c.
filing 0014371957

Fix:
replace with a real representative successful result.

### 8. Input validation can waste verifier calls

Previous flow allowed some malformed paid retries to reach PayAI before query normalization.

Fix:
- unpaid requests still get 402 first for x402 discovery compatibility
- once PAYMENT-SIGNATURE is present, validate q and limit before contacting PayAI
- q max 120
- strict integer limit 1-25
- strip SQL wildcard characters and controls

### 9. No explicit dependency timeouts

Fix:
- PayAI timeout 6 seconds
- PA Open Data timeout 10 seconds
- unresolved settlement transport errors return same-payment retry semantics

## Low severity / routing issues

### 10. /api/pa-business returns SPA HTML

Observed:
GET /api/pa-business?q=OpenAI&limit=1 => 200 HTML app shell

No paid data is leaked, but this can confuse generic API crawlers.

Target route remains:
GET /_api/pa-business

### 11. Missing optional well-known surfaces

Observed 403:
- /.well-known/agent-card.json
- /.well-known/agent.json
- /.well-known/security.txt

Prepared fixtures:
- agent-card.json
- security.txt

### 12. Agent402 OpenAPI fallback remains partially broken upstream

Fresh Agent402 registration after its OpenAPI fallback changes:
- toolCount=1
- paidToolCount=1
- route, price, network, payTo, requestContract, responseContract all parsed
- discoveryPath=/openapi.json

But seller still reads:
- routable=false
- routerDispatchReason=crawl_failed

because the canonical manifest 403 remains fatal.

This is mitigated by publishing canonical aliases at the seller. The connected GitHub integration cannot open an issue in the Agent402 repo.

## Product-quality improvement included with the repair

The official Pennsylvania current-business dataset also exposes:
- creationdate
- county_code
- party_type
- first_name
- middle_name
- last_name

Benchmarks from 2026-09-30:

Starts-with entity search:
- OpenAI ~0.114 s
- Sheetz ~0.185 s
- Wawa ~0.200 s

Batched principal lookup:
- 3 filing numbers ~0.442 s
- 5 filing numbers ~0.740 s

Release design:
- starts-with search first
- contains fallback only when needed
- normalized legal-name ranking
- dedupe by filing number
- grouped principal/officer rows
- preserve every existing response field
- add creationDate, countyCode, principals
- disclose enrichment status

## Current live commercial state

PayAI resource stats observed during red team:
- settlements.total: 0
- volume.totalUsd: $0
- buyers.unique: 0
- reliability: 100

Revenue remains $0 until a real third-party settlement occurs.

## Release assets

Hardened source:
docs/pa-entity-floot-release/

Permanent tests:
- scripts/test-pa-entity-floot-release.mts
- scripts/test-pa-entity-discovery-fixtures.mjs

Permanent CI:
.github/workflows/pa-entity-release-regression.yml

Deployment mapping:
docs/pa-entity-floot-release/README.md

## Production gate

Do not publish the release as successful until all of these pass:

1. Floot typecheck.
2. Production publish succeeds.
3. OpenAPI/LLM/discovery files return correct MIME types.
4. Canonical x402 aliases return 200 JSON.
5. External unpaid call returns real HTTP 402.
6. PAYMENT-REQUIRED header/body parity.
7. Invalid payment returns 402, not 503.
8. Invalid paid query does not call facilitator.
9. PA source failure does not settle.
10. settlement_pending does not produce a new payment challenge.
11. success returns PAYMENT-RESPONSE and x402-settled:true.
12. Coinbase/CDP validator valid=true and simulation accepted.
13. AgentCash still discovers the paid route.
14. Agent402 registration is rechecked.
15. x402scan is refreshed.
16. nohumans/402 Index ranking is rechecked.
17. Revenue is only increased after an independent buyer settlement.
