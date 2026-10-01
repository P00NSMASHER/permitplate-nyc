# PA Entity x402 production release receipt — 2026-10-01

Verified at: 2026-10-01 14:05 ET

Production origin:
https://pa-entity-x402.floot.app

## Release result

Floot republish succeeded after the free daily action reset.

The production verifier passed all 22 checks with zero failures.

Verified production properties:

- OpenAPI is live and parses correctly.
- llms.txt is plain text.
- skill.txt is real text, not the SPA shell.
- /.well-known/x402 is live and valid JSON.
- /.well-known/x402.json is live and valid JSON.
- /.well-known/x402-services.json is live and valid JSON.
- /.well-known/x402-service.json is live and valid JSON.
- /.well-known/x402-catalog.json is live and valid JSON.
- /.well-known/security.txt is live.
- GET /_api/pa-business returns a real unpaid HTTP 402 with PAYMENT-REQUIRED.
- GET /_api/pa-entity-one returns a real unpaid HTTP 402 with PAYMENT-REQUIRED.
- Main route price remains $0.005 USDC / 5000 atomic.
- Best-match route price remains $0.001 USDC / 1000 atomic.
- Network remains Base mainnet eip155:8453.
- Base USDC asset remains 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
- payTo remains 0x708f7b52b56eafd7fc1de65fc7752ed732914021.
- GET responses expose x402 CORS headers.
- malformed payment stays 402.
- decoded-but-invalid payment stays 402 rather than being misclassified as verifier outage.
- invalid signed retry query returns 400 before paid work.
- oversized payment header is safely rejected.
- Market402 self-test passes for both routes.
- Coinbase/CDP x402 validation passes for both routes.

Floot serves the extensionless /.well-known/x402 file as application/octet-stream, but the body is valid JSON and the production verifier accepts the platform limitation.

## Agent402 post-deploy readback

Fresh registration:
- listed: true
- displayName: PA Entity Lookup x402
- toolCount: 2
- networks: eip155:8453
- routable: true
- health: 1

For query `Pennsylvania business registry`:
- Floot $0.001 best-match route ranked #1.
- Floot $0.005 enriched route ranked #3 in the returned Agent402 set.

For query `company identity Pennsylvania`:
- Floot $0.001 best-match route ranked #1.

Remaining Agent402 dispatch gate:
- routerDispatchReason: settlement_required
- unproven tier: true
- unprovenMaxUsd: 0.01

This is a settlement-history gate, not a crawl-health or metadata failure.

## nohumans.directory readback

Main $0.005 listing:
- id: 958fd262-287
- status: verified
- score: 0.9997690687631355
- probes: 77 total / 72 passing
- consecutive failures: 0
- evidence tier: probe_verified
- paid verified: false
- distinct payers: 0
- onchain unique payers 30d: 0

Best-match $0.001 listing:
- id: 9f2f7a33-cb2
- status: verified
- score: 1.0
- probes: 38 / 38 passing
- consecutive failures: 0
- evidence tier: probe_verified
- paid verified: false
- distinct payers: 0
- onchain unique payers 30d: 0

## 402 Index readback

Query: Pennsylvania business registry
- #1: $0.001 best-match service
- #2: $0.005 entity-lookup service

Query: company identity Pennsylvania
- #1: $0.005 entity-lookup service
- #2: $0.001 best-match service

Query: vendor verification Pennsylvania
- #2: $0.005 entity-lookup service
- #3: $0.001 best-match service

Both services report:
- health_status: healthy
- x402_payment_valid: 1
- reliability_score: 77

## Market402 refresh

Both production routes were re-submitted after republish.

Main $0.005 route:
- submission accepted
- already_listed: true
- fresh instant check: 11/11 pass
- verdict: spec_compliant
- queued for normal scheduled probe

Best-match $0.001 route:
- submission accepted
- already_listed: true
- fresh instant check: 11/11 pass
- verdict: spec_compliant
- queued for normal scheduled probe

No payment was attached to these submissions.

## PayAI public settlement stats

Main route:
- settlements total: 0
- unique buyers: 0
- total volume: $0
- reliability: 100

Best-match route:
- settlements total: 0
- unique buyers: 0
- total volume: $0
- reliability: 100

## Commercial scoreboard

Third-party settled calls: 0
Distinct third-party payers: 0
Recorded revenue: $0.00

Directory listings, probes, validation, registration, simulated acceptance, and self-tests are not counted as revenue.

## Release fingerprint

Current approved Floot release fingerprint:
f287450bbad293b8efe3bf628b53744a33ce67427e63f4eabb52a2389f47a9f7

Current-head Floot patch integrity before deployment:
- 15 / 15 files exact
- 7 safe patch chunks
- release regression: success
- deterministic regression: success

## Next commercial gate

The technical/discovery release is no longer the primary blocker.

The primary blocker is the first independent third-party settlement that produces real payer history without seller funding.
