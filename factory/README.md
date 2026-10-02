# x402 Product Factory

Migration-ready scaffold for a future dedicated `x402-product-factory` repository.

## Mission

Build narrow, deterministic, machine-purchasable decision tools for autonomous agents while sharing one hardened x402, evidence, source-adapter, test, and discovery layer.

## Current portfolio

| # | Product | Status | Route | Price |
|---|---|---|---|---:|
| 001 | PA Entity Lookup | production reference | `/_api/pa-entity-one` | $0.001 |
| 002 | PA Vendor Intake Gate | production reference | `/api/vendor-intake-gate` | $0.020 |
| 003 | PA Vendor Identity Match | live-source-verified staging | `/api/pa-vendor-identity-match` | $0.005 |
| 004 | PA Business Address Match | live-source-verified staging | `/api/pa-business-address-match` | $0.003 |
| 005 | PA Business Domain Match | live-source-verified staging | `/api/pa-business-domain-match` | $0.003 |
| 006 | SEC Filing Freshness Check | source-contract-verified staging | `/api/sec-filing-freshness` | $0.005 |
| 007 | Domain Registration Age | live-source-verified staging | `/api/domain-registration-age` | $0.002 |
| 008 | Treasury Average Rate Threshold | live-source-verified staging | `/api/treasury-average-rate-threshold` | $0.003 |
| 009 | OFAC Name Review Gate | live-source-verified staging | `/api/ofac-name-review-gate` | $0.003 |
| 010 | PA Business Formation Age | live-source-verified staging | `/api/pa-business-formation-age` | $0.002 |

Product 001 has an independently verified third-party Base USDC settlement and remains the payment/distribution reference.

## Product 003

Combines:
- Pennsylvania Department of State registry identity
- U.S. Census address consistency
- authoritative RDAP registration
- company/domain name alignment

Returns:
- `consistent`
- `human_review`

No automatic rejection.

## Product 004

A cheaper unbundled address-only check.

Combines:
- Pennsylvania Department of State registry identity
- U.S. Census address consistency

Returns:
- `match`
- `human_review`

No automatic rejection.

## Product 005

A cheaper company + domain identity check.

Combines:
- Pennsylvania Department of State registry identity
- IANA bootstrap + authoritative RDAP
- deterministic company/domain name alignment

Returns:
- `match`
- `human_review`

No automatic rejection.

## Product 006

A filing-metadata freshness decision using SEC EDGAR.

Inputs:
- exactly one of ticker or CIK
- optional exact form filter
- freshness window 1–365 days

Returns:
- `recent_filing`
- `no_recent_filing`
- `company_not_found`

SEC transport was proven with the existing production-style declared client identity, but the factory adapter now requires a contact-email `SEC_USER_AGENT` before live calls. Deterministic/source-contract tests pass; no contact email is invented or embedded.

## Product 007

Authoritative domain registration age via IANA bootstrap + registry RDAP.

Returns:
- `established`
- `recent_registration`
- `unregistered`
- `human_review`

Live smoke for `openai.com`: registration date `2007-01-19`, decision `established`.

## Product 008

Official U.S. Treasury monthly average-rate threshold decision.

Returns:
- `threshold_met`
- `threshold_not_met`
- `human_review`

Live smoke: `Total Marketable` rate `3.475%` for record date `2026-08-31`.

## Product 009

Deterministic current OFAC SDN primary-name and alias screening.

Returns:
- `candidate_found`
- `no_candidate`

Live smoke: the neutral query `OpenAI OpCo` at threshold `90` completed against the current OFAC SDN/ALT files and returned `no_candidate`.

That verifies source transport and deterministic decision execution only. A candidate is not a legal sanctions determination. A no-candidate result is not sanctions clearance. OFAC 50 Percent Rule ownership analysis is not included.

## Product 010

Pennsylvania Department of State formation-age threshold.

Returns:
- `established_entity`
- `recent_entity`
- `company_not_found`
- `human_review`

Live smoke for `OpenAI OpCo` observed creation date `2025-09-29` and returned `established_entity` at a 30-day threshold.

Formation age is an identity/history signal only and does not establish current good standing, ownership, authority, legitimacy, fraud risk, sanctions status, creditworthiness, or legal compliance.

## Shared layers

- `packages/x402/payment.js` — hardened Base USDC verify/settle flow
- `packages/sources/contracts.js` — normalized evidence adapter contract
- `packages/sources/live-pa-identity.js` — direct PA Open Data, Census, and authoritative RDAP adapters
- `product-registry.json` — canonical product IDs/routes/prices/statuses
- `scripts/validate-registry.js` — collision/integrity gate
- product-specific deterministic release gates
- coordinated zero-spend live-source smokes
- resource-level x402 `accepts[]` metadata for Bazaar-compatible discovery

## Payment invariants

Default production rail:
- network: `eip155:8453`
- asset: Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- payTo: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`

Products follow:
`402 -> validate input -> verify payment -> source work -> settle -> 200`.

Required-source transport failure is non-chargeable and must not settle.

## Current deployment blocker

AppDeploy reported an account-wide Free tier pause with weekly reset at:

`2026-10-05T00:00:00Z`

No upgrade/payment has been authorized. Products 003–010 therefore remain staging candidates rather than production claims.

## Branch isolation

All factory development in this workspace is isolated to:

`x402-product-factory-bootstrap`

The existing production `main` branch is not the integration target for unfinished factory products.

See each product's `DEPLOYMENT_PLAN.md` and release gate before any production change.
