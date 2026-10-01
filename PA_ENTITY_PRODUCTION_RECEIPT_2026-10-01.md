# PA Entity Lookup x402 — production release receipt

Date: 2026-10-01
Production origin: https://pa-entity-x402.floot.app
Floot project: b69a3ee6-eb01-430d-aa51-da2fc7beeac4

## Release execution

Starting Floot version:
- 1790814554317

Applied only the three remaining production deltas:

1. OpenAPI + already-safe supporting static files
   - patch: FLOOT_SAFE_PATCH_3_OPENAPI.txt
   - resulting Floot version: 1790877614439
   - inline typecheck: clean

2. x402 JSON aliases
   - patch: FLOOT_SAFE_PATCH_5_X402_ALIASES.txt
   - resulting Floot version: 1790877621315
   - inline typecheck: clean

3. canonical extensionless x402 manifest
   - patch: FLOOT_SAFE_PATCH_7_EXTENSIONLESS.txt
   - resulting Floot version: 1790877630633
   - inline typecheck: clean

Focused endpoint typecheck:
- endpoints/pa-business_GET.ts: clean
- endpoints/pa-entity-one_GET.ts: clean

Floot checkpoint:
- title: Hardened x402 discovery release
- id: 3af36d5b-d836-4ba0-a463-15540dbb8afb

Production publish:
- job id: 4929b25b-42bc-42c9-a59c-d3592f3f5155
- result: succeeded
- live URL: https://pa-entity-x402.floot.app

No paid upgrade, boost, advertising, seller-funded verification, or self-funded x402 call was used.

## Independent production verification

GitHub Actions run:
- 36904054127
- conclusion: success

The first postdeploy run exposed a stale verifier assumption that required the extensionless manifest and x402.json to be byte-identical. Production was correct: the extensionless manifest is a fan-out two-resource canonical document while x402.json is a richer hybrid alias. The verifier was corrected to compare route/payment semantics and then passed.

Verified live:
- /openapi.json
- /llms.txt
- /skill.txt
- /.well-known/x402
- /.well-known/x402.json
- /.well-known/x402-services.json
- /.well-known/x402-service.json
- /.well-known/x402-catalog.json
- /.well-known/security.txt
- $0.005 unpaid route returns real HTTP 402 + PAYMENT-REQUIRED
- $0.001 unpaid route returns real HTTP 402 + PAYMENT-REQUIRED
- malformed payment remains 402
- decoded invalid payment remains 402 rather than fake verifier outage
- invalid signed retry query returns 400 before paid work
- oversized payment header is rejected safely
- GET CORS headers are present
- Market402 selftest passes for both Floot routes
- Coinbase/CDP x402 validation passes for both Floot routes
- PayAI public stats endpoint is readable

## Agent402 after release

Fresh self-registration:
- HTTP 200
- listed: true
- display name: PA Entity Lookup x402
- paid tools discovered: 2
- network: eip155:8453
- health: 1
- routable: true
- discovery path: /.well-known/x402
- five recent crawl outcomes: 1,1,1,1,1

Current dispatch gate:
- settlement_required
- not a crawl or protocol failure
- route results expose unprovenTier=true for the low-price routes, but executeViaCallableNow remains false until Agent402's routing conditions are met

Fresh Agent402 query: Pennsylvania business registry
- Floot $0.001 best-match route: rank #1
- Floot $0.005 enriched route: rank #3

## 402 Index after release

Fresh buyer-query ranks:

Pennsylvania business registry:
- $0.001 best match: #1
- $0.005 enriched: #2

company identity Pennsylvania:
- $0.005 enriched: #1
- $0.001 best match: #2

vendor verification Pennsylvania:
- $0.005 enriched: #2
- $0.001 best match: #3

Health:
- both services healthy
- both x402_payment_valid=1
- $0.005 reliability score: 80
- $0.001 reliability score: 77

## nohumans.directory

Main $0.005 listing:
- status: verified
- score: 0.9997690687631355
- probes: 77 total / 72 passing
- consecutive failures: 0
- evidence tier: probe_verified
- paid_verified: false
- distinct_payers: 0
- onchain_unique_payers_30d: 0

Best-match $0.001 listing:
- status: verified
- score: 1.0
- probes: 38 / 38 passing
- consecutive failures: 0
- evidence tier: probe_verified
- paid_verified: false
- distinct_payers: 0
- onchain_unique_payers_30d: 0

## PayAI commercial counters

$0.005 route:
- settlements: 0
- unique buyers: 0
- volume: $0
- reliability: 100

$0.001 route:
- settlements: 0
- unique buyers: 0
- volume: $0
- reliability: 100

## Commercial truth

Third-party settled calls: 0
Distinct third-party payers: 0
Revenue: $0.00

Technical verification, rankings, registrations, self-tests, simulations, and unpaid probes are not revenue.


## Post-release zero-spend acquisition

24K Labs / Gold-402 free probe at 2026-10-01T18:09Z:
- $0.001 best-match: LIVE 402, correct Base/USDC terms, canonical manifest found with 2 resources, gold402 listed=false
- $0.005 enriched: LIVE 402, correct Base/USDC terms, canonical manifest found with 2 resources, gold402 listed=false
- Gold-402 GitHub submission attempted through the connected GitHub integration; write failed HTTP 403 Resource not accessible by integration. No email or paid workaround used.

Market402 post-release:
- $0.001 best-match selftest: 11/11, spec_compliant
- $0.005 enriched selftest: 11/11, spec_compliant
- both final URLs resubmitted successfully
- both returned already_listed=true and remain queued for Market402's own scheduled unpaid probes
- no paid probe or seller-funded action used
