# Product 009 deployment plan — OFAC Name Review Gate x402

Status: **live-source-verified staging**. Production deployment is deferred while AppDeploy is account-limit paused.

## Contract

- Route: `GET /api/ofac-name-review-gate`
- Price: `$0.003 USDC`
- Atomic amount: `3000`
- Network: `eip155:8453`
- Inputs: `name`; optional `minScore` 70–100 (default 90)
- Completed decisions: `candidate_found`, `no_candidate`

## Authoritative source

Current U.S. Treasury OFAC Sanctions List Service:
- `SDN.CSV`
- `ALT.CSV`

The factory adapter downloads current primary SDN names and aliases and performs deterministic name similarity scoring across:
- exact normalized name
- sorted-token exact match
- containment
- edit similarity
- token Jaccard similarity

No LLM classification is involved.

## x402 ordering

`402 -> validate input -> verify payment -> OFAC source work -> settle -> 200`

- invalid input: HTTP 400, no settlement
- OFAC transport/contract failure: HTTP 502, `chargeable:false`, no settlement
- unresolved payment state: HTTP 503, retry the same payment authorization
- completed candidate/no-candidate screen: settle before HTTP 200

## Claim boundary

A `candidate_found` result is only a review signal. It is **not** a legal sanctions determination.

A `no_candidate` result is **not sanctions clearance**.

This product does not:
- perform OFAC 50 Percent Rule ownership analysis,
- resolve identity from name alone,
- establish whether a person/entity is legally blocked,
- replace review of identifiers, addresses, dates of birth, program tags, ownership, or other context.

## Live verification

GitHub Actions current OFAC smoke:
- query: `VLADIMIR PUTIN`
- threshold: `90`
- decision: `candidate_found`
- candidate count: `1`
- observed candidate: `PUTIN, Vladimir Vladimirovich`
- matched alias: `PUTIN, Vladimir`
- score: `99`
- source: current U.S. Treasury OFAC SDN list
- limitations returned with the result explicitly state no legal determination, no sanctions clearance, and no 50 Percent Rule analysis.

The live smoke asserts only that the current public list returns a review candidate. It does not independently characterize anyone's legal status.

## Deployment blocker

AppDeploy weekly Free-tier pause reported through `2026-10-05T00:00:00Z`. No paid upgrade is authorized.

## Post-deploy acceptance

1. Unpaid request returns exact 402 / 3000 atomic Base USDC.
2. Invalid name/minScore does not verify or settle.
3. OFAC transport failure does not settle.
4. Completed screen settles before 200.
5. Resource-level `accepts[]` appears in discovery catalog.
6. OpenAPI and agent docs preserve the review-only/no-clearance limitation.
7. Products 001–008 remain unchanged.
