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

## Agent-loop vendor intake gate — 2026-10-02

The AppDeploy production mirror now includes a composed vendor-intake check intended for an autonomous agent's working loop rather than a raw-data lookup.

### $0.020 vendor-intake gate

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN
```

Inputs:
- prospective vendor name
- U.S. vendor address
- domain name

Output:
- `decision: "proceed" | "human_review"`
- `agentAction: "continue_vendor_intake" | "pause_and_request_human_review"`
- explicit `reviewTriggers`
- structured evidence from Pennsylvania registry identity, Census address consistency, OFAC SDN candidate-name screening, and RDAP registration

The existing $0.001 and $0.005 Pennsylvania lookup routes are unchanged.

The gate is deliberately conservative. It never returns an automatic legal/compliance rejection. `proceed` only means the configured automated intake checks did not trigger review. It is not legal advice, sanctions clearance, fraud approval, credit approval, proof of good standing, or proof that a vendor owns an address or domain.

Current fail-closed automatic-review rules:
- PA registry: automatic continuation requires exactly one strong legal-entity candidate plus complete core identity evidence (business name, filing number, registration type, usable registered address); missing, ambiguous, weak, or incomplete registry evidence -> human review
- Census: both submitted-address and registry-address responses must satisfy the evidence contract; matched addresses must include normalized address text and numeric coordinates; automatic continuation additionally requires matching primary street number + ZIP and <=0.25-mile coordinate distance
- OFAC: the response must satisfy the expected query/threshold/count/candidate/source contract; incomplete evidence or any candidate at score 90 or above -> human review
- RDAP: the response must echo the requested domain and include boolean registration status, authoritative RDAP endpoint, and source; unregistered, incomplete, or vendor/domain-name-misaligned evidence -> human review

OFAC remains a first-pass candidate-name screen only. A no-candidate result is not sanctions clearance, and the tool does not perform OFAC 50 Percent Rule ownership analysis.

### Composition and payment behavior

The vendor gate is one outer x402 purchase at $0.020 USDC on Base. It reuses the live PA, Census, OFAC, and RDAP service implementations and identifies their independently paid production endpoints in its evidence. It does not attempt nested seller-funded x402 purchases between the seller's own services, which would create unnecessary double settlement/self-payment. Each standalone component's existing x402 endpoint and price remain unchanged.

Unpaid vendor-gate requests return a real HTTP 402 `PAYMENT-REQUIRED` challenge for 20,000 atomic Base USDC. Evidence collection happens before settlement; if a required evidence source fails, the outer payment is not settled.

### Working evidence

Current production checks on 2026-10-02 confirm:
- deployment status: ready
- AppDeploy frontend/backend/network QA errors: none
- `/.well-known/x402` advertises `/api/vendor-intake-gate` at $0.020
- OpenAPI version 2.2.0 exposes operationId `checkPennsylvaniaVendorIntakeGate` plus typed PA registry/Census/OFAC/RDAP evidence-completeness fields
- unpaid production calls use x402 v2 and return HTTP 402 with the $0.020 Base USDC payment requirement
- successful paid responses are wired to return `PAYMENT-RESPONSE` plus `x402-settled: true`

Three bounded free fixtures exercise the same decision engine without exposing arbitrary free vendor screening:

```text
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch
GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch
```

Expected decision evidence:
- `proceed` fixture -> `decision=proceed`, no review triggers, PA registry/Census/OFAC/RDAP evidence complete
- `address_mismatch` fixture -> `decision=human_review` with `registered_address_differs`
- `domain_mismatch` fixture -> `decision=human_review` with `domain_name_not_aligned`

Full reviewer checklist: [docs/vendor-intake-gate-evidence.md](docs/vendor-intake-gate-evidence.md)

No Agentic.ai resubmission has been made yet. The intended next external proof step is to add the gate to the working Floot bare-origin manifest after the Floot build quota resets, re-register that origin with Agent402, and only then resubmit the composed decision product.

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

## Current AppDeploy hosting availability — 2026-10-02

Independent GitHub cloud verification at `2026-10-02T12:51:06Z` found that all six AppDeploy-hosted paid APIs are currently paused by the platform edge:

- vendor-intake gate
- SEC recent filings
- Census geocoder
- OFAC SDN screen
- RDAP lookup
- Treasury average rates

Each returned:

- HTTP 402
- `x-appdeploy-app-availability: temporarily-unavailable`
- body code `APP_TEMPORARILY_UNAVAILABLE`
- **no** seller `PAYMENT-REQUIRED` header

The same check confirmed both Floot PA routes remain fully healthy x402 sellers with real `PAYMENT-REQUIRED` challenges.

AppDeploy's own public documentation states that hosted apps stop running when no usable account credits remain and automatically resume when usable credits return. The control plane can still report the stored deployment as `ready` while public hosting is unavailable.

Durable outage receipt:
`verification/x402-portfolio-verification-latest.json`

Until that receipt returns green again, AppDeploy routes must not be counted as currently sellable or independently verifiable. Floot remains the live production seller.

## Zero-cost live mirror

An AppDeploy mirror is retained with the deployed source below. **Its public hosting is currently paused by AppDeploy account-credit exhaustion, so these routes are not currently sellable even though the stored deployment reports ready:**

```text
https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s
```

Paid routes:

- $0.020 vendor-intake decision gate: `GET /api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN`
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
- PayAI resource-specific stats now show **1 settlement in the last 24h** on the Floot $0.001 best-match route. Base Blockscout independently shows one matching **0.001 USDC** transfer to the payout wallet at 2026-10-02T06:44:33Z from `0x7e6b6556322c4e26c567a867964ac793f5ee2b1c`. The payer is currently classified `external_unattributed`; it is not counted as verified-customer revenue.

Agent402 remains healthy/routable but its current Base router verdict is still `settlement_required`; one observed settlement has not cleared its settlement floor. No self-funded settlement is being used to manufacture that history.

## Fresh zero-spend directory snapshot — 2026-10-02

A GitHub-hosted read-only verification lane now captures current marketplace/index state in `verification/pa-entity-directory-status-latest.json` and separately classifies settlement provenance in `verification/x402-revenue-attribution-latest.json`.

Current raw-route evidence:
- 402 Index: Floot $0.005 enriched route ranks **#1** and $0.001 best match **#2** for `Pennsylvania business registry`; both are healthy and x402-payment-valid
- nohumans.directory: Floot $0.005 is probe-verified with 109/114 passing probes and zero consecutive failures; Floot $0.001 is probe-verified with **75/75** passing probes
- Agent402: Floot origin is healthy (`health=1`), routable, and still exposes 2 paid tools; vendor gate is not yet in the Floot manifest
- Market402 public index/search: vendor gate is still not independently visible
- 402 Index vendor-gate record previously registered at `0d49cbe9-4a47-42fa-9654-1c79090035e4` currently returns 404 and the gate is absent from buyer-style query results
- nohumans vendor-intake discovery does not currently surface the composed vendor gate

Settlement evidence:
- PayAI resource-specific stats for `https://pa-entity-x402.floot.app/_api/pa-entity-one`: 1 settlement in 24h / 7d / 30d; buyer bucket `1-9`
- matching on-chain transfer: **0.001 USDC**, tx `0x17985b16137ff8aef95641be06424a5fa4e9edacc6ade5aaf0a58d523ad1cd73`
- payer address: `0x7e6b6556322c4e26c567a867964ac793f5ee2b1c`
- payer classification: **external_unattributed**
- observed gross settlement value: **$0.001**
- verified-customer revenue counted: **$0**
- reason: the payer is external to the seller wallet and not present in repository/test history, but available public evidence does not yet prove whether it is a genuine end-customer agent versus an independent verifier/probe

