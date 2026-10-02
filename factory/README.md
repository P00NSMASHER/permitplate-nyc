# x402 Product Factory

Migration-ready scaffold for a dedicated `x402-product-factory` repository.

## Mission
Build narrow, deterministic, machine-purchasable decision tools for autonomous agents.

## Reference product
PA Entity Lookup x402 is Product 001 and remains the production reference for:
- Base USDC payment behavior
- HTTP 402 handling
- discovery manifests
- marketplace distribution
- settlement verification

## Product 002
PA Vendor Gate — accepts a company name plus optional domain/address and returns:
- `PROCEED` or `HUMAN_REVIEW`
- deterministic reason codes
- per-check evidence
- matched legal entity
- timestamps and source provenance

## Shared layers
- payment/x402
- product registry
- evidence model
- source adapters
- OpenAPI/discovery generation
- regression tests
- settlement/distribution tooling

This branch is staging only. Nothing here changes production PA Entity behavior until explicitly integrated.
