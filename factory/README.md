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

No upgrade/payment has been authorized. Products 003 and 004 therefore remain staging candidates rather than production claims.

## Branch isolation

All factory development in this workspace is isolated to:

`x402-product-factory-bootstrap`

The existing production `main` branch is not the integration target for unfinished factory products.

See each product's `DEPLOYMENT_PLAN.md` and release gate before any production change.