The accounting rule is intentionally strict: unknown external payers, probes/verifiers, self-payments, tests, registrations, and marketplace checks do not count as customer revenue.

## External status — historical raw-endpoint evidence from 2026-10-01

The measurements below primarily describe the PA raw lookup routes before the hardened $0.020 vendor-intake gate was completed. They are retained as historical distribution evidence and **must not be read as independent verification of the composed gate**.

The gate itself has been submitted to Market402 (instant self-test passed 11/11) and 402 Index (registration accepted but pending because the shared AppDeploy domain cannot be seller-claimed). It has not yet been added to the Floot bare-origin manifest, independently routed by Agent402, paid-verified, or attributed a third-party buyer/revenue event.

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

### Circle agent-readiness

The live AppDeploy mirror was rescored after correcting `info.contact` placement and expanding the paid-response schemas to advertise the actual enriched fields. Current Circle score remains **93/100, grade A, tier strong**:

- Discovery & Structure: 30/30
- Payment Readiness: 40/40
- Agent Consumability: 23/30

The only point deductions are:
- no public contact email: 2 points
- no second blockchain payment rail: 5 points

Those are intentionally not being added. The service will not expose the user's personal email for a score, and it will not advertise an unsupported second payment chain. Circle also warns that the OpenAPI spec is below the shared AppDeploy host root rather than `https://api-v2.appdeploy.ai/openapi.json`; that host-level path is outside this app's control.

### ForgeMesh

ForgeMesh's current contribution rules accept an existing Base mainnet USDC transfer to the seller's live `payTo` as proof, provided it is at least the nominated endpoint price, has at least 10 confirmations, is no older than 30 days, and has not already been used by another seller.

The new transaction `0x17985b16137ff8aef95641be06424a5fa4e9edacc6ade5aaf0a58d523ad1cd73` transfers exactly **0.001 USDC** to the live payout wallet and satisfies the objective amount/confirmation/age requirements for the $0.001 Floot best-match route. A candidate seller record is prepared at `verification/forgemesh-pa-entity-seller.json` and is being checked against ForgeMesh's current upstream validator.

The no-cost submission path is a one-file GitHub fork/PR. The connected GitHub integration exposes PR creation but not repository forking, so submission transport remains blocked unless a compatible fork/write path becomes available. The alternative ForgeMesh submission endpoint costs $0.05 USDC and is not being used under the standing $0-spend rule.

### probe402

All four PA Entity paid URLs (AppDeploy $0.001/$0.005 and Floot $0.001/$0.005) currently return `kind: not-covered`, reason `not-in-seed-list` from probe402.

probe402 explicitly states that this is a coverage statement, **not** a negative health finding. Neither `api-v2.appdeploy.ai` nor `pa-entity-x402.floot.app` is in its current measurement seed for these routes. There is no seller-controlled free intake path currently being used, so this lane is externally controlled until its seed set changes.

### nohumans.directory

Fresh buyer-search measurements on 2026-10-01 show that the two Floot routes now occupy top-three positions across all four high-intent queries tested:

- `Pennsylvania business registry`: $0.005 route **#2**, $0.001 route **#3**
- `vendor verification Pennsylvania`: $0.005 route **#2**, $0.001 route **#3**
- `company identity Pennsylvania`: $0.001 route **#1**, $0.005 route **#3**
- `Pennsylvania legal entity lookup`: $0.005 route **#1**, $0.001 route **#3**

This is a material improvement from the earlier ~#50 placement.

Main $0.005 listing:
- id: `958fd262-287`
- status: verified
- score: `0.9997690687631355`
- probes: **77 total / 72 passing**
- consecutive failures: **0**
- evidence tier: `probe_verified`
- paid-verified: false
- distinct payers: 0

Best-match $0.001 listing:
- id: `9f2f7a33-cb2`
- status: verified
- score: **1.0**
- probes: **38/38 passing**
- consecutive failures: **0**
- evidence tier: `probe_verified`
- paid-verified: false
- distinct payers: 0
- payment terms observed correctly at 1000 atomic Base USDC

### 402 Index

Main and best-match services were both refreshed on 2026-10-01 and read back healthy with x402 payment validation passing and reliability score 77.

Fresh 2026-10-01 buyer-query ranks:
- `Pennsylvania business registry`: best-match **#1**, enriched search **#2**
- `company identity Pennsylvania`: enriched search **#1**, best-match **#2**
- `vendor verification Pennsylvania`: enriched search **#2**, best-match **#3**

Best-match service:
- id: `07c46db0-c899-4475-8a1b-2a789021eeff`
- status: active
- health: healthy
- x402 payment valid: yes
- price: $0.001 USDC

The live verification file is present at `/.well-known/402index-verify.txt`, and a fresh claim attempt returned `Domain already verified`. Treat the domain-claim requirement as satisfied even if a stale service field temporarily reports otherwise.

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

As of 2026-10-02:

- resource-specific x402 settlements observed: **1** on the Floot $0.001 best-match route
- matching Base USDC received on-chain: **$0.001**
- payer classification: **external_unattributed**
- verified-customer settled calls counted as revenue: **0**
- verified-customer revenue: **$0**
- vendor-intake-gate settlements: **0**
- vendor-intake-gate revenue: **$0**
- nohumans paid verification: **not yet**
- Market402 paid verification: **not yet**

The durable attribution receipt is `verification/x402-revenue-attribution-latest.json`. Only `verified_customer` settlements count as third-party revenue. Unknown external addresses, independent probes/verifiers, self-payments, tests, registrations, and marketplace checks remain excluded.

## Payout

Seller payout address:

```text
0x708f7b52b56eafd7fc1de65fc7752ed732914021
```

Base USDC:

```text
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
